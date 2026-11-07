//! Member-side operations for the browser. Everything here runs on the member's
//! own device: the secret never leaves it, and neither does the Merkle witness.
//!
//! All values are hex strings or JSON, so the page holds no field arithmetic.
//! Randomness comes in as a 32-byte seed from `crypto.getRandomValues`.

use ark_bls12_381::Bls12_381;
use ark_ff::PrimeField;
use ark_groth16::VerifyingKey;
use ark_serialize::CanonicalDeserialize;
use serde::{Deserialize, Serialize};
use tideover_zk::{
    circuit::{MembershipCircuit, Public},
    encoding::{bytes_to_fr, fr_from_hex, fr_to_bytes, fr_to_hex},
    identity, keys, near_encoding, Fr,
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
fn start() {
    console_error_panic_hook::set_once();
}

fn err(msg: impl core::fmt::Display) -> JsError {
    JsError::new(&msg.to_string())
}

fn field(hex_value: &str, what: &str) -> Result<Fr, JsError> {
    fr_from_hex(hex_value).ok_or_else(|| err(format!("{what} is not a field element")))
}

/// A new member secret from 32 random bytes.
#[wasm_bindgen]
pub fn new_secret(seed: &[u8]) -> Result<String, JsError> {
    if seed.len() != 32 {
        return Err(err("seed must be 32 bytes"));
    }
    Ok(fr_to_hex(&Fr::from_le_bytes_mod_order(seed)))
}

/// Derives a member secret from any bytes, such as a wallet signature, so a
/// member can recover it with the same wallet.
#[wasm_bindgen]
pub fn secret_from_bytes(bytes: &[u8]) -> String {
    fr_to_hex(&bytes_to_fr(bytes))
}

#[wasm_bindgen]
pub fn commitment(secret: &str) -> Result<String, JsError> {
    Ok(fr_to_hex(&identity::commitment(field(secret, "secret")?)))
}

#[wasm_bindgen]
pub fn nullifier(secret: &str, fund: &str, cycle: u64) -> Result<String, JsError> {
    let scope = identity::scope(fund, cycle);
    Ok(fr_to_hex(&identity::nullifier(field(secret, "secret")?, scope)))
}

#[derive(Deserialize)]
struct ClaimRequest {
    secret: String,
    fund: String,
    cycle: u64,
    tier: u8,
    period: u64,
    min_tier: u8,
    /// Decimal string, in the token's smallest unit.
    amount: String,
    payout: String,
    evidence_sha256: String,
    position: u64,
    leaves: Vec<String>,
}

#[derive(Serialize)]
struct ClaimProof {
    proof: String,
    root: String,
    period: u64,
    min_tier: u8,
    nullifier: String,
}

/// Proves a claim. `pk` is the proving key file's bytes, `request` is JSON, and
/// `seed` is 32 random bytes. Returns the JSON the relay submits.
#[wasm_bindgen]
pub fn prove_claim(pk: &[u8], request: &str, seed: &[u8]) -> Result<String, JsError> {
    let r: ClaimRequest = serde_json::from_str(request).map_err(err)?;
    let seed: [u8; 32] = seed.try_into().map_err(|_| err("seed must be 32 bytes"))?;
    let pk = keys::pk_from_bytes(pk).map_err(err)?;
    let secret = field(&r.secret, "secret")?;
    let leaves = r
        .leaves
        .iter()
        .map(|l| field(l, "leaf"))
        .collect::<Result<Vec<_>, _>>()?;
    if r.position as usize >= leaves.len() {
        return Err(err("this member has no leaf in the tree"));
    }
    let amount: u128 = r.amount.parse().map_err(|_| err("bad amount"))?;
    let evidence: [u8; 32] = hex::decode(&r.evidence_sha256)
        .map_err(err)?
        .try_into()
        .map_err(|_| err("evidence hash must be 32 bytes"))?;
    let scope = identity::scope(&r.fund, r.cycle);
    let signal = identity::signal(&r.fund, amount, &r.payout, &evidence);
    let circuit = MembershipCircuit::from_leaves(
        secret, r.tier, r.period, r.min_tier, scope, signal, &leaves, r.position,
    );
    let public = circuit.public.clone();
    let proof = keys::prove(&pk, circuit, seed);
    serde_json::to_string(&ClaimProof {
        proof: hex::encode(near_encoding::proof_bytes(&proof)),
        root: hex::encode(fr_to_bytes(&public.root)),
        period: public.period,
        min_tier: public.min_tier,
        nullifier: hex::encode(fr_to_bytes(&public.nullifier)),
    })
    .map_err(err)
}

#[derive(Deserialize)]
struct AuditRequest {
    /// The proof as stored on chain: a || b || c in NEAR layout.
    proof: String,
    root: String,
    period: u64,
    min_tier: u8,
    nullifier: String,
    fund: String,
    cycle: u64,
    amount: String,
    payout: String,
    evidence_sha256: String,
}

/// Re-checks a stored claim's proof in the viewer's own browser, away from the
/// contract. `vk` is the arkworks-encoded verifying key.
#[wasm_bindgen]
pub fn audit_claim(vk: &[u8], request: &str) -> Result<bool, JsError> {
    let r: AuditRequest = serde_json::from_str(request).map_err(err)?;
    let vk = VerifyingKey::<Bls12_381>::deserialize_compressed(vk).map_err(err)?;
    let amount: u128 = r.amount.parse().map_err(|_| err("bad amount"))?;
    let evidence: [u8; 32] = hex::decode(&r.evidence_sha256)
        .map_err(err)?
        .try_into()
        .map_err(|_| err("evidence hash must be 32 bytes"))?;
    let public = Public {
        root: field(&r.root, "root")?,
        period: r.period,
        min_tier: r.min_tier,
        scope: identity::scope(&r.fund, r.cycle),
        nullifier: field(&r.nullifier, "nullifier")?,
        signal: identity::signal(&r.fund, amount, &r.payout, &evidence),
    };
    let proof = near_encoding::proof_from_bytes(&hex::decode(&r.proof).map_err(err)?)
        .ok_or_else(|| err("malformed proof"))?;
    Ok(keys::verify(&vk, &public.to_inputs(), &proof))
}
