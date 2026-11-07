# Deploying

These steps build a demo community on NEAR testnet. A real install on an existing DAO is only two proposals, shown on the app's Install page.

## You need

- About 30 test NEAR.
- `NEAR_AI_API_KEY` from [cloud.near.ai](https://cloud.near.ai), if you want the sealed reader on. Without it, claims go to people after the review window.

## Steps

Build the contracts:

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

Run the real flow:

```bash
cd web && npm run e2e
```

## Hosting

The app is a standard Next.js project. Deploy `web/` to any host and set the variables from `web/.env.example`. All keys are testnet keys, and the demo key can only vote.

## If the model's key changes

NEAR AI can rotate an enclave key. The Trust page shows when the pinned key and the attested key differ. Re-pin it through a DAO vote:

```bash
cd web && node scripts/deploy.mjs reviewer
```

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
