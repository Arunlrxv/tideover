# Deploying

These steps build a demo community on NEAR testnet. A real install on an existing DAO is only two proposals, shown on the app's Install page.

## You need

- About 30 test NEAR.
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

Top the account up to about 30 NEAR at [near-faucet.io](https://near-faucet.io/), then deploy. Each step is recorded in `.testnet/secrets.json`, so a failed run can be repeated safely:

```bash
cd web && node scripts/deploy.mjs
```

This writes `web/src/deployment.json`, which is public, and `web/.env.local`, which holds keys and is ignored by git.

Run the real flow. With `NEAR_AI_API_KEY` set, the model reads each document. Without it, a fixed test card proves everything on chain except the model, and the report says which it was:

```bash
cd web && npm run e2e
```

## Move the clerk into an enclave

The deployment starts with the clerk on the demo's server, which could read a document, and the Trust page says so. To make it private, put the clerk on [OutLayer](https://outlayer.ai). These commands follow OutLayer's documentation. They have not been run yet, so check them against `outlayer --help` as you go.

Build it:

```bash
cargo build -p tideover-clerk --target wasm32-wasip2 --release
```

Upload the build and note its URL and sha256:

```bash
outlayer login testnet
```

```bash
outlayer upload target/wasm32-wasip2/release/tideover-clerk.wasm
```

Store the secrets. The seed is generated in the enclave and bound to this build, so nobody ever sees it. Use the relay's account, because the app asks for these secrets as the relay:

```bash
outlayer secrets set '{"NEAR_AI_API_KEY":"your key"}' --generate PROTECTED_CLERK_SEED:hex32 --wasm-hash <sha256> --access whitelist:relay.tideover-hq.testnet
```

Run the build once to read its keys, then pin them through a DAO vote:

```bash
cd web && node scripts/deploy.mjs enclave <url> <sha256>
```

That script checks the build carries this repository's prompt, and rewrites `web/.env.local`. The server no longer holds a seed after this, and the relay needs a little more NEAR, because each review pays for one OutLayer run.

## Hosting

The app is a standard Next.js project. Deploy `web/` to any host and set the variables from `web/.env.example`. All keys are testnet keys, and the demo key can only vote.

## After changing the clerk or its prompt

Any change makes a new build with a new hash, and that build cannot read the old seed. Upload it, store its secrets, and run `deploy.mjs enclave` again. Documents sealed to the old key stop being readable by the new build, so claims in review at that moment go to people.

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
