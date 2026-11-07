"use client";

import { useMemo, useState } from "react";
import { getPolicy, view, type Policy } from "@/lib/chain";
import { D, accountUrl } from "@/lib/config";
import { cliCommand, createFundProposal, fundAccount, roleProposal } from "@/lib/install";

type Check = { dao: string; policy: Policy; hasFundRole: boolean; deposit: string };

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <pre className="mono small break-all" style={{ whiteSpace: "pre-wrap", background: "var(--paper-sunk)", padding: 14, borderRadius: 8, maxHeight: 220, overflow: "auto" }}>
        {text}
      </pre>
      <button
        className="btn ghost small-btn"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy command"}
      </button>
    </div>
  );
}

export default function InstallPage() {
  const [dao, setDao] = useState(D.dao);
  const [name, setName] = useState("my-community");
  const [signer, setSigner] = useState("");
  const [dues, setDues] = useState(10);
  const [guardian, setGuardian] = useState("");
  const [check, setCheck] = useState<Check | null>(null);
  const [error, setError] = useState("");

  async function inspect() {
    setError("");
    setCheck(null);
    try {
      const [policy, deposit] = await Promise.all([getPolicy(dao.trim()), view<string>(D.factory, "required_deposit")]);
      setCheck({ dao: dao.trim(), policy, hasFundRole: policy.roles.some((r) => r.name === "tideover"), deposit });
    } catch {
      setError("That account does not look like a Sputnik DAO on testnet.");
    }
  }

  const commands = useMemo(() => {
    if (!check) return null;
    const bond = check.policy.proposal_bond;
    const input = { dao: check.dao, name, guardian, duesDollars: dues, bond, deposit: check.deposit };
    return {
      fund: cliCommand(check.dao, createFundProposal(input), bond, signer),
      role: cliCommand(check.dao, roleProposal(name), bond, signer),
    };
  }, [check, name, guardian, dues, signer]);

  const depositNear = check ? (Number(BigInt(check.deposit) / 10n ** 21n) / 1000).toFixed(2) : "about 6.6";

  return (
    <div className="page">
      <div className="wrap narrow">
        <p className="eyebrow">Install</p>
        <h1>Two ordinary proposals. Remove it with one.</h1>
        <p className="lede">
          Tideover does not ask a community to move its money or change its multisig. The treasury stays in the Sputnik DAO you
          already run, and members vote as they always do.
        </p>

        <div className="card">
          <h3>1. Check your DAO</h3>
          <label className="field">
            <span>DAO account</span>
            <input type="text" value={dao} onChange={(e) => setDao(e.target.value)} spellCheck={false} placeholder="your-dao.sputnikv2.testnet" />
          </label>
          <button className="btn ghost" onClick={inspect} disabled={!D.factory}>
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
          <h3>2. Set your fund up</h3>
          <div className="grid-2">
            <label className="field">
              <span>Fund name</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} spellCheck={false} />
              <small>
                Becomes <code className="break-all">{fundAccount(name || "my-community")}</code>
              </small>
            </label>
            <label className="field">
              <span>Monthly dues in dollars</span>
              <input type="number" min={1} value={dues} onChange={(e) => setDues(Math.max(1, Number(e.target.value)))} />
              <small>You can change all the limits later with a DAO vote.</small>
            </label>
            <label className="field">
              <span>Guardian account</span>
              <input type="text" value={guardian} onChange={(e) => setGuardian(e.target.value)} spellCheck={false} placeholder="optional" />
              <small>Can pause the fund or send a claim to the council.</small>
            </label>
            <label className="field">
              <span>Your account</span>
              <input type="text" value={signer} onChange={(e) => setSigner(e.target.value)} spellCheck={false} placeholder="your-account.testnet" />
              <small>A member allowed to file proposals. You sign with your own key.</small>
            </label>
          </div>
        </div>

        <div className="card">
          <h3>3. File proposal one: create the fund</h3>
          <p className="muted">
            A FunctionCall proposal to the <a href={accountUrl(D.factory)}>factory</a>, with your rules. It creates a named account
            with no keys, so nobody can change its code. The DAO needs {depositNear} NEAR for the fund&apos;s code and working balance.
          </p>
          {commands ? <CopyBlock text={commands.fund} /> : <p className="muted small">Read your DAO&apos;s policy above to generate this.</p>}
        </div>

        <div className="card">
          <h3>4. File proposal two: give it a limited role</h3>
          <p className="muted">
            Once proposal one passes. The fund&apos;s only power is to add and approve transfers. It can&apos;t change your policy, add
            members or touch anything else.
          </p>
          {commands ? <CopyBlock text={commands.role} /> : <p className="muted small">Read your DAO&apos;s policy above to generate this.</p>}
        </div>

        <div className="card">
          <h3>To remove it</h3>
          <p className="muted">
            One <code>ChangePolicyRemoveRole</code> proposal. The fund can no longer pay anything, and the treasury was never anywhere
            else.
          </p>
        </div>

        <div className="notice">
          On mainnet this is a normal Sputnik DAO, so it should also open in Trezu, with these proposals as ordinary requests. Trezu&apos;s
          docs show no testnet version, so that part has not been tested.
        </div>
      </div>
    </div>
  );
}
