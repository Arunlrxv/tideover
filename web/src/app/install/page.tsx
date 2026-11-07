"use client";

import { useState } from "react";
import { getPolicy, type Policy } from "@/lib/chain";
import { D, accountUrl } from "@/lib/config";

type Check = { dao: string; policy: Policy; hasFundRole: boolean };

const roleProposal = (fund: string) => ({
  proposal: {
    description: "Install Tideover: give the fund a role limited to transfers",
    kind: {
      ChangePolicyAddOrUpdateRole: {
        role: {
          name: "tideover",
          kind: { Group: [fund] },
          permissions: ["transfer:AddProposal", "transfer:VoteApprove"],
          vote_policy: { transfer: { weight_kind: "RoleWeight", quorum: "0", threshold: [1, 1] } },
        },
      },
    },
  },
});

export default function InstallPage() {
  const [dao, setDao] = useState(D.dao);
  const [name, setName] = useState("my-community");
  const [check, setCheck] = useState<Check | null>(null);
  const [error, setError] = useState("");
  const fund = `${name || "my-community"}.${D.factory}`;

  async function inspect() {
    setError("");
    setCheck(null);
    try {
      const policy = await getPolicy(dao.trim());
      setCheck({ dao: dao.trim(), policy, hasFundRole: policy.roles.some((r) => r.name === "tideover") });
    } catch {
      setError("That account does not look like a Sputnik DAO on testnet.");
    }
  }

  return (
    <div className="page">
      <div className="wrap narrow">
        <p className="eyebrow">Install</p>
        <h1>Two ordinary proposals. Remove it with one.</h1>
        <p className="lede">
          Tideover does not ask a community to move its money or change its multisig. The treasury stays in the Sputnik DAO
          you already run, and members vote as they always do.
        </p>

        <div className="card">
          <h3>Check your DAO</h3>
          <label className="field">
            <span>DAO account</span>
            <input type="text" value={dao} onChange={(e) => setDao(e.target.value)} spellCheck={false} />
          </label>
          <button className="btn ghost" onClick={inspect}>
            Read its policy
          </button>
          {error && <div className="notice bad">{error}</div>}
          {check && (
            <div style={{ marginTop: 14 }}>
              <dl className="kv">
                <dt>Roles</dt>
                <dd>{check.policy.roles.map((r) => r.name).join(", ")}</dd>
                <dt>Proposal bond</dt>
                <dd>{Number(BigInt(check.policy.proposal_bond) / 10n ** 21n) / 1000} NEAR</dd>
                <dt>Tideover</dt>
                <dd>{check.hasFundRole ? <span className="chip good">Installed</span> : <span className="chip">Not installed</span>}</dd>
              </dl>
            </div>
          )}
        </div>

        <div className="card">
          <h3>Proposal 1: create your fund</h3>
          <p className="muted">
            A FunctionCall proposal to the factory, with your rules. You get a named account that has no keys, so nobody can
            change its code.
          </p>
          <label className="field">
            <span>Fund name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} spellCheck={false} />
            <small>
              Your fund would be <code>{fund}</code>
            </small>
          </label>
          <dl className="kv small">
            <dt>Receiver</dt>
            <dd>
              <a href={accountUrl(D.factory)}>{D.factory}</a>
            </dd>
            <dt>Method</dt>
            <dd>
              <code>create_fund</code> with your dues, tiers and limits
            </dd>
            <dt>Deposit</dt>
            <dd>About 6.5 NEAR, for the fund&apos;s code and working balance</dd>
          </dl>
        </div>

        <div className="card">
          <h3>Proposal 2: give it a limited role</h3>
          <p className="muted">
            The fund&apos;s only power is to add and approve transfers. It can&apos;t change your policy, add members or touch
            anything else.
          </p>
          <pre className="mono small break-all" style={{ whiteSpace: "pre-wrap", background: "var(--paper-sunk)", padding: 14, borderRadius: 8 }}>
            {JSON.stringify(roleProposal(fund), null, 2)}
          </pre>
        </div>

        <div className="card">
          <h3>To remove it</h3>
          <p className="muted">
            One <code>ChangePolicyRemoveRole</code> proposal. The fund can no longer pay anything, and the treasury was never
            anywhere else.
          </p>
        </div>

        <div className="notice">
          This is a Sputnik DAO, so it should also open in Trezu on mainnet, and the proposals appear there as ordinary requests.
          This demo runs on testnet, where Trezu&apos;s docs show no version, so that part has not been tested.
        </div>
      </div>
    </div>
  );
}
