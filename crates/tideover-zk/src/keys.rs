//! Key generation, proving and native verification.
//!
//! `setup` uses fresh OS randomness that is dropped when it returns, so nobody
//! holds the toxic waste, but it is still a single-party setup: you must trust
//! whoever ran it. Real funds need a multi-party ceremony.

use crate::{circuit::MembershipCircuit, near_encoding, Fr};
use ark_bls12_381::Bls12_381;
use ark_groth16::{prepare_verifying_key, Groth16, Proof, ProvingKey, VerifyingKey};
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize, SerializationError};
use ark_snark::SNARK;
use ark_std::rand::{rngs::StdRng, CryptoRng, RngCore, SeedableRng};

pub type Keys = (ProvingKey<Bls12_381>, VerifyingKey<Bls12_381>);

pub fn setup<R: RngCore + CryptoRng>(rng: &mut R) -> Keys {
    Groth16::<Bls12_381>::circuit_specific_setup(MembershipCircuit::blank(), rng).expect("setup")
}

pub fn prove(
    pk: &ProvingKey<Bls12_381>,
    circuit: MembershipCircuit,
    seed: [u8; 32],
) -> Proof<Bls12_381> {
    let mut rng = StdRng::from_seed(seed);
    Groth16::<Bls12_381>::prove(pk, circuit, &mut rng).expect("prove")
}

pub fn verify(vk: &VerifyingKey<Bls12_381>, inputs: &[Fr], proof: &Proof<Bls12_381>) -> bool {
    let pvk = prepare_verifying_key(vk);
    Groth16::<Bls12_381>::verify_proof(&pvk, proof, inputs).unwrap_or(false)
}

pub fn pk_to_bytes(pk: &ProvingKey<Bls12_381>) -> Result<Vec<u8>, SerializationError> {
    let mut v = Vec::new();
    pk.serialize_uncompressed(&mut v)?;
    Ok(v)
}

/// The key comes from our own static file, so subgroup checks are skipped for speed.
pub fn pk_from_bytes(bytes: &[u8]) -> Result<ProvingKey<Bls12_381>, SerializationError> {
    ProvingKey::<Bls12_381>::deserialize_uncompressed_unchecked(bytes)
}

pub fn vk_to_near(vk: &VerifyingKey<Bls12_381>) -> Vec<u8> {
    near_encoding::vk_bytes(vk)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{identity, MAX_TIER};
    use ark_relations::gr1cs::{ConstraintSynthesizer, ConstraintSystem};
    use std::sync::OnceLock;

    fn keys() -> &'static Keys {
        static K: OnceLock<Keys> = OnceLock::new();
        K.get_or_init(|| setup(&mut StdRng::from_seed([9u8; 32])))
    }

    struct Group {
        secrets: Vec<Fr>,
        tiers: Vec<u8>,
        leaves: Vec<Fr>,
    }

    fn group() -> Group {
        let secrets: Vec<Fr> = (1..=5u64).map(|i| Fr::from(i * 1000 + 7)).collect();
        let tiers = vec![1, 2, 3, 2, 1];
        let leaves = secrets
            .iter()
            .zip(&tiers)
            .map(|(s, t)| identity::leaf(identity::commitment(*s), 3, *t))
            .collect();
        Group {
            secrets,
            tiers,
            leaves,
        }
    }

    fn claim(g: &Group, who: usize, min_tier: u8) -> MembershipCircuit {
        MembershipCircuit::from_leaves(
            g.secrets[who],
            g.tiers[who],
            3,
            min_tier,
            identity::scope("harbor", 1),
            Fr::from(42u64),
            &g.leaves,
            who as u64,
        )
    }

    fn satisfied(c: MembershipCircuit) -> bool {
        let cs = ConstraintSystem::<Fr>::new_ref();
        c.generate_constraints(cs.clone()).unwrap();
        cs.is_satisfied().unwrap()
    }

    #[test]
    fn a_member_proves_membership_and_the_proof_verifies() {
        let (pk, vk) = keys();
        let g = group();
        let c = claim(&g, 2, 2);
        let inputs = c.public.to_inputs();
        let proof = prove(pk, c, [1u8; 32]);
        assert!(verify(vk, &inputs, &proof));
    }

    #[test]
    fn changing_any_public_input_breaks_the_proof() {
        let (pk, vk) = keys();
        let g = group();
        let c = claim(&g, 2, 2);
        let inputs = c.public.to_inputs();
        let proof = prove(pk, c, [2u8; 32]);
        for i in 0..inputs.len() {
            let mut bad = inputs.clone();
            bad[i] += Fr::from(1u64);
            assert!(!verify(vk, &bad, &proof), "public input {i} is not bound");
        }
    }

    #[test]
    fn a_member_cannot_claim_a_tier_above_their_own() {
        let g = group();
        assert!(satisfied(claim(&g, 0, 1)));
        assert!(!satisfied(claim(&g, 0, 2)));
        assert!(!satisfied(claim(&g, 0, MAX_TIER)));
    }

    #[test]
    fn a_stranger_cannot_prove_membership() {
        let g = group();
        let mut c = claim(&g, 1, 1);
        c.secret = Fr::from(999u64);
        c.public.nullifier = identity::nullifier(c.secret, c.public.scope);
        assert!(!satisfied(c));
    }

    #[test]
    fn a_stale_period_does_not_prove_this_period() {
        let g = group();
        let mut c = claim(&g, 1, 1);
        c.public.period = 4;
        assert!(!satisfied(c));
    }

    #[test]
    fn the_nullifier_must_be_the_real_one() {
        let g = group();
        let mut c = claim(&g, 1, 1);
        c.public.nullifier += Fr::from(1u64);
        assert!(!satisfied(c));
    }

    #[test]
    fn a_stored_proof_decodes_back_to_a_verifying_proof() {
        let (pk, vk) = keys();
        let g = group();
        let c = claim(&g, 2, 2);
        let inputs = c.public.to_inputs();
        let proof = prove(pk, c, [4u8; 32]);
        let bytes = near_encoding::proof_bytes(&proof);
        let back = near_encoding::proof_from_bytes(&bytes).unwrap();
        assert_eq!(back, proof);
        assert!(verify(vk, &inputs, &back));
        let mut corrupted = bytes;
        corrupted[10] ^= 1;
        assert!(near_encoding::proof_from_bytes(&corrupted).is_none());
    }

    #[test]
    fn keys_roundtrip_through_bytes() {
        let (pk, _) = keys();
        let back = pk_from_bytes(&pk_to_bytes(pk).unwrap()).unwrap();
        assert_eq!(&back, pk);
    }
}
