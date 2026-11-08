# Deploying

These steps build a demo community on NEAR testnet. A real install on an existing DAO is only two proposals, shown on the app's Install page.

## You need

- About 12 test NEAR. Most of it locks contract storage: 5.5 for the DAO, 3.7 for the fund and 1.5 for the token. Adding the factory later takes about 5 more.
- `NEAR_AI_API_KEY` from the API Keys page at [cloud.near.ai](https://cloud.near.ai), if you want the sealed reader on. It starts with `sk-`. Without it, claims go to people after the review window. `npm run model-check` tries it on the sample documents before anything is deployed.

## Deploy the community

Build the contracts as small as they go, because every kilobyte locks 0.01 NEAR. Output from current Rust is accepted from protocol 84 on, which added bulk memory and reference types. Mainnet and testnet are at 88.

```bash
cd web && npm run build:contracts
```

Create the master account. It waits out the faucet's rate limit by itself:

```bash
cd web && node scripts/bootstrap-account.mjs tideover-hq.testnet
```

The faucet's new account holds less than that, so top it up from [near-faucet.io](https://near-faucet.io/), which gives 2 NEAR a request, or send test NEAR from another account. The script also prints an implicit address, and anything sent there is moved across when you deploy. Each step is recorded in `.testnet/secrets.json`, so a run that stops for lack of funds can be repeated safely:

```bash
cd web && node scripts/deploy.mjs
```

This writes `web/src/deployment.json`, which is public, and `web/.env.local`, which holds keys and is ignored by git.

To save test NEAR, this creates the demo fund directly, the way the factory does: same account name, same code, no keys. To add the factory, so that any DAO can install a fund with the Install page's proposals:

```bash
cd web && node scripts/deploy.mjs factory
```

Run the real flow. A fixed test card proves everything on chain except the model, so this spends no credits, and the report says which it was. Add `-- --model` to have the real model read each document, which is two requests for a full run:

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
2. Stores its secrets against the build's sha256. Your `NEAR_AI_API_KEY` leaves your machine only encrypted to the keystore's enclave. The seed is generated in that enclave, so nobody ever sees it, and only the relay can run the build with it.
3. Runs the build once to read its public keys, and checks it carries this repository's prompt.
4. Pins the keys and the build hash through a DAO vote, and rewrites `web/.env.local`. The server no longer holds a seed after this.

Each review then pays for one OutLayer run from the relay's NEAR, about 0.002. The relay needs about 0.35 NEAR free at that moment, because the call holds its gas up front.

`scripts/e2e.mjs` signs cards with the server clerk's key, so it only works before this step. Once an enclave build is pinned, only the enclave can sign a card the contract accepts.

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

The app is a standard Next.js project. Deploy `web/` to any host and set the variables from `web/.env.example`. All keys are testnet keys, and the demo key can only vote. Reviews stop at `TIDEOVER_MAX_REVIEWS_PER_DAY`, 40 by default, and claims then go to people, so visitors can't drain the NEAR AI balance.

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
