"use client";

import { useMemo, useState } from "react";
import { getPolicy, view, type Policy } from "@/lib/chain";
import { D, accountUrl } from "@/lib/config";
import { cliCommand, createFundProposal, defaultRules, fundAccount, roleProposal, type MidSize } from "@/lib/install";
import { createFundTemplate, fundTemplates } from "@/lib/trezu.mjs";
import type { FundView } from "@/lib/types";

type Check = { dao: string; policy: Policy; hasFundRole: boolean; deposit: string };
type NewFund = "missing" | "ours" | "theirs";

function CopyBlock({ text, label = "Copy command" }: { text: string; label?: string }) {
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
        {copied ? "Copied" : label}
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
  const [midSize, setMidSize] = useState<MidSize>("members");
  const [check, setCheck] = useState<Check | null>(null);
  const [newFund, setNewFund] = useState<NewFund | null>(null);
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

  /** Proposal two hands a role to this account, so it must be this DAO's own fund. */
  async function inspectFund(dao: string) {
    setNewFund(null);
    const fund = await view<FundView>(fundAccount(name), "get_fund").catch(() => null);
    setNewFund(!fund ? "missing" : fund.dao === dao ? "ours" : "theirs");
  }

  const commands = useMemo(() => {
    if (!check) return null;
    const bond = check.policy.proposal_bond;
    const input = { dao: check.dao, name, guardian, duesDollars: dues, bond, proposalPeriod: check.policy.proposal_period, deposit: check.deposit, midSize };
    return {
      fund: cliCommand(check.dao, createFundProposal(input), bond, signer),
      role: cliCommand(check.dao, roleProposal(name), bond, signer),
    };
  }, [check, name, guardian, dues, signer, midSize]);

  const templates = useMemo(() => {
    if (!check) return null;
    const rules = defaultRules(dues, check.policy.proposal_bond, check.policy.proposal_period, midSize);
    const create = createFundTemplate({ factory: D.factory, dao: check.dao, token: D.token, deposit: check.deposit, rules, dues: rules.dues });
    return { create, everyday: fundTemplates(fundAccount(name || "my-community")) };
  }, [check, dues, name, midSize]);

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
              <span>Who decides mid-size claims</span>
              <select value={midSize} onChange={(e) => setMidSize(e.target.value as MidSize)}>
                <option value="members">Three random members</option>
                <option value="council">One council member</option>
              </select>
              <small>{midSize === "council" ? "Drawn from your guardians, so name one." : "No single known person sees them all."}</small>
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
            Once proposal one passes. The fund&apos;s only power is over transfers: it can add one, approve one, and finalise one that
            failed or expired. It can&apos;t change your policy, add members or touch anything else.
          </p>
          {!check && <p className="muted small">Read your DAO&apos;s policy above to generate this.</p>}
          {check && (
            <button className="btn ghost small-btn" onClick={() => inspectFund(check.dao)}>
              Check the new fund first
            </button>
          )}
          {newFund === "missing" && <div className="notice">There is no fund at that name yet. Wait for proposal one to pass.</div>}
          {newFund === "theirs" && (
            <div className="notice bad">
              That name belongs to another DAO&apos;s fund. Don&apos;t give it a role. Choose another name and file proposal one again.
            </div>
          )}
          {newFund === "ours" && commands && <CopyBlock text={commands.role} />}
        </div>

        <div className="card">
          <h3>Using Trezu?</h3>
          <p className="muted">
            Trezu opens any Sputnik DAO, so a claim that reaches the council shows there as an ordinary payment request, and members
            vote on it as usual. In Trezu, open Custom templates, choose Code, and paste a template. Your team then gets a form that
            files the proposal. Templates can only file function calls, so proposal two still comes from the command above, and you
            vote on it in Trezu.
          </p>
          {!templates && <p className="muted small">Read your DAO&apos;s policy above to generate these.</p>}
          {templates && (
            <>
              <h4>Instead of proposal one</h4>
              <CopyBlock text={JSON.stringify(templates.create, null, 2)} label="Copy template" />
              <details style={{ marginTop: 14 }}>
                <summary>Forms for running the fund afterwards</summary>
                {templates.everyday.map((t) => (
                  <div key={t.id} style={{ marginTop: 12 }}>
                    <h4>{t.title}</h4>
                    <CopyBlock text={JSON.stringify(t, null, 2)} label="Copy template" />
                  </div>
                ))}
              </details>
            </>
          )}
        </div>

        <div className="card">
          <h3>To remove it</h3>
          <p className="muted">
            One <code>ChangePolicyRemoveRole</code> proposal. The fund can no longer pay anything, and the treasury was never anywhere
            else.
          </p>
        </div>

      </div>
    </div>
  );
}
