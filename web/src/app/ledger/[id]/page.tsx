"use client";

import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { ed25519 } from "@noble/curves/ed25519.js";
import { chipClass, useLive } from "@/components/Ledger";
import { Sealed } from "@/components/Seal";
import { getClaim, getFund, getProposal, tokenBalance } from "@/lib/chain";
import { D, accountUrl } from "@/lib/config";
import { ROUTE_LABEL, STATUS_LABEL, cardLines, dateOf, secondsLeft, shortAccount, shortHex, usd } from "@/lib/format";
import { advance, loadClaims } from "@/lib/member";
import type { Claim, FundView } from "@/lib/types";
import { auditClaim } from "@/lib/zk";

type Audit = { proof: boolean | null; signature: boolean | null; ran: boolean };

const unhex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));

export default function ClaimDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error } = useLive(async () => {
    const [claim, fund] = await Promise.all([getClaim(id), getFund()]);
    const proposal = claim?.proposal_id != null ? await getProposal(D.dao, claim.proposal_id).catch(() => null) : null;
    return { claim, fund, proposal };
  }, 4000);
  const [audit, setAudit] = useState<Audit>({ proof: null, signature: null, ran: false });
  const [note, setNote] = useState("");
  const [mine, setMine] = useState<{ balance: string } | null>(null);
  const advancing = useRef(false);

  const claim = data?.claim;
  const fund = data?.fund;

  // Stages that are simply due get moved along while this page is open. On chain, anyone may do this.
  useEffect(() => {
    if (!claim || advancing.current) return;
    const due =
      claim.status === "Approved" ||
      claim.status === "NeedsCouncil" ||
      (claim.status === "CouncilVote" && data?.proposal?.status !== "InProgress") ||
      ((claim.status === "AwaitingReview" || claim.status === "VetoWindow" || claim.status === "PanelVoting") && secondsLeft(claim.deadline) <= -2);
    if (!due) return;
    advancing.current = true;
    advance(claim.id)
      .catch((e) => setNote((e as Error).message))
      .finally(() => {
        advancing.current = false;
      });
  }, [claim, data?.proposal?.status]);

  useEffect(() => {
    if (claim?.status !== "Paid") return;
    if (loadClaims().some((c) => c.id === claim.id)) {
      tokenBalance(claim.payout)
        .then((balance) => setMine({ balance }))
        .catch(() => {});
    }
  }, [claim?.status, claim?.id, claim?.payout]);

  async function recheck(c: Claim, f: FundView) {
    setAudit({ proof: null, signature: null, ran: true });
    let proof: boolean | null = null;
    try {
      proof = await auditClaim({
        proof: c.proof,
        root: c.root,
        period: c.period,
        min_tier: c.min_tier,
        nullifier: c.nullifier,
        fund: D.fund,
        window: c.window,
        amount: c.amount,
        payout: c.payout,
        evidence_sha256: c.evidence_sha256,
      });
    } catch {
      proof = false;
    }
    let signature: boolean | null = null;
    if (c.signed_text && c.signature && f.reviewer) {
      try {
        signature = ed25519.verify(unhex(c.signature), new TextEncoder().encode(c.signed_text), unhex(f.reviewer.signer));
      } catch {
        signature = false;
      }
    }
    setAudit({ proof, signature, ran: true });
  }

  if (error && !data) return <div className="page wrap">Could not reach the chain.</div>;
  if (!data) return <div className="page wrap">Reading the chain…</div>;
  if (!claim || !fund) {
    return (
      <div className="page wrap">
        <h1>No such claim</h1>
        <Link href="/ledger">Back to the ledger</Link>
      </div>
    );
  }

  const paid = claim.status === "Paid";
  const left = secondsLeft(claim.deadline);

  return (
    <div className="page">
      <div className="wrap">
        <p className="eyebrow">
          <Link href="/ledger">Public ledger</Link> / Claim #{claim.id}
        </p>
        <h1>
          {usd(claim.amount)} <span className={chipClass(claim.status)} style={{ verticalAlign: "middle" }}>{STATUS_LABEL[claim.status]}</span>
        </h1>
        <p>
          <Sealed /> <span className="muted small">Filed {dateOf(claim.filed_at)}. No name, no reason, anywhere on the chain.</span>
        </p>

        {mine && (
          <div className="notice">
            This was your claim. Your fresh address now holds {usd(mine.balance)}, and nothing on the chain connects it to you.
          </div>
        )}

        <div className="split">
          <div>
            <div className="card">
              <h3>Every rule, checked</h3>
              <ul className="checks">
                <Check ok title="Made by a paid-up member" note={`Proved at tier ${claim.min_tier} or above, in zero knowledge. The contract verified it when the claim was filed.`} />
                <Check ok title="Within that tier's cover" note={`${usd(claim.amount)} is within the ${usd(fund.rules.tiers[claim.min_tier].cap)} limit.`} />
                <Check ok title="This member's only claim this quarter" note={`Their anonymous tag ${shortHex(claim.nullifier)} has no other claim this quarter.`} />
                <Check ok title="Within their limit for the year" note={claim.prior_claims === 0 ? "Their first claim this year." : `This anonymous member already claimed ${usd(claim.prior_amount)} this year, in ${claim.prior_claims} earlier claim${claim.prior_claims === 1 ? "" : "s"}.`} />
                <Check ok title="Inside the cycle's budget" note={`Checked against ${usd(fund.rules.cycle_budget)} per cycle.`} />
                <Check
                  ok={Boolean(claim.card)}
                  wait={!claim.card && claim.status === "AwaitingReview"}
                  skipped={!claim.card && claim.status !== "AwaitingReview"}
                  title="Read by the sealed reader"
                  note={
                    claim.card
                      ? `Signed by the enclave key the DAO pinned, on the DAO's registered prompt, for this claim's committed evidence.`
                      : claim.status === "AwaitingReview"
                        ? "Waiting for the reader."
                        : "The reader did not answer in time, so this claim went to people."
                  }
                />
                <Check
                  ok={Boolean(claim.route)}
                  wait={!claim.route}
                  title={claim.route ? `Decided by: ${ROUTE_LABEL[claim.route]}` : "Decision"}
                  note={decisionNote(claim, left)}
                />
                <Check
                  ok={paid}
                  wait={!paid && claim.status !== "Rejected"}
                  skipped={claim.status === "Rejected"}
                  title={claim.status === "Rejected" ? "Not paid" : "Paid from the DAO"}
                  note={
                    claim.proposal_id != null
                      ? `Through the DAO's own proposal #${claim.proposal_id}, to a fresh address.`
                      : "The money stays in the DAO until a Transfer proposal passes."
                  }
                />
              </ul>
              {note && <div className="notice warn">{note}</div>}
            </div>

            <div className="card">
              <h3>Don&apos;t take this page&apos;s word for it</h3>
              <p className="muted">
                This re-checks the stored proof and the enclave&apos;s signature here in your browser, using only public data.
              </p>
              <button className="btn ghost" onClick={() => recheck(claim, fund)}>
                Re-check this claim here
              </button>
              {audit.ran && (
                <ul className="checks" style={{ marginTop: 10 }}>
                  <Check ok={audit.proof === true} wait={audit.proof === null} bad={audit.proof === false} title="Membership proof" note={audit.proof === null ? "Checking…" : audit.proof ? "Verifies against the fund's verifying key." : "Does not verify."} />
                  {claim.signed_text && (
                    <Check ok={audit.signature === true} wait={audit.signature === null} bad={audit.signature === false} title="Enclave signature" note={audit.signature === null ? "Checking…" : audit.signature ? `Signed by ${shortHex(fund.reviewer?.signer ?? "")}.` : "Does not verify."} />
                  )}
                </ul>
              )}
            </div>
          </div>

          <div>
            {claim.card && (
              <div className="card">
                <h3>The reader&apos;s card</h3>
                <p className="small muted">Closed fields only, so it cannot carry a name.</p>
                <dl className="kv">
                  {cardLines(claim.card).map(([k, v]) => (
                    <div key={k} style={{ display: "contents" }}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                {claim.card.injection && <div className="notice warn">Flagged: the document tried to instruct the reader.</div>}
              </div>
            )}

            {claim.panel.length > 0 && (
              <div className="card">
                <h3>The panel</h3>
                <p className="small muted">Drawn at random. They saw the card and the amount, nothing else.</p>
                <ul className="leaves">
                  {claim.panel.map((p) => {
                    const v = claim.votes.find((x) => x.member === p);
                    return (
                      <li key={p}>
                        <span>{shortAccount(p)}</span>
                        <span>{v ? (v.approve ? <span className="chip good">Approved</span> : <span className="chip stop">Declined</span>) : <span className="chip">Waiting</span>}</span>
                      </li>
                    );
                  })}
                </ul>
                {claim.status === "PanelVoting" && (
                  <Link className="btn ghost small-btn" href="/panel" style={{ marginTop: 12 }}>
                    Vote as a panelist
                  </Link>
                )}
              </div>
            )}

            <div className="card">
              <h3>On the chain</h3>
              <dl className="kv small">
                <dt>Fund</dt>
                <dd>
                  <a href={accountUrl(D.fund)}>{shortAccount(D.fund)}</a>
                </dd>
                <dt>DAO</dt>
                <dd>
                  <a href={accountUrl(D.dao)}>{shortAccount(D.dao)}</a>
                </dd>
                <dt>Paid to</dt>
                <dd className="mono">{shortAccount(claim.payout)}</dd>
                <dt>Nullifier</dt>
                <dd className="mono">{shortHex(claim.nullifier)}</dd>
                <dt>Evidence hash</dt>
                <dd className="mono">{shortHex(claim.evidence_sha256)}</dd>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function decisionNote(c: Claim, left: number) {
  if (c.status === "VetoWindow") return left > 0 ? `A guardian can stop this for ${left} more seconds.` : "The veto window has closed.";
  if (c.status === "PanelVoting") return `${c.votes.length} of ${c.panel.length} have voted.`;
  if (c.status === "NeedsCouncil") return "Being filed as a normal DAO proposal.";
  if (c.status === "CouncilVote") return "A normal DAO proposal, with no name and no reason on it.";
  if (c.status === "Rejected") return c.note ?? "Declined.";
  if (c.status === "Paid") return c.route === "Auto" ? "No guardian stopped it." : c.note ?? "Approved.";
  return c.note ?? "";
}

function Check({ ok, wait, skipped, bad, title, note }: { ok?: boolean; wait?: boolean; skipped?: boolean; bad?: boolean; title: string; note: string }) {
  const cls = ok ? "tick" : bad ? "tick bad" : "tick wait";
  return (
    <li>
      <span className={cls} aria-hidden="true">
        {ok ? "✓" : bad ? "✕" : skipped ? "–" : "…"}
      </span>
      <span>
        <strong>{title}</strong>
        <span className="note">{note}</span>
      </span>
      <span />
    </li>
  );
}
