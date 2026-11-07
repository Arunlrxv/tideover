// What the Trust page checks live. OutLayer's public record says which build ran when
// the clerk printed its keys, the chain holds what that run printed, and NEAR AI's
// public report covers the model it calls. None of this needs an API key.
import { NextResponse } from "next/server";
import { D } from "@/lib/config";
import { MODEL } from "@/lib/sealed.mjs";
import { guarded } from "@/lib/server/http";
import { provider, readOutcome } from "@/lib/server/near";

export const runtime = "nodejs";

const OUTLAYER_API = "https://testnet-api.outlayer.ai";

async function clerkBuild() {
  if (!D.clerk?.keysTx) return null;
  const res = await fetch(`${OUTLAYER_API}/attestations/by-tx/${D.clerk.keysTx}`);
  if (!res.ok) return null;
  const j = await res.json();
  return (j.wasm_hash ?? j.attestation?.wasm_hash ?? null) as string | null;
}

/** The keys the attested run printed, read from its transaction and not from this app. */
async function clerkKeys() {
  if (!D.clerk?.keysTx || !D.clerk.keysSender) return null;
  const tx = await provider.viewTransactionStatus({ txHash: D.clerk.keysTx, accountId: D.clerk.keysSender, waitUntil: "FINAL" });
  return readOutcome(tx as never).value as { signer: string; encryption_key: string };
}

async function modelAttested() {
  const res = await fetch(`https://cloud-api.near.ai/v1/attestation/report?model=${encodeURIComponent(MODEL)}&signing_algo=ed25519`);
  if (!res.ok) return false;
  const report = await res.json();
  return Boolean(report.model_attestations?.length);
}

export async function GET() {
  return guarded(async () => {
    const [build, keys, model] = await Promise.all([clerkBuild().catch(() => null), clerkKeys().catch(() => null), modelAttested().catch(() => false)]);
    return NextResponse.json({ build, keys, model, tx: D.clerk?.keysTx ?? null });
  });
}
