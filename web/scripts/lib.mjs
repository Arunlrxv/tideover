// Shared helpers for the deployment and end-to-end scripts.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, FailoverRpcProvider, JsonRpcProvider, actions, nearToYocto, teraToGas } from "near-api-js";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..", "..");
export const WASM_DIR = join(ROOT, "target", "wasm32-unknown-unknown", "release");
export const DEPLOYMENT = join(ROOT, "web", "src", "deployment.json");
export const SECRETS = join(ROOT, ".testnet", "secrets.json");

export const provider = new FailoverRpcProvider(
  ["https://rpc.testnet.fastnear.com", "https://test.rpc.fastnear.com", "https://near-testnet.drpc.org"].map(
    (url) => new JsonRpcProvider({ url }, { retries: 2, wait: 400, backoff: 2 }),
  ),
);

export const USD = 1_000_000n;
export const near = (n) => BigInt(nearToYocto(String(n)));
export { actions, teraToGas };

/** This project's own key, created by near-cli, for this project's own account. */
export function keyFor(accountId) {
  const path = join(homedir(), ".near-credentials", "testnet", `${accountId}.json`);
  return JSON.parse(readFileSync(path, "utf8")).private_key;
}

export const accountOf = (id, key = keyFor(id)) => new Account(id, provider, key);

export async function view(contractId, method, args = {}) {
  return provider.callFunction({ contractId, method, args });
}

export function failureText(failure) {
  const s = JSON.stringify(failure);
  return (s.match(/panicked: ([^"\\]+)/)?.[1] ?? s.match(/"ExecutionError":"([^"]+)/)?.[1] ?? s).slice(0, 400);
}

/** Sends one call, and returns its value. Throws a readable error if any receipt failed. */
export async function call(acct, receiverId, method, args = {}, { deposit = 0n, tgas = 100 } = {}) {
  const r = await acct.signAndSendTransaction({
    receiverId,
    actions: [actions.functionCall(method, args, teraToGas(tgas), deposit)],
    waitUntil: "FINAL",
    throwOnFailure: false,
  });
  return outcome(r);
}

export function outcome(r) {
  const failed = [r.transaction_outcome, ...(r.receipts_outcome ?? [])].find((o) => o?.outcome?.status?.Failure);
  if (r.status?.Failure || failed) {
    const err = new Error(failureText(r.status?.Failure ?? failed.outcome.status.Failure));
    err.hash = r.transaction?.hash;
    throw err;
  }
  let value;
  if (r.status?.SuccessValue) {
    const s = Buffer.from(r.status.SuccessValue, "base64").toString();
    try {
      value = JSON.parse(s);
    } catch {
      value = s;
    }
  }
  const burnt = (r.receipts_outcome ?? []).reduce((sum, o) => sum + Number(o.outcome.gas_burnt), Number(r.transaction_outcome?.outcome?.gas_burnt ?? 0));
  return { hash: r.transaction?.hash, value, tgas: Math.round(burnt / 1e11) / 10, logs: (r.receipts_outcome ?? []).flatMap((o) => o.outcome.logs) };
}

export function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

export const wasm = (name) => readFileSync(join(WASM_DIR, name));

export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
