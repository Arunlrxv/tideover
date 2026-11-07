//! Poseidon over BLS12-381 Fr: width 3 (rate 2, capacity 1), x^5 S-box, 8 full
//! and 57 partial rounds. Parameters come from the Grain LFSR procedure of the
//! Poseidon paper as implemented in ark-crypto-primitives, and are embedded in
//! `consts.rs` so a contract call never runs the LFSR.
//!
//! `hash` is a plain sponge with no length padding, so `hash(&[x])` equals
//! `hash(&[x, 0])`. Callers therefore only hash fixed-arity tuples that start
//! with a domain tag (see `identity`), and the circuit enforces the same shapes.

use crate::{consts, encoding::fr_from_bytes, Fr};
use ark_crypto_primitives::sponge::{
    poseidon::{find_poseidon_ark_and_mds, PoseidonConfig, PoseidonSponge},
    CryptographicSponge, FieldBasedCryptographicSponge,
};
use ark_ff::PrimeField;
use std::sync::OnceLock;

pub const FULL_ROUNDS: usize = 8;
pub const PARTIAL_ROUNDS: usize = 57;
pub const ALPHA: u64 = 5;
pub const RATE: usize = 2;
pub const CAPACITY: usize = 1;

/// Derives the parameters from scratch. Used by `gen-consts` and tests.
pub fn generate_config() -> PoseidonConfig<Fr> {
    let (ark, mds) = find_poseidon_ark_and_mds::<Fr>(
        Fr::MODULUS_BIT_SIZE as u64,
        RATE,
        FULL_ROUNDS as u64,
        PARTIAL_ROUNDS as u64,
        0,
    );
    PoseidonConfig::new(FULL_ROUNDS, PARTIAL_ROUNDS, ALPHA, mds, ark, RATE, CAPACITY)
}

/// The shared parameter set, decoded from the embedded constants once per process.
pub fn config() -> &'static PoseidonConfig<Fr> {
    static CFG: OnceLock<PoseidonConfig<Fr>> = OnceLock::new();
    CFG.get_or_init(|| {
        let dec = |b: &[u8; 32]| fr_from_bytes(b).expect("embedded constant is canonical");
        let ark = consts::POSEIDON_ARK
            .iter()
            .map(|row| row.iter().map(dec).collect())
            .collect();
        let mds = consts::POSEIDON_MDS
            .iter()
            .map(|row| row.iter().map(dec).collect())
            .collect();
        PoseidonConfig::new(FULL_ROUNDS, PARTIAL_ROUNDS, ALPHA, mds, ark, RATE, CAPACITY)
    })
}

pub fn hash(inputs: &[Fr]) -> Fr {
    hash_with(config(), inputs)
}

pub fn hash_with(cfg: &PoseidonConfig<Fr>, inputs: &[Fr]) -> Fr {
    let mut sponge = PoseidonSponge::<Fr>::new(cfg);
    sponge.absorb(&inputs);
    sponge.squeeze_native_field_elements(1)[0]
}

/// Two-to-one hash used by the tree.
pub fn hash2(left: Fr, right: Fr) -> Fr {
    hash(&[left, right])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_constants_match_generation() {
        let gen = generate_config();
        let cfg = config();
        assert_eq!(gen.ark, cfg.ark, "run gen-consts");
        assert_eq!(gen.mds, cfg.mds, "run gen-consts");
    }

    #[test]
    fn deterministic_and_input_sensitive() {
        let a = hash(&[Fr::from(1u64), Fr::from(2u64)]);
        assert_eq!(a, hash(&[Fr::from(1u64), Fr::from(2u64)]));
        assert_ne!(a, hash(&[Fr::from(2u64), Fr::from(1u64)]));
    }
}
