//! Checks a sealed review on chain, without anyone having to trust the relay.
//!
//! The member's browser encrypts the document to a NEAR AI model running in a
//! secure enclave. The model's answer comes back encrypted to the browser. This
//! module proves, from public bytes only, that:
//!
//! 1. the enclave key pinned by the DAO signed this exact request and response;
//! 2. the request carried the DAO's registered prompt and this claim's case file,
//!    so the member could not have written their own instructions;
//! 3. the request carried the committed evidence, as opaque ciphertext;
//! 4. the answer is the verdict for this claim, in closed fields only.
//!
//! The reasoning field stays encrypted, and the document is never opened. Only
//! the key of the `content` field is revealed.
//!
//! The on-chain procedure proof follows the design published by Undo,
//! <https://github.com/agadape/undo>. The code here is written from that
//! description and from NEAR AI's documented E2EE v2 format.

use crate::types::{Card, Reviewer};
use chacha20poly1305::{aead::Aead, KeyInit, XChaCha20Poly1305};
use curve25519_dalek::{edwards::CompressedEdwardsY, montgomery::MontgomeryPoint};
use near_sdk::serde_json::{self, Value};
use near_sdk::{env, require};

const HKDF_INFO: &[u8] = b"ed25519_encryption";
const CONTENT_MARK: &str = "\"content\":\"";
pub const CASE_SEPARATOR: &str = "\n\nCASE FILE: ";
pub const MAX_EVIDENCE_HEX: usize = 24_000;

const CATEGORIES: [&str; 8] = [
    "medical", "housing", "funeral", "income", "food", "legal", "safety", "other",
];
const DOCUMENTS: [&str; 7] = [
    "bill",
    "letter",
    "notice",
    "receipt",
    "statement",
    "other",
    "none",
];
const AMOUNT_MATCHES: [&str; 4] = ["yes", "partly", "no", "unknown"];
const ASSESSMENTS: [&str; 3] = ["supported", "unclear", "unsupported"];

pub fn new_reviewer(
    model_id: String,
    signer_hex: &str,
    prompt_sha256_hex: &str,
    max_tokens: u32,
) -> Reviewer {
    require!(
        !model_id.is_empty() && !model_id.contains(['"', '\\', ':']),
        "bad model id"
    );
    require!(max_tokens > 0, "max_tokens must be positive");
    let signer = unhex32(signer_hex, "signer key");
    let point = CompressedEdwardsY(signer)
        .decompress()
        .unwrap_or_else(|| env::panic_str("signer key is not a valid ed25519 point"));
    Reviewer {
        model_id,
        signer,
        signer_x25519: point.to_montgomery().to_bytes(),
        prompt_sha256: unhex32(prompt_sha256_hex, "prompt hash"),
        max_tokens,
    }
}

/// The case file the model must have been given. Public by design: an amount, a
/// date and a nonce, nothing about the person.
pub fn case_file(claim_id: u64, amount: u128, decimals: u8, filed_at_ns: u64, nonce: &str) -> String {
    format!(
        "{{\"claim\":\"{claim_id}\",\"amount\":\"{}\",\"date\":\"{}\",\"nonce\":\"{nonce}\"}}",
        display_amount(amount, decimals),
        date_string(filed_at_ns)
    )
}

