"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SealMark } from "@/components/Seal";
import { getFund, getMember } from "@/lib/chain";
import { txUrl } from "@/lib/config";
import { ROUTE_LABEL, SERVER_CLERK, cardLines, fromUnits, toUnits, usd } from "@/lib/format";
import {
  fileClaim,
  freshPayout,
  loadMember,
  prepareClaim,
  rememberClaim,
  runSealedReview,
  waitFor,
  type LocalMember,
} from "@/lib/member";
import { SAMPLES } from "@/lib/samples";
import { MAX_DOCUMENT_BYTES, maskDetails } from "@/lib/sealed.mjs";
import type { Card, Claim, FundView, MemberView } from "@/lib/types";

const STAGES = [
  ["seal", "Sealing your document in this browser"],
  ["prove", "Proving you're a paid-up member, without saying who"],
  ["file", "Filing the claim through the relay"],
  ["read", "The sealed reader is reading"],
  ["route", "The contract is choosing the path"],
] as const;

type Stage = (typeof STAGES)[number][0];

async function extractPdfText(file: File) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  let out = "";
  for (let i = 1; i <= Math.min(doc.numPages, 6); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  return out;
}

export default function ClaimPage() {
  const [me, setMe] = useState<LocalMember | null>(null);
  const [fund, setFund] = useState<FundView | null>(null);
  const [member, setMember] = useState<MemberView | null>(null);
  const [dollars, setDollars] = useState(85);
  const [doc, setDoc] = useState("");
  const [stage, setStage] = useState<Stage | null>(null);
  const [doneStages, setDoneStages] = useState<Stage[]>([]);
  const [error, setError] = useState("");
  const [proofMillis, setProofMillis] = useState(0);
  const [result, setResult] = useState<{ id: string; hash: string; card: Card | null; claim: Claim; readerNote?: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const m = loadMember();
    setMe(m);
    getFund().then(setFund).catch(() => {});
    if (m) getMember(m.account).then(setMember).catch(() => {});
  }, []);

  function pickSample(id: string) {
    const s = SAMPLES.find((x) => x.id === id)!;
    setDollars(s.amount);
    setDoc(s.text());
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      const text = file.type === "application/pdf" || file.name.endsWith(".pdf") ? await extractPdfText(file) : await file.text();
      setDoc(maskDetails(text).slice(0, MAX_DOCUMENT_BYTES));
    } catch {
      setError("That file could not be read here. Paste the text instead.");
    }
  }

  function mark(next: Stage | null) {
    setStage((prev) => {
      if (prev) setDoneStages((d) => [...d, prev]);
      return next;
    });
  }

  async function submit() {
    if (!me || !fund) return;
    setError("");
    setResult(null);
    setDoneStages([]);
    try {
      const payout = freshPayout();
      const amount = toUnits(dollars);
      mark("seal");
      await new Promise((r) => setTimeout(r, 250));
      mark("prove");
      const prepared = await prepareClaim(me, amount, payout.account, doc);
      setProofMillis(prepared.proof.millis);
      mark("file");
      const { id, hash } = await fileClaim(prepared);
      rememberClaim({ id, payout: payout.account, payoutKey: payout.key, at: Date.now() });
      mark("read");
      let card: Card | null = null;
      let readerNote: string | undefined;
      try {
        card = await runSealedReview(id, prepared.envelope);
      } catch (e) {
        readerNote = (e as Error).message;
      }
      mark("route");
      const claim = await waitFor(id, (c) => c.status !== "AwaitingReview" || !card, 30);
      mark(null);
      setResult({ id, hash, card, claim, readerNote });
    } catch (e) {
      const err = e as Error & { hash?: string };
      setError(err.message);
      setStage(null);
    }
  }

  const cap = member ? fromUnits(member.cap) : 0;
  const busy = stage !== null;
  // Someone who paid last month can still claim, because a hard month is when dues slip.
  const paidUp = Boolean(member?.leaf && fund && member.leaf.period + 1 >= fund.period);
  const canSubmit = !busy && Boolean(doc.trim()) && dollars > 0 && dollars <= cap && paidUp;

  return (
    <div className="page">
      <div className="wrap">
        <p className="eyebrow">Ask for help</p>
        <h1>Tell the fund what you need. Only a sealed reader will see why.</h1>

        {!me && (
          <div className="notice">
            You need to be a member first. <Link href="/member">Join the fund</Link>, it takes a few seconds.
          </div>
        )}
        {me && member && fund && !paidUp && (
          <div className="notice">
            Pay your dues first. <Link href="/member">Go to your membership</Link>
          </div>
        )}

        {fund?.reviewer?.code_hash === SERVER_CLERK && (
          <div className="notice warn">
            This demo&apos;s clerk runs on our server, not in an enclave yet, so that server could read what you seal. Use a sample or an
            invented document. <Link href="/trust">Why</Link>
          </div>
        )}

        <div className="split">
          <div>
            {!result && (
              <div className="card">
                <h3>1. Your document</h3>
                <div className="tabs" role="group" aria-label="Try a sample document">
                  {SAMPLES.map((s) => (
                    <button key={s.id} className="btn ghost small-btn" onClick={() => pickSample(s.id)} disabled={busy}>
                      {s.label}
                    </button>
                  ))}
                  <button className="btn ghost small-btn" onClick={() => fileInput.current?.click()} disabled={busy}>
                    Upload a file
                  </button>
                  <input ref={fileInput} type="file" accept=".txt,.md,.pdf,text/plain,application/pdf" hidden onChange={(e) => onFile(e.target.files?.[0])} />
                </div>
                <label className="field">
                  <span>What the reader will see</span>
                  <textarea
                    value={doc}
                    onChange={(e) => setDoc(e.target.value.slice(0, MAX_DOCUMENT_BYTES))}
                    placeholder="Paste the text of a bill, a letter or a notice. Remove anything you'd rather keep out."
                    disabled={busy}
                  />
                  <small>This text stays on your device until it is encrypted. Edit it freely.</small>
                </label>
                <h3>2. How much do you need?</h3>
                <label className="field">
                  <span>Amount in dollars</span>
                  <input type="number" min={1} max={cap || undefined} value={dollars} onChange={(e) => setDollars(Number(e.target.value))} disabled={busy} />
                  {member && fund && (
                    <small>
                      Your cover is {usd(member.cap)}. Up to {usd(fund.rules.auto_limit)} can pay automatically; up to{" "}
                      {usd(fund.rules.panel_limit)} goes to a panel.
                    </small>
                  )}
                </label>
                <button className="btn" onClick={submit} disabled={!canSubmit}>
                  <SealMark size={18} /> Seal and send
                </button>
              </div>
            )}

            {result && <Result result={result} />}
            {error && <div className="notice bad">{error}</div>}
          </div>

          <div>
            <div className="card">
              <h3>What leaves this device</h3>
              <ul className="leaves">
                <li>
                  <span>Your name</span>
                  <strong>Nothing</strong>
                </li>
                <li>
                  <span>Your document</span>
                  <strong>Encrypted</strong>
                </li>
                <li>
                  <span>Your member secret</span>
                  <strong>Nothing</strong>
                </li>
                <li>
                  <span>A proof you&apos;re a member</span>
                  <strong>Public</strong>
                </li>
                <li>
                  <span>The amount</span>
                  <strong>Public</strong>
                </li>
              </ul>
              <p className="small muted" style={{ marginTop: 12 }}>
                Payment goes to a fresh address made just for this claim, so it does not lead back to you.{" "}
                <Link href="/trust">The limits of this</Link>
              </p>
            </div>
            {(busy || doneStages.length > 0) && (
              <div className="card">
                <h3>Progress</h3>
                <ol className="steps" aria-live="polite">
                  {STAGES.map(([id, label]) => (
                    <li key={id} className={stage === id ? "active" : doneStages.includes(id) ? "done" : ""}>
                      <span className="dot" />
                      <span>
                        {label}
                        {id === "prove" && proofMillis > 0 && ` (${(proofMillis / 1000).toFixed(1)}s)`}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Result({ result }: { result: { id: string; hash: string; card: Card | null; claim: Claim; readerNote?: string } }) {
  const { claim, card } = result;
  return (
    <div className="card">
      <h2>Claim #{result.id} is filed.</h2>
      <p className="muted">
        It carries no name and no reason. <a href={txUrl(result.hash)}>See the transaction</a> and check for yourself.
      </p>
      {card ? (
        <>
          <h3>What the sealed reader told the fund</h3>
          <dl className="kv">
            {cardLines(card).map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {card.injection && <div className="notice warn">The reader flagged an attempt to instruct it. This claim lost the fast path.</div>}
        </>
      ) : (
        <div className="notice warn">
          The sealed reader did not answer: {result.readerNote ?? "no answer"}. The claim is safe, and after the review window it goes to people instead.
        </div>
      )}
      <p style={{ marginTop: 16 }}>{claim.route ? <>Path chosen: <strong>{ROUTE_LABEL[claim.route]}</strong></> : "Waiting for the path."}</p>
      <Link className="btn" href={`/ledger/${result.id}`}>
        Follow this claim
      </Link>
    </div>
  );
}
