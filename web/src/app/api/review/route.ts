// Passes a sealed document to the clerk. The route checks what it can for free first,
// because every run costs real credit. The clerk checks all of it again itself.
import { NextResponse } from "next/server";
import { getClaim, getFund } from "@/lib/chain";
import { D } from "@/lib/config";
import { MAX_ENVELOPE_CHARS, sha256hex } from "@/lib/sealed.mjs";
import { clerkMode, runClerk } from "@/lib/server/clerk";
import { allow, clientIp, fail, guarded, isHex } from "@/lib/server/http";

export const runtime = "nodejs";
export const maxDuration = 120;

const reviewed = new Set<string>();

// Each review spends real credit, so visitors to a public demo can't drain the balance.
// This counts per server instance, which is enough to stop a run on the account.
const MAX_REVIEWS_PER_DAY = Number(process.env.TIDEOVER_MAX_REVIEWS_PER_DAY ?? 40);
let today = "";
let usedToday = 0;

function spendOne() {
  const date = new Date().toISOString().slice(0, 10);
  if (date !== today) {
    today = date;
    usedToday = 0;
  }
  if (usedToday >= MAX_REVIEWS_PER_DAY) return false;
  usedToday += 1;
  return true;
}

export async function GET() {
  return NextResponse.json({ mode: clerkMode() });
}

export async function POST(req: Request) {
  return guarded(async () => {
    if (!clerkMode()) return fail("The sealed reader is not switched on for this demo. The claim will go to people.", 503, { readerOff: true });
    if (!allow(`review:${clientIp(req)}`, 6)) return fail("Too many attempts. Wait a minute.", 429);

    const { claimId, envelope } = await req.json();
    if (typeof claimId !== "string" || !/^\d+$/.test(claimId)) return fail("Bad claim id");
    if (!isHex(envelope) || envelope.length > MAX_ENVELOPE_CHARS) return fail("Bad envelope");

    const [claim, fund] = await Promise.all([getClaim(claimId), getFund()]);
    if (!claim || claim.status !== "AwaitingReview") return fail("This claim is not waiting for a review", 409);
    if (!fund.reviewer) return fail("The DAO has not pinned a clerk", 409);
    if (sha256hex(envelope) !== claim.evidence_sha256) return fail("This is not the document the claim committed to", 409);
    if (reviewed.has(claimId)) return fail("This claim has already been sent to the reader", 409);
    if (!spendOne()) return fail("The sealed reader has used today's budget. The claim will go to people.", 503, { readerOff: true });

    reviewed.add(claimId);
    try {
      return NextResponse.json(await runClerk({ fund: D.fund, claim: claimId, envelope }));
    } catch (e) {
      reviewed.delete(claimId);
      throw e;
    }
  });
}
