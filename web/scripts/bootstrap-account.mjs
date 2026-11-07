// Creates the project's master testnet account, in whichever of two ways comes first:
//
//   - someone sends test NEAR to the project's implicit address, printed below, and
//     this script turns that into the named account;
//   - the public faucet's rate limit resets, and the faucet creates it.
//
//   node scripts/bootstrap-account.mjs [account.testnet]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Account, KeyPair } from "near-api-js";
import { ROOT, actions, log, near, outcome, provider, teraToGas } from "./lib.mjs";

const HELPER = "https://helper.nearprotocol.com/account";
const ACCOUNT = process.argv[2] ?? "tideover-hq.testnet";
const KEY_FILE = join(ROOT, ".testnet", "funder.json");
const CHECK_EVERY_MS = 300_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(KEY_FILE)) {
  const k = KeyPair.fromRandom("ed25519");
  writeFileSync(KEY_FILE, JSON.stringify({ account: Buffer.from(k.getPublicKey().data).toString("hex"), key: k.toString() }));
}
const { account: implicit, key } = JSON.parse(readFileSync(KEY_FILE, "utf8"));
const publicKey = KeyPair.fromString(key).getPublicKey().toString();
log("waiting for funds at", implicit);

async function balanceOf(accountId) {
  try {
    const a = await provider.viewAccount({ accountId });
    return BigInt(a.amount);
  } catch {
    return null;
  }
}

/** Spends the implicit address's NEAR on creating the named account. */
async function createFromImplicit(balance) {
  const deposit = balance - near("0.05");
  const r = await new Account(implicit, provider, key).signAndSendTransaction({
    receiverId: "testnet",
    actions: [actions.functionCall("create_account", { new_account_id: ACCOUNT, new_public_key: publicKey }, teraToGas(100), deposit)],
    throwOnFailure: false,
  });
  outcome(r);
}

let helperAllowedAt = 0;

for (;;) {
  if ((await balanceOf(ACCOUNT)) !== null) {
    log(`${ACCOUNT} exists`);
    break;
  }
  const funded = await balanceOf(implicit);
  if (funded !== null && funded >= near(1)) {
    log("the implicit address is funded; creating the named account from it");
    await createFromImplicit(funded);
    continue;
  }
  if (Date.now() >= helperAllowedAt) {
    const res = await fetch(HELPER, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newAccountId: ACCOUNT, newAccountPublicKey: publicKey }),
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? 1800);
      helperAllowedAt = Date.now() + (wait + 30) * 1000;
      log(`faucet rate limited for ${Math.round(wait / 60)} minutes`);
    } else if (!res.ok) {
      helperAllowedAt = Date.now() + 900_000;
      log(`faucet answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    } else {
      log("faucet accepted the request");
      await sleep(5000);
      continue;
    }
  }
  await sleep(CHECK_EVERY_MS);
}
