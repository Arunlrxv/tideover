//! Checks a sealed reader's card.
//!
//! A member's document is encrypted to the clerk, a small program in a secure
//! enclave whose key only that exact code can read. The clerk runs one fixed prompt
//! and answers in closed fields, signed with a key the DAO pinned.
//!
//! The document never goes to the model directly. A shared model decrypts anything
//! sent to it, for anyone holding an API key, so a ciphertext addressed to the model
//! would be readable by the whole world as soon as it was public. A ciphertext
//! addressed to the clerk can only ever produce the same closed card.
//!
//! The contract checks the signature over everything the card is about, so a card
//! cannot be moved to another claim, amount or payout. Which code holds the key is
//! what the DAO checks, through the enclave's attestation, before pinning it.

use crate::types::{Card, Reviewer};
use near_sdk::{env, require};

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
    signer_hex: &str,
    encryption_key_hex: &str,
    code_hash: String,
    prompt_sha256_hex: &str,
) -> Reviewer {
    require!(code_hash.len() <= 128, "code hash is too long");
    Reviewer {
        signer: unhex32(signer_hex, "signer key"),
        encryption_key: unhex32(encryption_key_hex, "encryption key"),
        code_hash,
        prompt_sha256: unhex32(prompt_sha256_hex, "prompt hash"),
    }
}

/// The case file the clerk is given. Public by design: an amount, a date and a
/// nonce, nothing about the person.
pub fn case_file(
    claim_id: u64,
    amount: u128,
    decimals: u8,
    filed_at_ns: u64,
    nonce: &str,
) -> String {
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

/// The exact text the clerk signs. It names the fund and everything the claim
/// committed to, so a card fits one claim only. `clerk/src/lib.rs` builds the same
/// bytes.
#[allow(clippy::too_many_arguments)]
pub fn card_message(
    fund: &str,
    claim_id: u64,
    nonce: &str,
    evidence_sha256: &str,
    amount: u128,
    payout: &str,
    card: &Card,
) -> String {
    format!(
        "tideover/card/v1\n{fund}\n{claim_id}\n{nonce}\n{evidence_sha256}\n{amount}\n{payout}\n{}\n{}\n{}\n{}\n{}\n{}",
        card.category,
        card.document,
        card.recent,
        card.amount_matches,
        card.injection,
        card.assessment
    )
}

/// Anything outside the closed sets is refused, so free text can never reach the
/// chain, even from a clerk that went wrong.
pub fn validate_card(card: &Card) {
    require_in(&card.category, &CATEGORIES, "category");
    require_in(&card.document, &DOCUMENTS, "document");
    require_in(&card.amount_matches, &AMOUNT_MATCHES, "amount_matches");
    require_in(&card.assessment, &ASSESSMENTS, "assessment");
}

fn require_in(value: &str, allowed: &[&str], field: &str) {
    require!(
        allowed.contains(&value),
        format!("card field {field} has a value outside its closed set")
    );
}

pub fn verify_signature(reviewer: &Reviewer, message: &str, signature_hex: &str) {
    let sig: [u8; 64] = unhex(signature_hex, "signature")
        .try_into()
        .unwrap_or_else(|_| env::panic_str("signature must be 64 bytes"));
    require!(
        env::ed25519_verify(&sig, message.as_bytes(), &reviewer.signer),
        "bad clerk signature"
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
