//! The membership statement.
//!
//! Public inputs, in this order: `root, period, min_tier, scope, nullifier, signal`.
//!
//! Statement: I know `secret`, `tier` and a Merkle path such that
//! `leaf(commitment(secret), period, tier)` sits in the tree under `root`,
//! `tier >= min_tier`, and `nullifier = H(NULL, secret, scope)`.
//!
//! `signal` is bound and otherwise unused. Callers put a hash of what the proof
//! authorises there, so nobody relaying the proof can change the request.

use crate::{
    identity::{self, DOM_ID, DOM_LEAF, DOM_NULL},
    poseidon, tree, Fr, TIER_BITS, TREE_DEPTH,
};
use ark_crypto_primitives::sponge::{
    constraints::CryptographicSpongeVar, poseidon::constraints::PoseidonSpongeVar,
};
use ark_ff::Zero;
use ark_r1cs_std::{
    alloc::AllocVar, boolean::Boolean, eq::EqGadget, fields::fp::FpVar, select::CondSelectGadget,
};
use ark_relations::gr1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError};

pub const N_PUBLIC: usize = 6;

#[derive(Clone, Debug, PartialEq)]
pub struct Public {
    pub root: Fr,
    pub period: u64,
    pub min_tier: u8,
    pub scope: Fr,
    pub nullifier: Fr,
    pub signal: Fr,
}

impl Public {
    pub fn to_inputs(&self) -> Vec<Fr> {
        vec![
            self.root,
            Fr::from(self.period),
            Fr::from(self.min_tier as u64),
            self.scope,
            self.nullifier,
            self.signal,
        ]
    }
}

#[derive(Clone, Debug)]
pub struct MembershipCircuit {
    pub public: Public,
    pub secret: Fr,
    pub tier: u8,
    pub position: u64,
    pub siblings: Vec<Fr>,
}

impl MembershipCircuit {
    /// Shape-only instance for key generation.
    pub fn blank() -> Self {
        MembershipCircuit {
            public: Public {
                root: Fr::zero(),
                period: 0,
                min_tier: 0,
                scope: Fr::zero(),
                nullifier: Fr::zero(),
                signal: Fr::zero(),
            },
            secret: Fr::zero(),
            tier: 0,
            position: 0,
            siblings: vec![Fr::zero(); TREE_DEPTH],
        }
    }

    /// Builds a claim witness from the full leaf list.
    #[allow(clippy::too_many_arguments)]
    pub fn from_leaves(
        secret: Fr,
        tier: u8,
        period: u64,
        min_tier: u8,
        scope: Fr,
        signal: Fr,
        leaves: &[Fr],
        position: u64,
    ) -> Self {
        MembershipCircuit {
            public: Public {
                root: tree::root_of(leaves),
                period,
                min_tier,
                scope,
                nullifier: identity::nullifier(secret, scope),
                signal,
            },
            secret,
            tier,
            position,
            siblings: tree::merkle_path(leaves, position),
        }
    }
}

fn hash_var(
    cs: ConstraintSystemRef<Fr>,
    inputs: &[FpVar<Fr>],
) -> Result<FpVar<Fr>, SynthesisError> {
    let mut sponge = PoseidonSpongeVar::<Fr>::new(cs, poseidon::config());
    sponge.absorb(&inputs)?;
    let out = sponge.squeeze_field_elements(1)?;
    Ok(out[0].clone())
}

fn domain(tag: u64) -> FpVar<Fr> {
    FpVar::Constant(Fr::from(tag))
}

/// Enforces that `x` equals the little-endian sum of `n` fresh bits holding `value`.
fn enforce_fits(
    cs: ConstraintSystemRef<Fr>,
    x: &FpVar<Fr>,
    value: u64,
    n: usize,
) -> Result<(), SynthesisError> {
    let bits = (0..n)
        .map(|i| Boolean::new_witness(cs.clone(), || Ok((value >> i) & 1 == 1)))
        .collect::<Result<Vec<_>, _>>()?;
    Boolean::le_bits_to_fp(&bits)?.enforce_equal(x)
}

impl ConstraintSynthesizer<Fr> for MembershipCircuit {
    fn generate_constraints(self, cs: ConstraintSystemRef<Fr>) -> Result<(), SynthesisError> {
        let p = &self.public;
        let root = FpVar::new_input(cs.clone(), || Ok(p.root))?;
        let period = FpVar::new_input(cs.clone(), || Ok(Fr::from(p.period)))?;
        let min_tier = FpVar::new_input(cs.clone(), || Ok(Fr::from(p.min_tier as u64)))?;
        let scope = FpVar::new_input(cs.clone(), || Ok(p.scope))?;
        let nullifier = FpVar::new_input(cs.clone(), || Ok(p.nullifier))?;
        let signal = FpVar::new_input(cs.clone(), || Ok(p.signal))?;

        let secret = FpVar::new_witness(cs.clone(), || Ok(self.secret))?;
        let tier = FpVar::new_witness(cs.clone(), || Ok(Fr::from(self.tier as u64)))?;

        let commitment = hash_var(cs.clone(), &[domain(DOM_ID), secret.clone()])?;
        let leaf = hash_var(
            cs.clone(),
            &[domain(DOM_LEAF), commitment, period, tier.clone()],
        )?;

        let mut cur = leaf;
        assert_eq!(self.siblings.len(), TREE_DEPTH);
        for (level, sibling) in self.siblings.iter().enumerate() {
            let is_right =
                Boolean::new_witness(cs.clone(), || Ok((self.position >> level) & 1 == 1))?;
            let sib = FpVar::new_witness(cs.clone(), || Ok(*sibling))?;
            let left = FpVar::conditionally_select(&is_right, &sib, &cur)?;
            let right = FpVar::conditionally_select(&is_right, &cur, &sib)?;
            cur = hash_var(cs.clone(), &[left, right])?;
        }
        cur.enforce_equal(&root)?;

        hash_var(cs.clone(), &[domain(DOM_NULL), secret, scope])?.enforce_equal(&nullifier)?;

        // tier and tier - min_tier both fit in TIER_BITS, so tier >= min_tier.
        let gap = self.tier.wrapping_sub(p.min_tier) as u64;
        enforce_fits(cs.clone(), &tier, self.tier as u64, TIER_BITS)?;
        enforce_fits(cs.clone(), &(&tier - &min_tier), gap, TIER_BITS)?;

        // Puts `signal` in a constraint, so its verifying-key element is not the
        // point at infinity and the host functions accept the key.
        let squared = &signal * &signal;
        squared.enforce_equal(&(&signal * &signal))?;
        Ok(())
    }
}
