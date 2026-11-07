//! Anonymous membership for NEAR.
//!
//! A group keeps an append-only Merkle tree of member leaves on chain. A member
//! can then prove, with a Groth16 proof over BLS12-381, that:
//!
//! - they hold the secret behind a leaf in the tree,
//! - that leaf is for a given period, at a level of at least `min_tier`,
//! - this is their first use of a given scope (the nullifier repeats if they
//!   try twice, and cannot be linked to them otherwise).
//!
//! The proof says nothing else: not which leaf, not which account.
//!
//! The crate has no Tideover-specific logic beyond its domain tags, so any NEAR
//! contract can reuse it for anonymous votes, gated access or private claims.
//! Poseidon parameters, the tree and the NEP-488 encodings follow the approach
//! of Antumbra (MIT), <https://github.com/Valentine1898/antumbra>.

pub mod consts;
pub mod encoding;
pub mod identity;
pub mod poseidon;
pub mod tree;

#[cfg(feature = "prover")]
pub mod circuit;
#[cfg(feature = "prover")]
pub mod keys;
#[cfg(feature = "prover")]
pub mod near_encoding;

pub use ark_bls12_381::Fr;

/// 2^16 leaves. One leaf is added per dues payment, so this is 65,536 member-periods.
pub const TREE_DEPTH: usize = 16;

/// Tiers are 0..=15, which keeps the range check in the circuit to four bits.
pub const TIER_BITS: usize = 4;
pub const MAX_TIER: u8 = (1 << TIER_BITS) - 1;
