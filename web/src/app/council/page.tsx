"use client";

import Link from "next/link";
import { useState } from "react";
import { useLive } from "@/components/Ledger";
import { getProposal, listClaims, type Proposal } from "@/lib/chain";
import { D, accountUrl, txUrl } from "@/lib/config";
import { shortAccount, usd } from "@/lib/format";
import { advance, api } from "@/lib/member";
import type { Claim } from "@/lib/types";

type Item = { claim: Claim; proposal: Proposal | null };

export default function CouncilPage() {
  const { data } = useLive(async () => {
    const all = await listClaims(30);
    const open = all.filter((c) => c.status === "CouncilVote" || c.status === "NeedsCouncil");
    return Promise.all(open.map(async (claim): Promise<Item> => ({ claim, proposal: claim.proposal_id != null ? await getProposal(D.dao, claim.proposal_id).catch(() => null) : null })));
  }, 5000);

  return (
    <div className="page">
      <div className="wrap narrow">
        <p className="eyebrow">Council</p>
        <h1>The biggest claims are normal DAO votes.</h1>
        <p className="lede">
          Above the panel limit, Tideover files an ordinary Sputnik DAO proposal. The council votes as it always does, and it
          sees an amount and the sealed reader&apos;s card. It does not see a name.
        </p>
        <div className="notice">In this demo you can vote for any council member. Two of three pass a proposal.</div>
        {data?.length === 0 && (
          <div className="card empty">
            Nothing is with the council. <Link href="/claim">File a claim</Link> for more than $400 at a high enough tier.
          </div>
        )}
        {data?.map((item) => <Row key={item.claim.id} {...item} />)}
        <div className="card">
          <h3>Who holds what</h3>
          <dl className="kv">
            <dt>Treasury</dt>
            <dd>
              <a href={accountUrl(D.dao)}>{D.dao}</a>
            </dd>
            <dt>Council</dt>
            <dd>{D.council.map(shortAccount).join(", ")}</dd>
            <dt>Guardian</dt>
            <dd>{D.guardians.map(shortAccount).join(", ")}, who can pause the fund or send a claim to the council</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}

function Row({ claim, proposal }: Item) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tx, setTx] = useState("");

  async function vote(account: string, approve: boolean) {
    setBusy(true);
    setError("");
    try {
      const { hash } = await api<{ hash: string }>("/api/demo/vote", { kind: "council", proposalId: claim.proposal_id, account, approve });
      setTx(hash);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="card">
      <h3>
        <Link href={`/ledger/${claim.id}`}>Claim #{claim.id}</Link>: {usd(claim.amount)}
      </h3>
      {claim.status === "NeedsCouncil" && (
        <button className="btn ghost small-btn" onClick={() => advance(claim.id).catch((e) => setError(e.message))}>
          File the proposal now
        </button>
      )}
      {proposal && (
        <>
          <p className="muted">
            DAO proposal #{proposal.id}: &ldquo;{proposal.description}&rdquo;
          </p>
          <ul className="leaves">
            {D.council.map((m) => {
              const v = proposal.votes?.[m];
              return (
                <li key={m}>
                  <span>{shortAccount(m)}</span>
                  {v ? (
                    <span className={v === "Approve" ? "chip good" : "chip stop"}>{v}</span>
                  ) : proposal.status === "InProgress" ? (
                    <span className="btn-row">
                      <button className="btn small-btn" disabled={busy} onClick={() => vote(m, true)}>
                        Approve
                      </button>
                      <button className="btn danger small-btn" disabled={busy} onClick={() => vote(m, false)}>
                        Reject
                      </button>
                    </span>
                  ) : (
                    <span className="chip">Did not vote</span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="small muted" style={{ marginTop: 10 }}>
            Status on the DAO: {proposal.status}
          </p>
        </>
      )}
      {tx && (
        <p className="small muted">
          Vote recorded. <a href={txUrl(tx)}>See the transaction</a>
        </p>
      )}
      {error && <div className="notice bad">{error}</div>}
    </div>
  );
}
