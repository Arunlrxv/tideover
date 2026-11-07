// The enclave key NEAR AI attests to right now, so the Trust page can compare it with
// the key the DAO pinned. This endpoint is public and needs no API key.
import { NextResponse } from "next/server";
import { fail, guarded } from "@/lib/server/http";
import { MODEL } from "@/lib/sealed.mjs";

export const runtime = "nodejs";

export async function GET() {
  return guarded(async () => {
    const res = await fetch(`https://cloud-api.near.ai/v1/attestation/report?model=${encodeURIComponent(MODEL)}&signing_algo=ed25519`);
    if (!res.ok) return fail("Attestation report unavailable", 502);
    const report = await res.json();
    const live = report.model_attestations?.[0];
    const attested = (live?.signing_public_key ?? live?.signing_address ?? "").replace(/^0x/, "");
    return NextResponse.json({ attested });
  });
}
