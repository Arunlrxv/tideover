// Creates the project's master testnet account from the public faucet, using a key
// generated here. The faucet limits each network address, so this sleeps until the
// limit resets rather than asking again and again.
//
//   node scripts/bootstrap-account.mjs [account.testnet]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KeyPair } from "near-api-js";
import { ROOT, log, provider } from "./lib.mjs";

const HELPER = "https://helper.nearprotocol.com/account";
const ACCOUNT = process.argv[2] ?? "tideover-hq.testnet";
const KEY_FILE = join(ROOT, ".testnet", "funder.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(KEY_FILE)) {
  const k = KeyPair.fromRandom("ed25519");
  writeFileSync(KEY_FILE, JSON.stringify({ account: Buffer.from(k.getPublicKey().data).toString("hex"), key: k.toString() }));
}
const { key } = JSON.parse(readFileSync(KEY_FILE, "utf8"));
const publicKey = KeyPair.fromString(key).getPublicKey().toString();

async function exists() {
  try {
    await provider.viewAccount({ accountId: ACCOUNT });
    return true;
  } catch {
    return false;
  }
}

for (;;) {
  if (await exists()) {
    log(`${ACCOUNT} exists`);
    break;
  }
  const res = await fetch(HELPER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newAccountId: ACCOUNT, newAccountPublicKey: publicKey }),
  });
  if (res.status === 429) {
    const wait = Number(res.headers.get("retry-after") ?? 1800);
    log(`rate limited; sleeping ${Math.round(wait / 60)} minutes`);
    await sleep((Math.min(wait, 86_400) + 30) * 1000);
    continue;
  }
  if (!res.ok) {
    log(`faucet answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await sleep(900_000);
    continue;
  }
  log("faucet accepted the request");
  await sleep(5000);
}
