"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getFund, listClaims, tokenBalance } from "@/lib/chain";
import { D, isDeployed } from "@/lib/config";
import { ROUTE_LABEL, STATUS_LABEL, timeAgo, usd } from "@/lib/format";
import type { Claim, ClaimStatus, FundView } from "@/lib/types";
import { Sealed } from "./Seal";

export function chipClass(status: ClaimStatus) {
  if (status === "Paid") return "chip good";
  if (status === "Rejected") return "chip stop";
  if (status === "CouncilVote" || status === "PanelVoting" || status === "VetoWindow") return "chip hold";
  return "chip tide";
}

/** Reads the chain directly, and keeps doing so while the page is open. */
export function useLive<T>(load: () => Promise<T>, everyMs = 8000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const next = await load();
        if (!stop) {
          setData(next);
          setError(null);
        }
      } catch (e) {
        if (!stop) setError(String((e as Error).message ?? e));
      }
    };
    void tick();
    const t = setInterval(tick, everyMs);
    return () => {
      stop = true;
      clearInterval(t);
    };
    // The loader is defined inline by callers and is stable in meaning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [everyMs]);
  return { data, error };
}

type Snapshot = { fund: FundView; reserve: string };

async function loadSnapshot(): Promise<Snapshot> {
  const fund = await getFund();
  return { fund, reserve: await tokenBalance(fund.dao) };
}

export function Figures() {
  const { data, error } = useLive(() => (isDeployed() ? loadSnapshot() : Promise.reject(new Error("not deployed"))), 12000);
  if (!data) {
    return (
      <div className="figures" aria-busy={!error}>
        {["Paid-up members", "In the DAO treasury", "Paid out", "Claims"].map((label) => (
          <div className="figure" key={label}>
            <span className="value">–</span>
            <span className="label">{label}</span>
          </div>
        ))}
      </div>
    );
  }
  const { fund, reserve } = data;
  const monthsOfCover = Number(reserve) / Math.max(1, Number(fund.rules.cycle_budget) / fund.rules.periods_per_cycle);
  return (
    <div className="figures">
      <div className="figure">
        <span className="value">{fund.paid_up}</span>
        <span className="label">Paid-up members</span>
      </div>
      <div className="figure">
        <span className="value">{usd(reserve)}</span>
        <span className="label">In the DAO treasury</span>
      </div>
      <div className="figure">
        <span className="value">{usd(fund.paid_out)}</span>
        <span className="label">Paid out</span>
      </div>
      <div className="figure">
        <span className="value">{monthsOfCover.toFixed(1)}</span>
        <span className="label">Months of full budget left</span>
      </div>
    </div>
  );
}

export function ClaimRow({ claim }: { claim: Claim }) {
  return (
    <Link className="ledger-row" href={`/ledger/${claim.id}`}>
      <span className="num">#{claim.id}</span>
      <span className="amt">{usd(claim.amount)}</span>
      <Sealed />
      <span className="route muted small">{claim.route ? ROUTE_LABEL[claim.route] : timeAgo(claim.filed_at)}</span>
      <span>
        <span className={chipClass(claim.status)}>{STATUS_LABEL[claim.status]}</span>
      </span>
    </Link>
  );
}

export function LedgerList({ limit = 20, compact = false }: { limit?: number; compact?: boolean }) {
  const { data, error } = useLive(() => (isDeployed() ? listClaims(limit) : Promise.resolve([])), 8000);
  return (
    <div className="ledger" aria-busy={!data && !error}>
      {!compact && (
        <div className="ledger-head" aria-hidden="true">
          <span>Claim</span>
          <span>Amount</span>
          <span>Why</span>
          <span>Decided by</span>
          <span>Status</span>
        </div>
      )}
      {data?.map((c) => <ClaimRow claim={c} key={c.id} />)}
      {data?.length === 0 && <div className="empty">{isDeployed() ? "No claims yet." : "The demo fund is not deployed yet."}</div>}
      {!data && !error && <div className="empty">Reading the chain…</div>}
      {!data && error && <div className="empty">Could not reach the chain. Try again in a moment.</div>}
    </div>
  );
}

export const deployed = { fund: D.fund, dao: D.dao };
