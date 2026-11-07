"use client";

import Link from "next/link";
import { useState } from "react";
import { useLive } from "@/components/Ledger";
import { listClaims } from "@/lib/chain";
import { txUrl } from "@/lib/config";
import { cardLines, secondsLeft, shortAccount, usd } from "@/lib/format";
import { api, loadMember, voteOnPanel } from "@/lib/member";
import type { Claim } from "@/lib/types";

export default function PanelPage() {
  const { data } = useLive(() => listClaims(30).then((all) => all.filter((c) => c.status === "PanelVoting")), 4000);
  return (
    <div className="page">
      <div className="wrap narrow">
        <p className="eyebrow">Panel</p>
        <h1>Decide for a neighbour you can&apos;t see.</h1>
        <p className="lede">
          Three paid-up members are drawn at random for each mid-size claim. They see an amount and a sealed reader&apos;s card,
          and no name. Serving adds a point to your record, whichever way you vote.
        </p>
        <div className="notice">
          In this demo you can vote for any panelist, so one person can see the whole flow. A real panelist signs with their own
          key.
        </div>
        {data?.length === 0 && (
          <div className="card empty">
            No claims are with a panel right now. <Link href="/claim">File one</Link> for between $100 and $400.
          </div>
        )}
        {data?.map((c) => <Case claim={c} key={c.id} />)}
      </div>
    </div>
  );
}

function Case({ claim }: { claim: Claim }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [tx, setTx] = useState("");
  const me = loadMember();

  async function vote(account: string, approve: boolean) {
    setBusy(account);
    setError("");
    try {
      const { hash } =
        me?.account === account
          ? await voteOnPanel(me, claim.id, approve)
          : await api<{ hash: string }>("/api/demo/vote", { kind: "panel", claimId: claim.id, account, approve });
      setTx(hash);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy("");
  }

  const mins = Math.max(0, Math.ceil(secondsLeft(claim.deadline) / 60));
  return (
    <div className="card">
      <div className="btn-row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>
          <Link href={`/ledger/${claim.id}`}>Claim #{claim.id}</Link>: {usd(claim.amount)}
        </h3>
        <span className="chip hold">{mins} min left</span>
      </div>
      {claim.card ? (
        <dl className="kv" style={{ margin: "14px 0" }}>
          {cardLines(claim.card).map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted">
          No card arrived. The reader may have been down, or the relay may have held it back, so this says nothing either way about
          the claim. All you have is the amount and the member&apos;s proof.
        </p>
      )}
      {claim.card?.injection && <div className="notice warn">The document tried to instruct the reader.</div>}
      {claim.prior_claims > 0 && (
        <div className="notice warn">
          This anonymous member already claimed {usd(claim.prior_amount)} this year. You can see that without knowing who they are.
        </div>
      )}
      <ul className="leaves">
        {claim.panel.map((p) => {
          const voted = claim.votes.find((v) => v.member === p);
          return (
            <li key={p}>
              <span>
                {shortAccount(p)}
                {me?.account === p && <span className="chip tide" style={{ marginLeft: 8 }}>You</span>}
              </span>
              {voted ? (
                <span className={voted.approve ? "chip good" : "chip stop"}>{voted.approve ? "Approved" : "Declined"}</span>
              ) : (
                <span className="btn-row">
                  <button className="btn small-btn" disabled={Boolean(busy)} onClick={() => vote(p, true)}>
                    Approve
                  </button>
                  <button className="btn danger small-btn" disabled={Boolean(busy)} onClick={() => vote(p, false)}>
                    Decline
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {tx && (
        <p className="small muted" style={{ marginTop: 10 }}>
          Vote recorded. <a href={txUrl(tx)}>See the transaction</a>
        </p>
      )}
      {error && <div className="notice bad">{error}</div>}
    </div>
  );
}
