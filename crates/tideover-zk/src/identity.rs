//! The hashed values a member, a contract and the circuit must agree on.
//!
//! - `commitment = H(ID, secret)`, public, registered once by the member.
//! - `leaf = H(LEAF, commitment, period, tier)`, added when dues are paid.
//! - `nullifier = H(NULL, secret, scope)`, published with a claim.
//! - `scope = H(SCOPE, group, cycle)`, one per group and claim cycle.
//!
//! Without the secret, a nullifier cannot be linked to a commitment. With the
//! same secret and scope it always repeats, which stops a second claim.

use crate::{encoding::bytes_to_fr, poseidon::hash, Fr};

pub const DOM_ID: u64 = 0x7469_6465_0001;
pub const DOM_LEAF: u64 = 0x7469_6465_0002;
pub const DOM_NULL: u64 = 0x7469_6465_0003;
pub const DOM_SCOPE: u64 = 0x7469_6465_0004;

pub fn commitment(secret: Fr) -> Fr {
    hash(&[Fr::from(DOM_ID), secret])
}

pub fn leaf(commitment: Fr, period: u64, tier: u8) -> Fr {
    hash(&[
        Fr::from(DOM_LEAF),
        commitment,
        Fr::from(period),
        Fr::from(tier as u64),
    ])
}

pub fn nullifier(secret: Fr, scope: Fr) -> Fr {
    hash(&[Fr::from(DOM_NULL), secret, scope])
}

pub fn scope(group: &str, cycle: u64) -> Fr {
    hash(&[
        Fr::from(DOM_SCOPE),
        bytes_to_fr(group.as_bytes()),
        Fr::from(cycle),
    ])
}

/// What a claim proof authorises. It is bound into the proof, so a relay cannot
/// change the amount, the payout or the evidence.
pub fn signal(group: &str, amount: u128, payout: &str, evidence_sha256: &[u8; 32]) -> Fr {
    let mut m = Vec::with_capacity(96 + group.len() + payout.len());
    m.extend_from_slice(b"tideover/claim/v1\0");
    m.extend_from_slice(group.as_bytes());
    m.push(0);
    m.extend_from_slice(&amount.to_le_bytes());
    m.extend_from_slice(payout.as_bytes());
    m.push(0);
    m.extend_from_slice(evidence_sha256);
    bytes_to_fr(&m)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn domains_separate_otherwise_identical_inputs() {
        let s = Fr::from(5u64);
        assert_ne!(commitment(s), nullifier(s, Fr::from(0u64)));
    }

    #[test]
    fn nullifier_repeats_within_a_scope_only() {
        let s = Fr::from(5u64);
        let a = scope("harbor.tideover.testnet", 1);
        let b = scope("harbor.tideover.testnet", 2);
        let c = scope("other.tideover.testnet", 1);
        assert_eq!(nullifier(s, a), nullifier(s, a));
        assert_ne!(nullifier(s, a), nullifier(s, b));
        assert_ne!(nullifier(s, a), nullifier(s, c));
    }
}
