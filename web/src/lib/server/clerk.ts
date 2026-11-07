// Runs the clerk. On OutLayer it runs in an enclave, and this server only carries a
// ciphertext it can't open. Without an enclave build, the same steps run here, and
// this server could read what it opens. /api/review says which one a fund is using.
import { actions, teraToGas } from "near-api-js";
import { MODEL_URL, clerkKeys, review } from "../clerk.mjs";
import { view } from "../chain";
import { provider, readOutcome, relayAccount, need } from "./near";
import type { Card } from "../types";

const OUTLAYER = "outlayer.testnet";
const LIMITS = { max_instructions: 20_000_000_000, max_memory_mb: 128, max_execution_seconds: 100 };

export type ClerkMode = "enclave" | "server";
type Input = { fund: string; claim: string; envelope: string };
type Output = { card: Card; signature: string };

export function clerkMode(): ClerkMode | null {
  if (process.env.TIDEOVER_CLERK_WASM_URL && process.env.TIDEOVER_CLERK_WASM_HASH) return "enclave";
  if (process.env.TIDEOVER_CLERK_SEED && process.env.NEAR_AI_API_KEY) return "server";
  return null;
}

/** Waits for the run to finish. An RPC gives up long before a model does, so this polls. */
async function outcomeOf(txHash: string, accountId: string) {
  for (let i = 0; i < 55; i++) {
    await new Promise((done) => setTimeout(done, 2000));
    const r = await provider.viewTransactionStatus({ txHash, accountId, waitUntil: "FINAL" }).catch(() => null);
    if (r) return r;
  }
  throw new Error("The clerk did not finish in time");
}

async function inEnclave(input: Input): Promise<Output> {
  const relay = relayAccount();
  const input_data = JSON.stringify({ action: "review", ...input });
  const deposit = await provider.callFunction({
    contractId: OUTLAYER,
    method: "estimate_execution_cost",
    args: { resource_limits: LIMITS, input_len: input_data.length },
  });
  const sent = await relay.signAndSendTransaction({
    receiverId: OUTLAYER,
    actions: [
      actions.functionCall(
        "request_execution",
        {
          source: {
            WasmUrl: {
              url: need("TIDEOVER_CLERK_WASM_URL"),
              hash: need("TIDEOVER_CLERK_WASM_HASH"),
              build_target: "wasm32-wasip2",
            },
          },
          resource_limits: LIMITS,
          input_data,
          secrets_ref: { profile: "clerk", account_id: relay.accountId },
          response_format: "Json",
          payer_account_id: relay.accountId,
        },
        teraToGas(300),
        BigInt(String(deposit)),
      ),
    ],
    waitUntil: "INCLUDED",
    throwOnFailure: false,
  });
  const txHash = (sent as unknown as { transaction: { hash: string } }).transaction.hash;
  const { value } = readOutcome((await outcomeOf(txHash, relay.accountId)) as never);
  const out = value as Output & { error?: string };
  if (out?.error) throw new Error(`The clerk refused: ${out.error}`);
  if (!out?.card || !out.signature) throw new Error("The clerk gave no card");
  return out;
}

function onServer(input: Input): Promise<Output> {
  return review(input, {
    keys: clerkKeys(need("TIDEOVER_CLERK_SEED")),
    view: (method, args) => view<unknown>(input.fund, method, args),
    askModel: async (body) => {
      const res = await fetch(MODEL_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${need("NEAR_AI_API_KEY")}`, "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) throw new Error(`The model answered with an error (${res.status})`);
      return res.text();
    },
  });
}

export const runClerk = (input: Input) => (clerkMode() === "enclave" ? inEnclave(input) : onServer(input));
