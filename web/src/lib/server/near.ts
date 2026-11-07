// Server-only NEAR access. The relay submits what members have already authorised,
// and it pays the gas. It holds no member key and sees no plaintext.
import { Account, FailoverRpcProvider, JsonRpcProvider, actions, teraToGas } from "near-api-js";
import { RPCS } from "../config";

export const provider = new FailoverRpcProvider([RPCS[1], RPCS[0], RPCS[2]].map((url) => new JsonRpcProvider({ url }, { retries: 1, wait: 300, backoff: 2 })));

export function need(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set on this server`);
  return v;
}

type Key = `ed25519:${string}`;

export const relayAccount = () => new Account(need("TIDEOVER_RELAY_ACCOUNT"), provider, need("TIDEOVER_RELAY_KEY") as Key);
export const joinerAccount = () => new Account(need("TIDEOVER_JOINER_ACCOUNT"), provider, need("TIDEOVER_JOINER_KEY") as Key);
/** Signs for demo personas with a key that can only vote. */
export const demoAccount = (id: string) => new Account(id, provider, need("TIDEOVER_DEMO_KEY") as Key);

export function panicText(failure: unknown) {
  const s = JSON.stringify(failure);
  return (s.match(/panicked: ([^"\\]+)/)?.[1] ?? s.match(/"([A-Za-z]+Error[^"]*)"/)?.[1] ?? s).slice(0, 300);
}

export class ChainRefusal extends Error {
  hash?: string;
  constructor(message: string, hash?: string) {
    super(message);
    this.hash = hash;
  }
}

type Outcome = {
  transaction?: { hash: string };
  status?: { SuccessValue?: string; Failure?: unknown } | string;
  receipts_outcome?: { outcome: { status: { Failure?: unknown } } }[];
};

/** Finds a failure anywhere in the receipts: the top-level status can hide one. */
export function readOutcome(r: Outcome) {
  const status = typeof r.status === "object" ? r.status : undefined;
  const failed = r.receipts_outcome?.find((o) => o.outcome.status.Failure);
  if (status?.Failure || failed) throw new ChainRefusal(panicText(status?.Failure ?? failed?.outcome.status.Failure), r.transaction?.hash);
  let value: unknown;
  if (status?.SuccessValue) {
    const s = Buffer.from(status.SuccessValue, "base64").toString();
    try {
      value = JSON.parse(s);
    } catch {
      value = s;
    }
  }
  return { hash: r.transaction?.hash, value };
}

export async function send(
  account: Account,
  receiverId: string,
  method: string,
  args: Record<string, unknown>,
  { deposit = 0n, tgas = 100 }: { deposit?: bigint; tgas?: number } = {},
) {
  const r = await account.signAndSendTransaction({
    receiverId,
    actions: [actions.functionCall(method, args, teraToGas(tgas), deposit)],
    waitUntil: "FINAL",
    throwOnFailure: false,
  });
  return readOutcome(r as unknown as Outcome);
}
