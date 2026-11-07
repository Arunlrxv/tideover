//! Generates the proving and verifying keys from fresh OS randomness.
//! Run: cargo run -p tideover-zk --bin tideover-setup --release --features parallel
//!
//! keys/membership.vk.near is embedded in the fund contract, so re-running this
//! means rebuilding and redeploying the contract.

use ark_serialize::CanonicalSerialize;
use ark_std::rand::{rngs::StdRng, SeedableRng};
use std::{fs, path::PathBuf};
use tideover_zk::keys;

fn main() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut seed = [0u8; 32];
    getrandom::fill(&mut seed).expect("OS randomness");
    let mut rng = StdRng::from_seed(seed);
    let (pk, vk) = keys::setup(&mut rng);
    // The seed and the stream it drives are dropped here and never written anywhere.
    seed.fill(0);
    drop(rng);

    let pk_bytes = keys::pk_to_bytes(&pk).unwrap();
    let vk_bytes = keys::vk_to_near(&vk);
    let mut vk_ark = Vec::new();
    vk.serialize_compressed(&mut vk_ark).unwrap();

    fs::create_dir_all(root.join("keys")).unwrap();
    fs::write(root.join("keys/membership.vk.near"), &vk_bytes).unwrap();
    fs::write(root.join("keys/membership.vk.ark"), &vk_ark).unwrap();
    fs::write(root.join("keys/membership.pk"), &pk_bytes).unwrap();
    println!(
        "proving key {} bytes, verifying key {} bytes (NEAR layout)",
        pk_bytes.len(),
        vk_bytes.len()
    );
}
