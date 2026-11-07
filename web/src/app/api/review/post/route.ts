// Posts a verdict. The contract checks everything, so this needs no trust at all.
import { NextResponse } from "next/server";
import { D } from "@/lib/config";
import { allow, clientIp, fail, guarded } from "@/lib/server/http";
import { relayAccount, send } from "@/lib/server/near";

export const runtime = "nodejs";

const FIELDS = ["signed_text", "signature", "system_envelope", "system_eph_secret", "evidence_envelope", "response_body", "verdict_key"];

export async function POST(req: Request) {
  return guarded(async () => {
    if (!allow(`post:${clientIp(req)}`, 12)) return fail("Too many attempts. Wait a minute.", 429);
    const b = await req.json();
    if (typeof b.claim_id !== "string" || FIELDS.some((f) => typeof b[f] !== "string")) return fail("Malformed review");
    const args: Record<string, string> = { claim_id: b.claim_id };
    for (const f of FIELDS) args[f] = b[f];
    const { value, hash } = await send(relayAccount(), D.fund, "post_review", args, { tgas: 200 });
    return NextResponse.json({ card: value, hash });
  });
}
