// Creates a demo member, so someone can try the fund without a wallet. The browser
// makes the key and the member secret; this route only ever sees the public halves.
// A real fund admits members through its DAO instead.
import { NextResponse } from "next/server";
import { KeyPair, PublicKey, actions, nearToYocto } from "near-api-js";
import { D } from "@/lib/config";
import { allow, clientIp, fail, guarded, isHex } from "@/lib/server/http";
import { joinerAccount, need, readOutcome, relayAccount, send } from "@/lib/server/near";

export const runtime = "nodejs";
export const maxDuration = 60;

const NAMES = ["rosa", "ifa", "lena", "mateo", "noor", "oskar", "priya", "quan", "sana", "tariq", "uma", "yara", "zane", "kofi", "mina", "joao"];

export async function POST(req: Request) {
  return guarded(async () => {
    if (!allow(`join:${clientIp(req)}`, 4)) return fail("Too many new members from here. Wait a minute.", 429);
    const { publicKey, commitment } = await req.json();
    if (typeof publicKey !== "string" || !publicKey.startsWith("ed25519:")) return fail("Bad key");
    if (!isHex(commitment, 32)) return fail("Bad commitment");

    const joiner = joinerAccount();
    const label = `${NAMES[Math.floor(Math.random() * NAMES.length)]}-${Math.floor(1000 + Math.random() * 9000)}`;
    const account = `${label}.${joiner.accountId}`;
    const demoPub = KeyPair.fromString(need("TIDEOVER_DEMO_KEY") as `ed25519:${string}`).getPublicKey();

    const created = await joiner.signAndSendTransaction({
      receiverId: account,
      actions: [
        actions.createAccount(),
        actions.transfer(BigInt(nearToYocto("0.01"))),
        actions.addFullAccessKey(PublicKey.fromString(publicKey)),
        actions.addFunctionCallAccessKey(demoPub, D.fund, ["panel_vote"], BigInt(nearToYocto("0.25"))),
      ],
      waitUntil: "FINAL",
      throwOnFailure: false,
    });
    readOutcome(created as never);

    const relay = relayAccount();
    await send(relay, D.fund, "admit", { account, prior_periods: 12, commitment });
    await send(relay, D.token, "mint", { account_id: account, amount: "100000000" });
    return NextResponse.json({ account });
  });
}
