// Posts a clerk's card. The signature covers everything, so this needs no trust at all.
import { NextResponse } from "next/server";
import { D } from "@/lib/config";
import { allow, clientIp, fail, guarded, isHex } from "@/lib/server/http";
import { relayAccount, send } from "@/lib/server/near";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return guarded(async () => {
    if (!allow(`post:${clientIp(req)}`, 12)) return fail("Too many attempts. Wait a minute.", 429);
    const { claim_id, card, signature } = await req.json();
    if (typeof claim_id !== "string" || typeof card !== "object" || !card || !isHex(signature, 64)) return fail("Malformed card");
    const { hash } = await send(relayAccount(), D.fund, "post_card", { claim_id, card, signature }, { tgas: 100 });
    return NextResponse.json({ card, hash });
  });
}
