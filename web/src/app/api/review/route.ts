// Forwards an already-encrypted request to the enclave and adds the API key. It
// cannot read the document, or the answer: both are encrypted, the answer to a
// key that exists only in the member's browser.
import { NextResponse } from "next/server";
import { getClaim, getFund } from "@/lib/chain";
import { allow, clientIp, fail, guarded, isHex } from "@/lib/server/http";

export const runtime = "nodejs";
export const maxDuration = 120;

const API = "https://cloud-api.near.ai/v1";
const MAX_REQUEST_BYTES = 40_000;
const reviewed = new Set<string>();

export async function GET() {
  return NextResponse.json({ enabled: Boolean(process.env.NEAR_AI_API_KEY) });
}

export async function POST(req: Request) {
  return guarded(async () => {
    const apiKey = process.env.NEAR_AI_API_KEY;
    if (!apiKey) return fail("The sealed reader is not switched on for this demo. The claim will go to people.", 503, { readerOff: true });
    if (!allow(`review:${clientIp(req)}`, 6)) return fail("Too many attempts. Wait a minute.", 429);

    const { claimId, request, clientPub } = await req.json();
    if (typeof claimId !== "string" || !/^\d+$/.test(claimId)) return fail("Bad claim id");
    if (!isHex(clientPub, 32)) return fail("Bad client key");
    if (typeof request !== "string" || request.length > MAX_REQUEST_BYTES) return fail("Bad request");

    // Free checks first: each call to the model costs real credit.
    const [claim, fund] = await Promise.all([getClaim(claimId), getFund()]);
    if (!claim || claim.status !== "AwaitingReview") return fail("This claim is not waiting for a review", 409);
    if (!fund.reviewer) return fail("The DAO has not pinned a reader", 409);
    const parsed = JSON.parse(request);
    if (parsed.model !== fund.reviewer.model_id || parsed.stream !== false || parsed.messages?.length !== 2) return fail("Bad request shape");
    if (reviewed.has(claimId)) return fail("This claim has already been sent to the reader", 409);
    reviewed.add(claimId);

    const res = await fetch(`${API}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept-Encoding": "identity",
        "x-signing-algo": "ed25519",
        "x-client-pub-key": clientPub,
        "x-model-pub-key": fund.reviewer.signer,
        "x-encryption-version": "2",
        "x-no-aliasing": "true",
        "x-encrypt-all-fields": "true",
      },
      body: Buffer.from(request, "utf8"),
    });
    const responseBody = Buffer.from(await res.arrayBuffer()).toString("utf8");
    if (res.status !== 200) {
      reviewed.delete(claimId);
      return fail(`The reader answered with an error (${res.status})`, 502);
    }
    const chatId = JSON.parse(responseBody).id;
    let sig: { text: string; signature: string } | undefined;
    for (let i = 0; i < 10 && !sig; i++) {
      const r = await fetch(`${API}/signature/${chatId}?model=${encodeURIComponent(fund.reviewer.model_id)}&signing_algo=ed25519`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (r.ok) sig = await r.json();
      else await new Promise((done) => setTimeout(done, 2000));
    }
    if (!sig) return fail("The enclave's signature is not available", 502);
    return NextResponse.json({ responseBody, signedText: sig.text, signature: sig.signature.replace(/^0x/, "") });
  });
}
