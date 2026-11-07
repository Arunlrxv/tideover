//! Field elements travel as 32-byte little-endian canonical encodings, which is
//! also the scalar layout of the NEP-488 host functions.

use ark_bls12_381::Fr;
use ark_ff::PrimeField;
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use sha2::{Digest, Sha256};

pub fn fr_to_bytes(x: &Fr) -> [u8; 32] {
    let mut out = [0u8; 32];
    x.serialize_compressed(&mut out[..])
        .expect("Fr is 32 bytes");
    out
}

/// Strict decoding: rejects values at or above the field modulus.
pub fn fr_from_bytes(b: &[u8; 32]) -> Option<Fr> {
    Fr::deserialize_compressed(&b[..]).ok()
}

pub fn fr_to_hex(x: &Fr) -> String {
    hex::encode(fr_to_bytes(x))
}

pub fn fr_from_hex(s: &str) -> Option<Fr> {
    let v = hex::decode(s).ok()?;
    let arr: [u8; 32] = v.try_into().ok()?;
    fr_from_bytes(&arr)
}

/// Maps arbitrary bytes into the field: sha256, reduced mod r.
pub fn bytes_to_fr(b: &[u8]) -> Fr {
    Fr::from_le_bytes_mod_order(&Sha256::digest(b))
}

/// Maps an already-computed sha256 digest into the field.
pub fn digest_to_fr(digest: &[u8]) -> Fr {
    Fr::from_le_bytes_mod_order(digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_canonical() {
        let x = Fr::from(123456789u64);
        assert_eq!(fr_from_bytes(&fr_to_bytes(&x)), Some(x));
        assert_eq!(fr_from_hex(&fr_to_hex(&x)), Some(x));
        // r - 1 is canonical, r is not.
        let minus_one = -Fr::from(1u64);
        assert_eq!(fr_from_bytes(&fr_to_bytes(&minus_one)), Some(minus_one));
        let mut modulus = fr_to_bytes(&minus_one);
        modulus[0] = modulus[0].wrapping_add(1);
        assert_eq!(fr_from_bytes(&modulus), None);
    }

    #[test]
    fn digest_mapping_matches_bytes_mapping() {
        let digest = Sha256::digest(b"tideover");
        assert_eq!(digest_to_fr(&digest), bytes_to_fr(b"tideover"));
    }
}
