# Deploying

These steps build a demo community on NEAR testnet. A real install on an existing DAO is only two proposals, shown on the app's Install page.

## You need

- About 33 test NEAR.
- `NEAR_AI_API_KEY` from [cloud.near.ai](https://cloud.near.ai), if you want the sealed reader on. Without it, claims go to people after the review window.

## Deploy the community

Build the contracts. Plain `cargo` output is accepted from protocol 84 on, which added bulk memory and reference types. Mainnet and testnet are at 88.

```bash
cargo build -p tideover-fund -p tideover-factory -p tideover-test-usd --target wasm32-unknown-unknown --release
```

Create the master account. It waits out the faucet's rate limit by itself:

```bash
cd web && node scripts/bootstrap-account.mjs tideover-hq.testnet
```

Top the account up to about 33 NEAR at [near-faucet.io](https://near-faucet.io/), then deploy. Each step is recorded in `.testnet/secrets.json`, so a failed run can be repeated safely:

```bash
cd web && node scripts/deploy.mjs
```

This writes `web/src/deployment.json`, which is public, and `web/.env.local`, which holds keys and is ignored by git.

Run the real flow. With `NEAR_AI_API_KEY` set, the model reads each document. Without it, a fixed test card proves everything on chain except the model, and the report says which it was:

```bash
cd web && npm run e2e
```

## Move the clerk into an enclave

The deployment starts with the clerk on the demo's server, which could read a document, and the Trust page says so. To make it private, put the clerk on [OutLayer](https://outlayer.ai). The build serves funds of one factory, set by `FACTORY` in `clerk/src/lib.rs`, so a copy under another account needs its own build. This path has not been run yet, so read its output as it goes.

Build it:

```bash
cargo build -p tideover-clerk --target wasm32-wasip2 --release
```

Then, with `NEAR_AI_API_KEY` in `web/.env.local`:

```bash
cd web && node scripts/deploy.mjs enclave
```

That script does four things, as the relay:

1. Publishes the build on FastFS.
2. Stores its secrets against the build's sha256. The seed is generated in the keystore's enclave, so nobody ever sees it, and only the relay can run the build with it.
3. Runs the build once to read its public keys, and checks it carries this repository's prompt.
4. Pins the keys and the build hash through a DAO vote, and rewrites `web/.env.local`. The server no longer holds a seed after this.

Each review then pays for one OutLayer run from the relay's NEAR.

## Open the demo DAO in Trezu

Trezu's hosted app and backend are mainnet-only, but its frontend can open a testnet DAO through a local mock backend. These steps come from its README and have not been run against this DAO yet. In a checkout of [NEAR-DevHub/trezu](https://github.com/NEAR-DevHub/trezu), in `nt-fe`:

```bash
bun run testnet:mock
```

Then, in a second terminal:

```bash
NEXT_PUBLIC_NEAR_NETWORK=testnet NEXT_PUBLIC_NEAR_RPC_URL=https://rpc.testnet.fastnear.com NEXT_PUBLIC_BACKEND_API_BASE=http://127.0.0.1:8889 bun run dev
```

Open `http://localhost:3000/harbor-mutual.sputnikv2.testnet/requests`. A claim that reached the council should appear as a payment request titled with its claim number. Assets and activity stay empty for testnet DAOs, because there is no indexer.

## Hosting

The app is a standard Next.js project. Deploy `web/` to any host and set the variables from `web/.env.example`. All keys are testnet keys, and the demo key can only vote.

## After changing the clerk or its prompt

Any change makes a new build with a new hash, and that build cannot read the old seed. Run `deploy.mjs enclave` again. Documents sealed to the old key can no longer be read, so claims in review at that moment go to people.

## After changing the circuit or the sealed format

Regenerate the keys, the browser prover and the golden fixtures, in this order, and redeploy, because the verifying key is compiled into the contract:

```bash
cargo run -p tideover-zk --bin tideover-setup --release --features parallel
```

```powershell
./scripts/build-wasm.ps1
```

```bash
cd web && node scripts/make-fixtures.mjs
```