/// `YYYY-MM-DD` in UTC. The model needs today's date to judge whether a document
/// is recent. This is the civil-from-days conversion for the proleptic Gregorian
/// calendar.
pub fn date_string(ns: u64) -> String {
    let z = (ns / 1_000_000_000 / 86_400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

/// `12345000` with 6 decimals becomes `12.34`. The model only needs a readable figure.
pub fn display_amount(amount: u128, decimals: u8) -> String {
    let unit = 10u128.pow(decimals as u32);
    let cents = (amount % unit) * 100 / unit;
    format!("{}.{cents:02}", amount / unit)
}

pub struct Sealed<'a> {
    pub signed_text: &'a str,
    pub signature_hex: &'a str,
    pub system_envelope: &'a str,
    pub system_eph_secret_hex: &'a str,
    pub evidence_envelope: &'a str,
    pub response_body: &'a str,
    pub verdict_key_hex: &'a str,
}

/// Runs every check and returns the card. Panics on anything that does not hold.
pub fn verify(
    r: &Reviewer,
    s: &Sealed,
    claim_id: u64,
    case: &str,
    nonce: &str,
    evidence_sha256_hex: &str,
) -> Card {
    // Evidence: exactly the committed envelope, and only hex, so it cannot break
    // out of the JSON string below.
    require!(
        s.evidence_envelope.len() <= MAX_EVIDENCE_HEX,
        "evidence is too large"
    );
    require_lower_hex(s.evidence_envelope, "evidence envelope");
    require_lower_hex(s.system_envelope, "system envelope");
    require!(
        hex::encode(env::sha256(s.evidence_envelope.as_bytes())) == evidence_sha256_hex,
        "evidence does not match its commitment"
    );

    // Rebuild the exact bytes the model must have received.
    let mut request =
        String::with_capacity(200 + s.system_envelope.len() + s.evidence_envelope.len());
    request.push_str("{\"model\":\"");
    request.push_str(&r.model_id);
    request.push_str("\",\"messages\":[{\"role\":\"system\",\"content\":\"");
    request.push_str(s.system_envelope);
    request.push_str("\"},{\"role\":\"user\",\"content\":\"");
    request.push_str(s.evidence_envelope);
    request.push_str("\"}],\"max_tokens\":");
    request.push_str(&r.max_tokens.to_string());
    request.push_str(",\"stream\":false}");

    // The enclave's signature over MODEL:sha256(request):sha256(response).
    let sig: [u8; 64] = unhex(s.signature_hex, "signature")
        .try_into()
        .unwrap_or_else(|_| env::panic_str("signature must be 64 bytes"));
    require!(
        env::ed25519_verify(&sig, s.signed_text.as_bytes(), &r.signer),
        "bad enclave signature"
    );
    let mut parts = s.signed_text.rsplitn(3, ':');
    let response_hash = parts.next().unwrap_or_default().to_ascii_lowercase();
    let request_hash = parts.next().unwrap_or_default().to_ascii_lowercase();
    require!(
        parts.next() == Some(r.model_id.as_str()),
        "signed by a different model, or by the gateway"
    );
    require!(
        hex::encode(env::sha256(request.as_bytes())) == request_hash,
        "the model did not receive this exact request"
    );
    require!(
        hex::encode(env::sha256(s.response_body.as_bytes())) == response_hash,
        "the response does not match the signed hash"
    );

    // Open the system message with a key derived here, as the model derives it.
    // Deriving it (rather than accepting one) means a crafted ciphertext cannot
    // show this contract one prompt and the model another.
    let blob = unhex(s.system_envelope, "system envelope");
    require!(blob.len() > 72, "system envelope too short");
    let eph_secret = unhex32(s.system_eph_secret_hex, "ephemeral secret");
    require!(
        MontgomeryPoint::mul_base_clamped(eph_secret).to_bytes()[..] == blob[..32],
        "ephemeral secret does not match the system envelope"
    );
    let shared = MontgomeryPoint(r.signer_x25519)
        .mul_clamped(eph_secret)
        .to_bytes();
    let system = decrypt_envelope(&blob, &hkdf32(&shared, HKDF_INFO), "system message");
    let suffix = format!("{CASE_SEPARATOR}{case}");
    require!(
        system.ends_with(&suffix),
        "the system message does not carry this case file"
    );
    require!(
        env::sha256(system[..system.len() - suffix.len()].as_bytes())[..] == r.prompt_sha256[..],
        "the system prompt is not the registered one"
    );

    // Open the verdict only. The reasoning field keeps its own key.
    require!(
        s.response_body.matches(CONTENT_MARK).count() == 1,
        "the response must have exactly one content field"
    );
    let start = s.response_body.find(CONTENT_MARK).unwrap_or_default() + CONTENT_MARK.len();
    let len = s.response_body[start..]
        .find('"')
        .unwrap_or_else(|| env::panic_str("unterminated content"));
    let content_hex = &s.response_body[start..start + len];
    require_lower_hex(content_hex, "verdict content");
    let verdict = decrypt_envelope(
        &unhex(content_hex, "verdict"),
        &unhex32(s.verdict_key_hex, "verdict key"),
        "verdict",
    );
    parse_card(&verdict, claim_id, nonce)
}

pub fn parse_card(verdict: &str, claim_id: u64, nonce: &str) -> Card {
    let v: Value =
        serde_json::from_str(verdict).unwrap_or_else(|_| env::panic_str("verdict is not JSON"));
    let claim = claim_id.to_string();
    require!(
        v["claim"].as_str() == Some(claim.as_str()) && v["nonce"].as_str() == Some(nonce),
        "the verdict is for another claim"
    );
    Card {
        category: one_of(&v, "category", &CATEGORIES),
        document: one_of(&v, "document", &DOCUMENTS),
        recent: flag(&v, "recent"),
        amount_matches: one_of(&v, "amount_matches", &AMOUNT_MATCHES),
        injection: flag(&v, "injection"),
        assessment: one_of(&v, "assessment", &ASSESSMENTS),
    }
}

/// Anything outside the closed set is refused, so free text can never reach the chain.
fn one_of(v: &Value, field: &str, allowed: &[&str]) -> String {
    let s = v[field].as_str().unwrap_or_default();
    require!(
        allowed.contains(&s),
        format!("verdict field {field} has a value outside its closed set")
    );
    s.to_string()
}

fn flag(v: &Value, field: &str) -> bool {
    v[field]
        .as_bool()
        .unwrap_or_else(|| env::panic_str(&format!("verdict field {field} must be a boolean")))
}

fn hmac_sha256(key: &[u8], msg: &[u8]) -> Vec<u8> {
    let mut k = [0u8; 64];
    k[..key.len()].copy_from_slice(key);
    let mut inner = Vec::with_capacity(64 + msg.len());
    inner.extend(k.iter().map(|b| b ^ 0x36));
    inner.extend_from_slice(msg);
    let inner_hash = env::sha256(&inner);
    let mut outer = Vec::with_capacity(96);
    outer.extend(k.iter().map(|b| b ^ 0x5c));
    outer.extend_from_slice(&inner_hash);
    env::sha256(&outer)
}

/// HKDF-SHA256 with an empty salt and one output block.
fn hkdf32(ikm: &[u8], info: &[u8]) -> [u8; 32] {
    let prk = hmac_sha256(&[0u8; 32], ikm);
    let mut t = info.to_vec();
    t.push(1);
    hmac_sha256(&prk, &t)
        .try_into()
        .unwrap_or_else(|_| env::panic_str("hkdf"))
}

/// Envelope = ephemeral_pub[32] || nonce[24] || ciphertext+tag.
fn decrypt_envelope(blob: &[u8], key: &[u8; 32], what: &str) -> String {
    require!(blob.len() > 72, format!("{what}: envelope too short"));
    let plain = XChaCha20Poly1305::new(key.into())
        .decrypt(blob[32..56].into(), &blob[56..])
        .unwrap_or_else(|_| env::panic_str(&format!("{what}: decryption failed")));
    String::from_utf8(plain).unwrap_or_else(|_| env::panic_str(&format!("{what}: not UTF-8")))
}

fn require_lower_hex(s: &str, what: &str) {
    require!(
        !s.is_empty()
            && s.len() % 2 == 0
            && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        format!("{what} must be lowercase hex")
    );
}

pub fn unhex(s: &str, what: &str) -> Vec<u8> {
    hex::decode(s).unwrap_or_else(|_| env::panic_str(&format!("{what} is not hex")))
}

pub fn unhex32(s: &str, what: &str) -> [u8; 32] {
    unhex(s, what)
        .try_into()
        .unwrap_or_else(|_| env::panic_str(&format!("{what} must be 32 bytes")))
}
