# Tideover

A private hardship fund for communities that keep their money in a Sputnik DAO. Members pay dues into the DAO. When someone needs help, nobody can see who asked or why, and anyone can check that every rule was followed.

Built at NEAR HACKATHON, 1 to 14 November 2026. Track: Social Money (`social`).

## The problem

A DAO shows everyone everything. That suits a grant. It does not suit a payment for a cancer bill or an eviction notice, because a Sputnik proposal is public forever: who was paid, how much, and why.

So a community can run a public treasury or a private hardship fund, but not both. Companies solve this by paying an outside firm to run staff hardship funds, so the employer never sees an application ([Verizon's fund](https://www.verizon.com/about/sites/default/files/V2V-Employee-Relief-Fund-FAQ.pdf) works this way). Tideover replaces the outside firm with code, on the treasury the community already has.

## What it does

| Step | What happens |
|---|---|
| Earn cover | Dues go straight to the DAO. Each paid month raises a member's limit. |
| Ask anonymously | A zero-knowledge proof shows a paid-up member made this claim, not which one. |
| Seal the reason | The document is encrypted in the browser to a sealed clerk, a small program in a secure enclave. It reads the document with a private AI model and answers only in closed fields, so it cannot repeat a name. |
| Decide by size | Up to $100: pays after a veto window. Up to $400: three random members decide. Above that: a normal DAO proposal. |
| Pay and prove | The DAO pays a fresh address. The public ledger shows the amount and a tick for each rule, and no name or reason. |

The AI never moves money. It can only choose a path, and every path is bounded by limits the contract enforces.

## Try it

**The contracts are live on NEAR testnet, and the full flow below has run there. See [the results](docs/TESTNET.md).** There is no hosted copy yet.

- **With no keys:** run the app locally as under [Run it yourself](#run-it-yourself), then open **Ledger** and **Records**, and click **Re-check this claim here** on any claim. These read the live contracts directly.
- **For the steps below:** the app needs relay keys in `web/.env.local`, so these need a hosted copy, or your own deployment, which takes about 12 test NEAR. See [docs/DEPLOY.md](docs/DEPLOY.md). No wallet is needed.

1. Open **Member** and click **Join the fund**. See a named account, 100 test dollars and twelve months of record, all made in seconds. You hold no NEAR.
2. Click **Pay $10**. See your cover appear. The relay paid the gas through a NEP-366 meta-transaction, and the money went to the DAO.
3. Open **Ask for help** and pick **Hospital bill**. Click **Seal and send**. See the proof finish in about three seconds, then the reader's card.
4. Open **Ledger** and open your claim. See every rule ticked, with no name or reason on the page. Click **Re-check this claim here** to verify the proof and the clerk's signature in your own browser.
5. Open **Records** and open a member. See each point of their record with what earned it, and no link to any claim of theirs.
6. Open **Break it** and run each attack. See the contract's own refusal, with the failed transaction.
7. Back on **Ask for help**, pick **A trick document**, which tells the reader to approve it. It should lose the fast path. If it fools the model, the claim is still capped by the tier and the auto limit, and it can be stopped in the veto window.
8. Open **Trust** for what this does not hide, and to see whether the clerk is running in an enclave or on the demo's server.

Without the app: `cd web && npm run e2e` runs the real flow against testnet and checks that the money moved. With only a NEAR AI key, `cd web && npm run model-check` runs the real prompt on the sample documents, and `npm run e2e -- --model` uses the real model on chain.

## How it fits Social Money

The track asks for shared budgets, programmable rewards, collective ownership and reputation-based access on Sputnik DAO and Trezu, without rebuilding the multisig.

| Track idea | In Tideover |
|---|---|
| Shared budgets | Dues go to the DAO, and the fund enforces a budget per quarter |
| Programmable rewards | Each paid month and each panel served adds a point, and points raise a member's cover |
| Collective ownership | The community's DAO holds all the money and votes on rules, members and the largest claims |
| Reputation-based access | A member's record sets their tier, and their tier sets how much they can ask for |
| Named accounts | Funds, members and the DAO are named accounts, and a record belongs to one |

### Approval flows: what exists and what this adds

| Need | Already in Sputnik DAO | Already in Trezu | Added by Tideover |
|---|---|---|---|
| Custody | The DAO holds everything | The same DAO | Nothing. The fund contract never keeps funds. |
| Paying a claim | `Transfer` proposals | Shown as a payment request | Filing and approving one, through a role that can do nothing else |
| Large claims | Council votes, unchanged | Voted on in Requests, unchanged | A proposal with no name or reason on it |
| Approval by amount | Not possible: the threshold depends on the proposal kind and role, not the amount | One threshold per kind of request | The route in `route_for` |
| Reputation | None | None | Tiers, with `get_record` tracing each point |
| Install | `ChangePolicyAddOrUpdateRole` | Shows and votes on it as a policy change | The factory, which creates a keyless named fund |
| Running it | `FunctionCall` proposals | Custom proposal templates | Templates on the Install page, for install, admitting members, rules, the clerk and resuming |
| Uninstall | `ChangePolicyRemoveRole` | Shows and votes on it as a policy change | Nothing needed |

Trezu's hosted app is mainnet-only, but its frontend has a [local mode for testnet DAOs](docs/DEPLOY.md#open-the-demo-dao-in-trezu). The fund's proposals use the description fields Trezu reads, and the templates follow its documented format. Neither has been tried in Trezu itself yet, so treat that column as read from Trezu's code, not tested.

### The track's example prompt

The [example prompt](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/12-social.md) is a bounty board, and the rules call it a starting point, not a requirement. Tideover answers the same four points for a hardship fund:

| Example requirement | In Tideover |
|---|---|
| Use the existing treasury, with no new multisig | Yes. The DAO holds the money and approves every payment. |
| Reputation on named accounts, every point traceable | Yes. `get_record` lists each point's source, and a score is exactly their sum. Open **Records** to see it. |
| Small payouts auto-approve, mid-size need one council member, large become a normal proposal | Yes. A fund chooses who decides mid-size claims on the **Install** page: one council member, or three random members. The demo uses three, so no single known person sees them all. |
| A good record raises how much can be paid without a full council vote | Yes. A member's tier caps a claim at $100, then $300, then $800, and anything up to $400 avoids a council vote. |
| A public board of open items, claims, payouts and records | Yes. **Ledger** shows claims and payouts, and **Records** shows each member's record. Claims carry no name, by design. |

Design details: [docs/DESIGN.md](docs/DESIGN.md).

## What this adds to NEAR

- **[`tideover-zk`](crates/tideover-zk)**: anonymous membership as a library, for any NEAR contract, with a browser prover. [`contracts/anon-poll`](contracts/anon-poll/src/lib.rs) uses it unchanged to give any DAO a secret ballot in about 150 lines.
- **A module any Sputnik DAO can install** with two proposals, moving no money and changing no multisig.
- **[Trezu templates](web/src/lib/trezu.mjs) for running a fund.** Any treasury on Trezu can file Tideover's proposals from a form instead of a command line.
- **[A sealed clerk](clerk/src/lib.rs) on OutLayer.** A pattern for letting a shared AI model read private documents: encrypt to a small enclave program rather than the model, let it take nothing from its caller but a claim number, and let a DAO pin its build. A shared model decrypts for anyone with an API key, so encrypting straight to it does not protect a document that ends up public.
- **Membership that needs no NEAR.** Gasless dues let people join who have never held a token.
- **Stablecoins from any chain.** The Member page shows live NEAR Intents quotes for dues from Solana, Base and Arbitrum. Intents has no testnet, so these do not execute here.

## Status

| Item | State |
|---|---|
| Contract tests, with real proofs and a simulated clerk | 94 pass |
| Sealed clerk tests | 18 pass |
| Membership library tests | 16 pass |
| Secret ballot example tests | 5 pass |
| Browser crypto and template tests | 18 pass |
| Browser proof accepted by the contract logic | Pass, golden test |
| Browser-sealed document opened by the clerk | Pass, golden test |
| Clerk's wasm run under wasmtime | Pass: keys match the browser code, refusals work, and it reaches a real RPC |
| All four contracts through NEAR's own wasm preparation at protocol 88 | Pass |
| Proof time in a real browser | 2.9 s |
| Live NEAR Intents quotes | Working for 3 chains |
| Deployed to testnet, real Sputnik DAO flow | Done. Claims paid on all three paths, and 10 attacks refused. See [the results](docs/TESTNET.md). |
| The real model on the sample documents | 4 of 4 read as expected, and the trick document was flagged. See [the results](docs/model-check.json). About $0.0008 a review at most. |
| A real review through the clerk, on chain | Done in OutLayer's enclave, claim #5 |
| The clerk running in an OutLayer enclave | Done. The DAO pinned the build, and the Trust page compares it with OutLayer's record. See [the results](docs/TESTNET.md). |
| Checking the enclave's Intel quote with `outlayer-verify` | **Not run** |
| Gas on chain | Filing a claim 24.4 Tgas, posting a card up to 3.8 Tgas, paying dues 45.8 Tgas |
| The factory on testnet | **Not deployed.** The demo fund was created directly to save test NEAR |
| Opening the demo DAO in Trezu | **Not tested** |
| Trezu templates in Trezu | **Not tested.** Checked by reading its parser, not by running it |

## Limits

Written for the people it would protect, in full on the [Trust page](web/src/app/trust/page.tsx):

- **Small groups give less cover.** You are hidden among paid-up members at your tier or above.
- **Amounts and timing are public.** One member's claims within a year can be linked to each other, though not to them.
- **A sealed document sits in a public transaction on its way to the enclave**, as ciphertext only the clerk can open. Anyone who later obtained the clerk's key could read old documents.
- **You trust enclave hardware**, Intel TDX and NVIDIA. The clerk reaches the model over TLS and does not check its attestation itself yet.
- **A clerk on a server is not private.** Until a fund pins an enclave build, whoever runs its server could read a document, and the Trust page says so. The demo fund has pinned one.
- **Fraud is capped, not impossible.** AI cannot reliably spot a forged document. [The simulation](sim/solvency.mjs) shows what the limits do: over 10,000 three-year runs of a 40-member fund, one persistent cheat takes about 15% of dues, and honest members still receive 96% of the dollars they ask for. Four cheats take about 52%. These numbers rest on assumed catch rates. A fund of people who know each other is the real defence.
- **The zero-knowledge setup was run by one party**, and the contracts are unaudited. Do not use real money with this version.

## Run it yourself

Needs Rust with the `wasm32-unknown-unknown` and `wasm32-wasip2` targets, and Node 24 or later.

```bash
cargo test -p tideover-zk --features prover --release
```

```bash
cargo test -p tideover-fund -p tideover-factory -p tideover-clerk --release
```

```bash
cargo build -p tideover-fund -p tideover-factory -p tideover-test-usd --target wasm32-unknown-unknown --release
```

```bash
cargo build -p tideover-clerk --target wasm32-wasip2 --release
```

```bash
cd web && npm install && npm run dev
```

Then open <http://localhost:3100>. To deploy your own copy, see [docs/DEPLOY.md](docs/DEPLOY.md). On Windows, the Rust tests need the MSVC toolchain, because near-sdk's test harness links C code.

## Built with

near-sdk, near-api-js, arkworks, OutLayer, NEAR AI Cloud, Next.js, `@noble` cryptography, wasm-bindgen, curve25519-dalek, ed25519-dalek, chacha20poly1305, pdf.js.

- The Poseidon parameters, tree, NEP-488 encodings and Groth16 verifier follow [Antumbra](https://github.com/Valentine1898/antumbra) (MIT), and `contracts/fund/src/groth16.rs` is adapted from it.
- The role pattern for acting inside a DAO follows [Petty Cash](https://github.com/kasbsquall/petty-cash) (MIT).

All code here was written during the hackathon window, with AI assistance (Claude Code).

## Licence

MIT. See [LICENSE](LICENSE).
