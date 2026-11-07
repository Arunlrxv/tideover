# tideover-zk

Anonymous membership for NEAR contracts. A group keeps a Merkle tree of members on chain. A member proves they belong, at a given level, without saying who they are, and a contract verifies that in about 17 Tgas through the NEP-488 host functions. (That figure is from Antumbra's measurements of a similar verifier. This crate's own gas has not been measured yet.)

Nothing here is specific to hardship funds. Use it for anonymous votes, gated access, private claims or rate limits.

## What a proof says

Public inputs: `root, period, min_tier, scope, nullifier, signal`.

> I hold the secret behind a leaf in the tree with this `root`, for this `period`, at a tier of at least `min_tier`. This `nullifier` is mine for this `scope`.

- **`scope`** decides how often a member can act. One per poll, one per year, or anything else.
- **`nullifier`** repeats for the same member and scope, and cannot be linked to them. Reject repeats for one-use actions, or count them, as an anonymous tag.
- **`signal`** is bound and otherwise unused. Put a hash of what the proof authorises there, so nobody relaying it can change it.
- **`period` and `tier`** are free for your own meaning. Set them to 0 if you don't need them.

## Use it

On chain, keep a `Frontier` and verify like this. [`contracts/anon-poll`](../../contracts/anon-poll/src/lib.rs) is a complete example.

```rust
let inputs = [root, period, min_tier, scope, nullifier, signal]; // 32-byte little-endian scalars
match groth16::verify(MEMBERSHIP_VK, &proof, &inputs) {
    Some(true) => { /* accept, and record the nullifier */ }
    _ => env::panic_str("The proof does not verify"),
}
```

In the browser, [`tideover-wasm`](../tideover-wasm) proves in about three seconds and needs a 3.2 MB key.

## Things to get right

- **Decode field elements strictly.** `encoding::fr_from_bytes` rejects non-canonical values. Without it, one nullifier has two encodings, so a member can act twice.
- **Keep a set of recent roots**, so a dues payment landing while someone proves does not invalidate their proof.
- **Use your own `scope`** per contract and purpose. The contract's account belongs in it.
- **Run a real ceremony for real value.** The keys in this repository came from a one-person setup.
- **An anonymity set is only as large as the group.** Say so to your users.

## Credit

The Poseidon parameters, tree and NEP-488 encodings follow [Antumbra](https://github.com/Valentine1898/antumbra) (MIT).
