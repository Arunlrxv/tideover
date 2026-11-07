// Lets a visitor act for a demo panelist or council member. The key behind this
// can do nothing but vote, and only on demo accounts.
import { NextResponse } from "next/server";
import { actions, teraToGas } from "near-api-js";
import { getProposal } from "@/lib/chain";
import { D } from "@/lib/config";
import { allow, clientIp, fail, guarded } from "@/lib/server/http";
import { demoAccount, readOutcome, relayAccount, send } from "@/lib/server/near";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  return guarded(async () => {
    if (!allow(`vote:${clientIp(req)}`, 20)) return fail("Too many votes. Wait a minute.", 429);
    const b = await req.json();
    if (b.kind === "panel") {
      if (typeof b.account !== "string" || typeof b.claimId !== "string") return fail("Malformed vote");
      // Gasless, like a real member's vote: the voter holds no NEAR for fees.
      const { signedDelegate } = await demoAccount(b.account).createSignedMetaTransaction({
        receiverId: D.fund,
        actions: [actions.functionCall("panel_vote", { claim_id: b.claimId, approve: Boolean(b.approve) }, teraToGas(30), 0n)],
        blockHeightTtl: 120,
      });
      const r = await relayAccount().signAndSendTransaction({
        receiverId: b.account,
        actions: [actions.signedDelegate(signedDelegate)],
        waitUntil: "FINAL",
        throwOnFailure: false,
      });
      return NextResponse.json({ hash: readOutcome(r as never).hash });
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
