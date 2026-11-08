// Asks the testnet faucet contract behind near-faucet.io for NEAR, directly, as the
// project's own account. It allows one request per receiver every so often.
//
//   node scripts/faucet.mjs [NEAR, default 2]
import { accountOf, call, log, near, provider } from "./lib.mjs";

const MASTER = process.env.TIDEOVER_MASTER ?? "tideover-hq.testnet";
const FAUCET = "v2.faucet.nonofficial.testnet";
const amount = process.argv[2] ?? "2";

const balance = async () => BigInt((await provider.viewAccount({ accountId: MASTER })).amount);
const before = await balance();
try {
  const o = await call(accountOf(MASTER), FAUCET, "request_near", { request_amount: String(near(amount)), receiver_id: MASTER }, { tgas: 50 });
  log("faucet transaction", o.hash);
} catch (e) {
  log("the faucet refused:", e.message);
  process.exitCode = 1;
}
const after = await balance();
log("balance", Number(after / 10n ** 21n) / 1000, "NEAR, change", Number((after - before) / 10n ** 21n) / 1000);
