// Files a claim. The proof authorises it, and the amount, payout and evidence are
// bound into that proof, so this relay can submit it but cannot change it.
import { NextResponse } from "next/server";
import { D } from "@/lib/config";
import { allow, clientIp, fail, guarded, isHex } from "@/lib/server/http";
import { relayAccount, send } from "@/lib/server/near";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return guarded(async () => {
    if (!allow(`claim:${clientIp(req)}`, 12)) return fail("Too many attempts. Wait a minute.", 429);
    const b = await req.json();
    if (!isHex(b.proof, 384) || !isHex(b.root, 32) || !isHex(b.nullifier, 32) || !isHex(b.evidence_sha256, 32)) return fail("Malformed claim");
    if (typeof b.amount !== "string" || !/^\d+$/.test(b.amount) || typeof b.payout !== "string") return fail("Malformed claim");
    const { value, hash } = await send(
      relayAccount(),
      D.fund,
      "file_claim",
      {
        proof: b.proof,
        root: b.root,
        period: Number(b.period),
        min_tier: Number(b.min_tier),
        nullifier: b.nullifier,
        amount: b.amount,
        payout: b.payout,
        evidence_sha256: b.evidence_sha256,
      },
      { tgas: 120 },
    );
    return NextResponse.json({ id: value, hash });
  });
}
