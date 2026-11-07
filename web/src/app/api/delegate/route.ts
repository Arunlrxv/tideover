// Gasless member actions (NEP-366). The member signs a delegate action and the relay
// pays the gas, so someone can join a fund without ever holding NEAR. The protocol
// rejects any change to what they signed, so this route only decides what it will pay for.
import { NextResponse } from "next/server";
import { deserialize } from "borsh";
import { SCHEMA, actions, encodeSignedDelegate } from "near-api-js";
import { D } from "@/lib/config";
import { allow, clientIp, fail, guarded } from "@/lib/server/http";
import { readOutcome, relayAccount } from "@/lib/server/near";

export const runtime = "nodejs";

type Decoded = {
  delegateAction: {
    senderId: string;
    receiverId: string;
    actions: { functionCall?: { methodName: string; args: Uint8Array }; enum?: string }[];
  };
};

const ALLOWED: Record<string, string[]> = {
  [D.token]: ["ft_transfer_call"],
  [D.fund]: ["panel_vote", "register"],
};

export async function POST(req: Request) {
  return guarded(async () => {
    if (!allow(`delegate:${clientIp(req)}`, 20)) return fail("Too many attempts. Wait a minute.", 429);
    const { signedDelegate } = await req.json();
    if (typeof signedDelegate !== "string" || signedDelegate.length > 4000) return fail("Malformed delegate");
    const bytes = Buffer.from(signedDelegate, "base64");
    let sd: Decoded;
    try {
      sd = deserialize(SCHEMA.SignedDelegate, bytes) as unknown as Decoded;
    } catch {
      return fail("Not a valid NEP-366 delegate");
    }
    if (encodeSignedDelegate(sd as never).length !== bytes.length) return fail("Delegate has trailing bytes");
    const { delegateAction: da } = sd;
    const methods = ALLOWED[da.receiverId];
    if (!methods || da.actions.length !== 1) return fail("The relay does not pay for this");
    const call = da.actions[0].functionCall;
    if (!call || !methods.includes(call.methodName)) return fail("The relay does not pay for this");
    if (call.methodName === "ft_transfer_call") {
      const args = JSON.parse(Buffer.from(call.args).toString());
      if (args.receiver_id !== D.fund || args.msg !== "dues") return fail("The relay only pays for dues");
    }
    const r = await relayAccount().signAndSendTransaction({
      receiverId: da.senderId,
      actions: [actions.signedDelegate(sd as never)],
      waitUntil: "FINAL",
      throwOnFailure: false,
    });
    const { hash } = readOutcome(r as never);
    return NextResponse.json({ hash });
  });
}
