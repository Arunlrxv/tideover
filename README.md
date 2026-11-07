# Tideover

A private hardship fund for communities that keep their money in a Sputnik DAO. Members pay dues into the DAO. When someone needs help, nobody can see who asked or why, and anyone can check that every rule was followed.

Built at NEAR HACKATHON, 1 to 14 November 2026. Tracks: Social Money (`social`), Privacy & Private AI (`privacy`).

## The problem

A DAO shows everyone everything. That suits a grant. It does not suit a payment for a cancer bill or an eviction notice, because a Sputnik proposal is public forever: who was paid, how much, and why.

So a community can run a public treasury or a private hardship fund, but not both. Companies solve this by paying an outside firm to run staff hardship funds, so the employer never sees an application ([Verizon's fund](https://www.verizon.com/about/sites/default/files/V2V-Employee-Relief-Fund-FAQ.pdf) works this way). Tideover replaces the outside firm with code, on the treasury the community already has.

## What it does

| Step | What happens |
|---|---|
| Earn cover | Dues go straight to the DAO. Each paid month raises a member's limit. |
| Ask anonymously | A zero-knowledge proof shows a paid-up member made this claim, not which one. |
| Seal the reason | The document is encrypted in the browser, so only an AI model in a secure enclave reads it. It can answer only in closed fields, so it cannot repeat a name. |
| Decide by size | Up to $100: pays after a veto window. Up to $400: three random members decide. Above that: a normal DAO proposal. |
| Pay and prove | The DAO pays a fresh address. The public ledger shows the amount and a tick for each rule, and no name or reason. |

The AI never moves money. It can only choose a path, and every path is bounded by limits the contract enforces.

## Try it

**Status: the live testnet deployment is not up yet, because the public testnet faucet is rate-limited for this machine. Everything below runs as soon as it deploys. See [Status](#status).**

Live app: to be added. No wallet is needed.

1. Open **Member** and click **Join the fund**. See a named account, 100 test dollars and seven months of record, all made in seconds. You hold no NEAR.
2. Click **Pay $10**. See your cover appear. The relay paid the gas through a NEP-366 meta-transaction, and the money went to the DAO.
3. Open **Ask for help** and pick **Hospital bill**. Click **Seal and send**. See the proof finish in about three seconds, then the reader's card.
4. Open **Ledger** and open your claim. See every rule ticked, with no name or reason on the page. Click **Re-check this claim here** to verify the proof and the enclave's signature in your own browser.
5. Open **Break it** and run each attack. See the contract's own refusal, with the failed transaction.
6. Back on **Ask for help**, pick **A trick document**, which tells the reader to approve it. It should lose the fast path. If it fools the model, the claim is still capped by the tier and the auto limit, and it can be stopped in the veto window.
7. Open **Trust** for what this does not hide.

Without the app: `cd web && npm run e2e` runs the real flow against testnet and checks that the money moved.

## How it fits on Sputnik DAO

The track asks what to build on Sputnik rather than beside it. This is the split.

| Need | Already in Sputnik | Added by Tideover |
|---|---|---|
| Custody | The DAO holds everything. The fund contract never keeps funds. | |
| Paying a claim | `Transfer` proposals | Filing and approving one, through a role that can do nothing else |
| Large claims | Council votes, unchanged | A proposal with no name or reason on it |
| Approval by amount | Not possible: the threshold depends on the proposal kind and role, not the amount | The route in `route_for` |
| Install | `ChangePolicyAddOrUpdateRole` | The factory, which creates a keyless named fund |
| Uninstall | `ChangePolicyRemoveRole` | Nothing needed |

Trezu runs on Sputnik DAOs, so a mainnet fund's proposals should appear there as ordinary requests. This has **not been tested**: Trezu's docs show no testnet version.

Design details: [docs/DESIGN.md](docs/DESIGN.md).

## What this adds to NEAR

- **[`tideover-zk`](crates/tideover-zk)**: anonymous membership as a library, for any NEAR contract, with a browser prover. [`contracts/anon-poll`](contracts/anon-poll/src/lib.rs) uses it unchanged to give any DAO a secret ballot in about 150 lines.
- **A module any Sputnik DAO can install** with two proposals, moving no money and changing no multisig.
- **A pattern for checking NEAR AI on chain without trusting a server.** The response stays encrypted to the member's browser, so even the relay cannot read the verdict's reasoning.
- **Membership that needs no NEAR.** Gasless dues let people join who have never held a token.
- **Stablecoins from any chain.** The Member page shows live NEAR Intents quotes for dues from Solana, Base and Arbitrum. Intents has no testnet, so these do not execute here.

## Status

| Item | State |
|---|---|
| Contract tests, with real proofs and a simulated enclave | 57 pass |
| Membership library tests | 16 pass |
| Secret ballot example tests | 5 pass |
| Browser proof accepted by the contract logic | Pass, golden test |
| Browser-sealed review accepted by the contract logic | Pass, golden test, with a test enclave key |
| Proof time in a real browser | 2.9 s |
| Live NEAR Intents quotes | Working for 3 chains |
| Deployed to testnet, real Sputnik DAO flow | **Not yet** |
| A real NEAR AI review, end to end | **Not yet.** Needs an API key |
| Gas figures | **Not yet measured** on chain |
| Trezu | **Not tested** |

## Limits

Written for the people it would protect, in full on the [Trust page](web/src/app/trust/page.tsx):

- **Small groups give less cover.** You are hidden among paid-up members at your tier or above.
- **Amounts and timing are public.** One member's claims within a year can be linked to each other, though not to them.
- **Sealed documents stay on chain as ciphertext**, because the contract must see the bytes to prove what the model read.
- **You trust the enclave hardware**, Intel TDX and NVIDIA.
- **Fraud is capped, not impossible.** AI cannot reliably spot a forged document. [The simulation](sim/solvency.mjs) shows what the limits do: over 10,000 three-year runs of a 40-member fund, one persistent cheat takes about 15% of dues, and honest members still receive 96% of the dollars they ask for. Four cheats take about 52%. These numbers rest on assumed catch rates. A fund of people who know each other is the real defence.
- **The zero-knowledge setup was run by one party**, and the contracts are unaudited. Do not use real money with this version.

## Run it yourself

Needs Rust with the `wasm32-unknown-unknown` target, and Node 24 or later.

```bash
cargo test -p tideover-zk --features prover --release
```

```bash
cargo test -p tideover-fund --release
```

```bash
cargo build -p tideover-fund -p tideover-factory -p tideover-test-usd --target wasm32-unknown-unknown --release
```

```bash
cd web && npm install && npm run dev
```

Then open <http://localhost:3100>. To deploy your own copy, see [docs/DEPLOY.md](docs/DEPLOY.md). On Windows, the Rust tests need the MSVC toolchain, because near-sdk's test harness links C code.

## Built with

near-sdk, near-api-js, arkworks, Next.js, `@noble` cryptography, wasm-bindgen, curve25519-dalek, chacha20poly1305, pdf.js.

- The Poseidon parameters, tree, NEP-488 encodings and Groth16 verifier follow [Antumbra](https://github.com/Valentine1898/antumbra) (MIT), and `contracts/fund/src/groth16.rs` is adapted from it.
- The role pattern for acting inside a DAO follows [Petty Cash](https://github.com/kasbsquall/petty-cash) (MIT).
- The on-chain check of an encrypted model response follows the design published by [Undo](https://github.com/agadape/undo). That code has no licence, so `review.rs` was written from its description and from NEAR AI's documentation.

All code here was written during the hackathon window, with AI assistance (Claude Code).

## Licence

MIT. See [LICENSE](LICENSE).
