//! NEP-488 byte layouts for proofs, verifying keys and public inputs.
//!
//! Fp: 48 bytes big-endian. Fp2: c1 || c0. G1: x || y (96). G2: x || y (192).
//! Scalars: 32 bytes little-endian.

use crate::{encoding::fr_to_bytes, Fr};
use ark_bls12_381::{Bls12_381, Fq, Fq2, G1Affine, G2Affine};
use ark_ec::AffineRepr;
use ark_ff::{BigInteger, PrimeField};
use ark_groth16::{Proof, VerifyingKey};
use num_bigint::BigUint;

pub const G1_LEN: usize = 96;
pub const G2_LEN: usize = 192;
pub const PROOF_LEN: usize = 2 * G1_LEN + G2_LEN;

fn be48<F: PrimeField>(x: &F) -> Vec<u8> {
    let v = x.into_bigint().to_bytes_be();
    let v: Vec<u8> = v.into_iter().skip_while(|b| *b == 0).collect();
    assert!(v.len() <= 48);
    let mut out = vec![0u8; 48 - v.len()];
    out.extend(v);
    out
}

pub fn g1(p: &G1Affine) -> Vec<u8> {
    assert!(!p.is_zero(), "point at infinity is not expected here");
    [be48(&p.x), be48(&p.y)].concat()
}

pub fn g2(p: &G2Affine) -> Vec<u8> {
    assert!(!p.is_zero(), "point at infinity is not expected here");
    [be48(&p.x.c1), be48(&p.x.c0), be48(&p.y.c1), be48(&p.y.c0)].concat()
}

/// alpha_g1 || beta_g2 || gamma_g2 || delta_g2 || ic[0..=n]
pub fn vk_bytes(vk: &VerifyingKey<Bls12_381>) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend(g1(&vk.alpha_g1));
    out.extend(g2(&vk.beta_g2));
    out.extend(g2(&vk.gamma_g2));
    out.extend(g2(&vk.delta_g2));
    for p in &vk.gamma_abc_g1 {
        out.extend(g1(p));
    }
    out
}

/// a || b || c
pub fn proof_bytes(proof: &Proof<Bls12_381>) -> Vec<u8> {
    [g1(&proof.a), g2(&proof.b), g1(&proof.c)].concat()
}

pub fn inputs_bytes(inputs: &[Fr]) -> Vec<u8> {
    inputs.iter().flat_map(fr_to_bytes).collect()
}

fn fq_be(bytes: &[u8]) -> Option<Fq> {
    let v = BigUint::from_bytes_be(bytes);
    (v < Fq::MODULUS.into()).then(|| Fq::from(v))
}

fn g1_from(bytes: &[u8]) -> Option<G1Affine> {
    let p = G1Affine::new_unchecked(fq_be(&bytes[..48])?, fq_be(&bytes[48..96])?);
    (p.is_on_curve() && p.is_in_correct_subgroup_assuming_on_curve()).then_some(p)
}

fn g2_from(bytes: &[u8]) -> Option<G2Affine> {
    let x = Fq2::new(fq_be(&bytes[48..96])?, fq_be(&bytes[..48])?);
    let y = Fq2::new(fq_be(&bytes[144..192])?, fq_be(&bytes[96..144])?);
    let p = G2Affine::new_unchecked(x, y);
    (p.is_on_curve() && p.is_in_correct_subgroup_assuming_on_curve()).then_some(p)
}

/// The inverse of `proof_bytes`, for re-checking a stored proof off chain.
pub fn proof_from_bytes(bytes: &[u8]) -> Option<Proof<Bls12_381>> {
    if bytes.len() != PROOF_LEN {
        return None;
    }
    Some(Proof {
        a: g1_from(&bytes[..G1_LEN])?,
        b: g2_from(&bytes[G1_LEN..G1_LEN + G2_LEN])?,
        c: g1_from(&bytes[G1_LEN + G2_LEN..])?,
    })
}
