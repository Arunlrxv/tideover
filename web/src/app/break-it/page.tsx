"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getFund, getMember } from "@/lib/chain";
import { txUrl } from "@/lib/config";
import { toUnits, usd } from "@/lib/format";
import { api, fileClaim, freshPayout, loadMember, prepareClaim, type LocalMember, type Prepared } from "@/lib/member";
import { encryptTo, sha256hex } from "@/lib/sealed.mjs";
import type { FundView } from "@/lib/types";

type Outcome = { status: "running" | "refused" | "passed" | "error"; message?: string; hash?: string };

type Attack = {
  id: string;
  title: string;
  story: string;
  run: (m: LocalMember, fund: FundView) => Promise<{ hash?: string } | void>;
};

/** A real proof for a small claim, which each attack then tampers with. */
const honest = (m: LocalMember, dollars: number): Promise<Prepared> => prepareClaim(m, toUnits(dollars), freshPayout().account, "A short note.");

const file = (p: Prepared, patch: Partial<Prepared> = {}, proofPatch: Partial<Prepared["proof"]> = {}) =>
  fileClaim({ ...p, ...patch, proof: { ...p.proof, ...proofPatch } });

const ATTACKS: Attack[] = [
  {
    id: "amount",
    title: "Change the amount after proving",
    story: "A relay, or anyone who intercepts your claim, raises it from $20 to $30.",
    run: async (m) => file(await honest(m, 20), { amount: toUnits(30) }),
  },
  {
    id: "payout",
    title: "Redirect the payment",
    story: "Someone swaps the payout address for their own, keeping your valid proof.",
    run: async (m) => file(await honest(m, 20), { payout: freshPayout().account }),
  },
  {
    id: "evidence",
    title: "Swap the evidence",
    story: "Someone replaces the sealed document with one that would pass.",
    run: async (m, fund) => {
      const other = encryptTo(fund.reviewer!.signer, "A far better document.");
      return file(await honest(m, 20), { evidenceSha256: sha256hex(other.envelope) });
    },
  },
  {
    id: "tier",
    title: "Claim a higher tier",
    story: "You prove the lowest tier, then claim that you proved a higher one to unlock more cover.",
    run: async (m) => file(await honest(m, 20), {}, { min_tier: 2 }),
  },
  {
    id: "root",
    title: "Invent a member list",
    story: "You build your own tree of members, with yourself in it.",
    run: async (m) => file(await honest(m, 20), {}, { root: "22".repeat(32) }),
  },
  {
    id: "forge",
    title: "Forge the AI's verdict",
    story: "You write your own 'supported' verdict and post it for the newest claim.",
    run: async () => {
      const fund = await getFund();
      return api("/api/review/post", {
        claim_id: String(Math.max(0, fund.claims - 1)),
        signed_text: `${fund.reviewer?.model_id}:${"00".repeat(32)}:${"00".repeat(32)}`,
        signature: "11".repeat(64),
        system_envelope: "ab".repeat(80),
        system_eph_secret: "cd".repeat(32),
        evidence_envelope: "ef".repeat(80),
        response_body: "{}",
        verdict_key: "00".repeat(32),
      });
    },
  },
];

export default function BreakItPage() {
  const [me, setMe] = useState<LocalMember | null>(null);
  const [fund, setFund] = useState<FundView | null>(null);
  const [paidUp, setPaidUp] = useState(false);
  const [results, setResults] = useState<Record<string, Outcome>>({});

  useEffect(() => {
    const m = loadMember();
    setMe(m);
    getFund().then(setFund).catch(() => {});
    if (m) getMember(m.account).then((x) => setPaidUp(Boolean(x?.paid_this_period))).catch(() => {});
  }, []);

  async function run(a: Attack) {
    if (!me || !fund) return;
    setResults((r) => ({ ...r, [a.id]: { status: "running" } }));
    try {
      const out = await a.run(me, fund);
      setResults((r) => ({ ...r, [a.id]: { status: "passed", message: "It went through. This should not happen.", hash: out?.hash } }));
    } catch (e) {
      const err = e as Error & { refused?: boolean; hash?: string };
      setResults((r) => ({ ...r, [a.id]: { status: err.refused ? "refused" : "error", message: err.message, hash: err.hash } }));
    }
  }

  const ready = Boolean(me && fund && paidUp);

  return (
    <div className="page">
      <div className="wrap narrow">
        <p className="eyebrow">Attack lab</p>
        <h1>Try to break it.</h1>
        <p className="lede">
          Each button makes a real proof in your browser, tampers with it, and sends it to the live contract. What you see below
          is the contract&apos;s own refusal, with the failed transaction to prove it.
        </p>
        {!ready && (
          <div className="notice">
            You&apos;ll need a paid-up member first. <Link href="/member">Join the fund</Link>, pay dues, and come back.
          </div>
        )}
        {fund && (
          <p className="small muted">
            One thing you can&apos;t test here without spending your own claim: a second claim in the same cycle. Try it from{" "}
            <Link href="/claim">Ask for help</Link>, for any amount up to {usd(fund.rules.tiers[1].cap)}.
          </p>
        )}
        {ATTACKS.map((a) => {
          const r = results[a.id];
          return (
            <div className="card" key={a.id}>
              <h3>{a.title}</h3>
              <p className="muted">{a.story}</p>
              <button className="btn ghost small-btn" disabled={!ready || r?.status === "running"} onClick={() => run(a)}>
                {r?.status === "running" ? "Proving and sending…" : "Run it"}
              </button>
              {r?.status === "refused" && (
                <div className="notice">
                  <strong>The contract refused:</strong> {r.message}
                  {r.hash && (
                    <>
                      {" "}
                      <a href={txUrl(r.hash)}>See the failed transaction</a>
                    </>
                  )}
                </div>
              )}
              {r?.status === "passed" && <div className="notice bad">{r.message}</div>}
              {r?.status === "error" && <div className="notice warn">{r.message}</div>}
            </div>
          );
        })}
        <div className="card">
          <h3>What about tricking the AI itself?</h3>
          <p className="muted">
            On <Link href="/claim">Ask for help</Link>, pick &ldquo;A trick document&rdquo;. It tells the reader to approve the claim. Even
            if that worked on the model, the worst outcome is bounded: the amount is capped by your tier, the auto limit caps what can
            pay without people, and a guardian can stop it. The AI can only choose a path, and it never holds a key.
          </p>
        </div>
      </div>
    </div>
  );
}
