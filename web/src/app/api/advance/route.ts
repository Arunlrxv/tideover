// Moves a claim to its next stage. Anyone may do this on chain; this route only pays the gas.
import { NextResponse } from "next/server";
import { D } from "@/lib/config";
import { allow, clientIp, fail, guarded } from "@/lib/server/http";
import { relayAccount, send } from "@/lib/server/near";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return guarded(async () => {
    if (!allow(`advance:${clientIp(req)}`, 30)) return fail("Too many attempts. Wait a minute.", 429);
    const { claimId } = await req.json();
    if (typeof claimId !== "string" || !/^\d+$/.test(claimId)) return fail("Bad claim id");
    const { hash } = await send(relayAccount(), D.fund, "advance", { claim_id: claimId }, { tgas: 300 });
    return NextResponse.json({ hash });
  });
}
