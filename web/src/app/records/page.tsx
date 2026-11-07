"use client";

import Link from "next/link";
import { useState } from "react";
import { useLive } from "@/components/Ledger";
import { getFund, getMember, getRecord, listRoster } from "@/lib/chain";
import { accountUrl, isDeployed } from "@/lib/config";
import { dateOf, pointLine, shortAccount, usd } from "@/lib/format";
import type { MemberView, RecordEntry } from "@/lib/types";

export default function RecordsPage() {
  const { data, error } = useLive(async () => {
    const [fund, roster] = await Promise.all([getFund(), listRoster(200)]);
    const members = await Promise.all(roster.map(getMember));
    const known = members.filter((m): m is MemberView => m !== null);
    return { fund, members: known.sort((a, b) => b.score - a.score) };
  }, 15000);

  return (
    <div className="page">
      <div className="wrap narrow">
        <p className="eyebrow">Records</p>
        <h1>Cover is earned, and every point shows where it came from.</h1>
        <p className="lede">
          Each paid month and each panel served adds a point, and points set how much a member can ask for. Records belong to
          named accounts, and anyone can read them. Nothing here connects a member to a claim they made.
        </p>
        {!isDeployed() && <div className="notice warn">The demo fund is not deployed yet.</div>}
        {error && !data && isDeployed() && <div className="notice warn">Could not reach the chain.</div>}
        {data?.members.length === 0 && <div className="card empty">Nobody has joined yet.</div>}
        {data && data.members.length > 0 && (
          <div className="card">
            <ul className="leaves">
              {data.members.map((m) => (
                <Row key={m.account} member={m} />
              ))}
            </ul>
          </div>
        )}
        <p className="small muted">
          Tier limits are on the <Link href="/member">Member</Link> page. <Link href="/trust">What this does not hide</Link>
        </p>
      </div>
    </div>
  );
}

function Row({ member }: { member: MemberView }) {
  const [record, setRecord] = useState<RecordEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  function open(isOpen: boolean) {
    if (!isOpen || record) return;
    setFailed(false);
    getRecord(member.account)
      .then(setRecord)
      .catch(() => setFailed(true));
  }

  return (
    <li style={{ display: "block" }}>
      <details onToggle={(e) => open(e.currentTarget.open)}>
        <summary>
          <strong>{shortAccount(member.account)}</strong>{" "}
          <span className="muted small">
            tier {member.tier}, {usd(member.cap)} cover, {member.score} points
          </span>
        </summary>
        <div style={{ padding: "10px 0 4px" }}>
          <p className="small muted">
            {member.paid_periods} months paid, {member.service_points} panels served.{" "}
            <a href={accountUrl(member.account)}>See the account</a>
          </p>
          {failed && <p className="small muted">Could not read this record. Open it again to retry.</p>}
          {!record && !failed && <p className="small muted">Reading the chain…</p>}
          {record?.length === 0 && <p className="small muted">No points yet.</p>}
          {record && record.length > 0 && (
            <table className="plain">
              <tbody>
                {record.map((entry, i) => {
                  const line = pointLine(entry);
                  return (
                    <tr key={i}>
                      <td className="mono">{line.points > 0 ? `+${line.points}` : line.points}</td>
                      <td>
                        {line.what}
                        {line.claim && (
                          <>
                            {" "}
                            <Link href={`/ledger/${line.claim}`}>claim #{line.claim}</Link>
                          </>
                        )}
                      </td>
                      <td className="small muted">{dateOf(entry.at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </details>
    </li>
  );
}
