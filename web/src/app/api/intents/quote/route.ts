// A live NEAR Intents quote, with `dry: true`, so nothing moves. Intents has no
// testnet, so the demo shows a real mainnet price without executing it.
import { NextResponse } from "next/server";
import { allow, clientIp, fail, guarded } from "@/lib/server/http";

export const runtime = "nodejs";

const EVM_REFUND = "0x000000000000000000000000000000000000dEaD";

const ROUTES: Record<string, { label: string; originAsset: string; refundTo: string }> = {
  solana: {
    label: "USDC on Solana",
    originAsset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
    refundTo: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  },
  base: {
    label: "USDC on Base",
    originAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
    refundTo: EVM_REFUND,
  },
  arbitrum: {
    label: "USDC on Arbitrum",
    originAsset: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
    refundTo: EVM_REFUND,
  },
};

const NEAR_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

export async function GET(req: Request) {
  return guarded(async () => {
    if (!allow(`quote:${clientIp(req)}`, 20)) return fail("Too many quotes. Wait a minute.", 429);
    const route = ROUTES[new URL(req.url).searchParams.get("from") ?? "solana"];
    if (!route) return fail("Unknown route");
    const res = await fetch("https://1click.chaindefuser.com/v0/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dry: true,
        swapType: "EXACT_OUTPUT",
        slippageTolerance: 100,
        originAsset: route.originAsset,
        depositType: "ORIGIN_CHAIN",
        destinationAsset: NEAR_USDC,
        amount: "10000000",
        refundTo: route.refundTo,
        refundType: "ORIGIN_CHAIN",
        recipient: "tideover-demo.near",
        recipientType: "DESTINATION_CHAIN",
        deadline: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    });
    const j = await res.json();
    if (!res.ok) return fail(j.message ?? "No quote available", 502);
    return NextResponse.json({ label: route.label, amountIn: j.quote?.amountInFormatted, timeEstimate: j.quote?.timeEstimate });
  });
}
