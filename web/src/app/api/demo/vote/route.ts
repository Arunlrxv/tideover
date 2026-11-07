// Lets a visitor act for a demo panelist or council member. The key behind this
// can do nothing but vote, and only on demo accounts.
import { NextResponse } from "next/server";
import { getProposal } from "@/lib/chain";
import { D } from "@/lib/config";
import { allow, clientIp, fail, guarded } from "@/lib/server/http";
import { demoAccount, send } from "@/lib/server/near";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  return guarded(async () => {
    if (!allow(`vote:${clientIp(req)}`, 20)) return fail("Too many votes. Wait a minute.", 429);
    const b = await req.json();
    if (b.kind === "panel") {
      if (typeof b.account !== "string" || typeof b.claimId !== "string") return fail("Malformed vote");
      const { hash } = await send(demoAccount(b.account), D.fund, "panel_vote", { claim_id: b.claimId, approve: Boolean(b.approve) }, { tgas: 30 });
      return NextResponse.json({ hash });
    }
    if (b.kind === "council") {
      if (!D.council.includes(b.account)) return fail("Not a council member");
      const proposal = await getProposal(D.dao, Number(b.proposalId));
      const { hash } = await send(
        demoAccount(b.account),
        D.dao,
        "act_proposal",
        { id: proposal.id, action: b.approve ? "VoteApprove" : "VoteReject", proposal: proposal.kind },
        { tgas: 300 },
      );
      return NextResponse.json({ hash });
    }
    return fail("Unknown vote");
  });
}
