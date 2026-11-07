"use client";

import { useLive } from "@/components/Ledger";
import { getFund } from "@/lib/chain";
import { accountUrl, D } from "@/lib/config";
import { shortHex } from "@/lib/format";
import { MODEL, PROMPT, sha256hex } from "@/lib/sealed.mjs";

export default function TrustPage() {
  return (
    <div className="page">
      <div className="wrap narrow">
        <p className="eyebrow">Trust</p>
        <h1>What stays hidden, and what does not.</h1>
        <p className="lede">
          Privacy claims are easy to overstate. Here is exactly what Tideover protects, who you still have to trust, and where it
          stops.
        </p>

        <div className="card">
          <h3>Who can see what</h3>
          <div className="table-scroll">
            <table className="plain">
              <thead>
                <tr>
                  <th>What</th>
                  <th>The public</th>
                  <th>Panel and council</th>
                  <th>Our relay</th>
                  <th>The enclave</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Who claimed</td>
                  <td>No</td>
                  <td>No</td>
                  <td>No*</td>
                  <td>No, unless the document names them</td>
                </tr>
                <tr>
                  <td>Why they claimed</td>
                  <td>No</td>
                  <td>Only the fixed card</td>
                  <td>No</td>
                  <td>Yes, while it reads</td>
                </tr>
                <tr>
                  <td>The document</td>
                  <td>Ciphertext only</td>
                  <td>No</td>
                  <td>Ciphertext only</td>
                  <td>Yes, while it reads</td>
                </tr>
                <tr>
                  <td>The AI&apos;s reasoning</td>
                  <td>Ciphertext only</td>
                  <td>No</td>
                  <td>Ciphertext only</td>
                  <td>Yes</td>
                </tr>
                <tr>
                  <td>Amount and time</td>
                  <td>Yes</td>
                  <td>Yes</td>
                  <td>Yes</td>
                  <td>Yes</td>
                </tr>
                <tr>
                  <td>Who is a member</td>
                  <td>Yes</td>
                  <td>Yes</td>
                  <td>Yes</td>
                  <td>No</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>
            * The relay sees the network address a claim came from, as any server does. It sees no name, but a careful member would use a VPN or Tor.
          </p>
        </div>

        <div className="card">
          <h3>Where the protection stops</h3>
          <ul>
            <li>
              <strong>Small groups give less cover.</strong> You are hidden among paid-up members at your tier or above. In a fund of
              ten, that is not many people.
            </li>
            <li>
              <strong>Timing can leak.</strong> If you tell a friend you had a hard week and a claim appears that week, that link is
              outside anything cryptography can protect.
            </li>
            <li>
              <strong>Sealed documents are stored as ciphertext.</strong> The contract has to see the encrypted document to prove what
              the model read, so it stays on chain. Anyone who later obtained the enclave&apos;s private key could open it, so blank out
              what you can before you seal.
            </li>
            <li>
              <strong>You are trusting the enclave hardware.</strong> Privacy here depends on Intel TDX and NVIDIA confidential
              computing doing what they claim.
            </li>
            <li>
              <strong>A claimant can be drawn onto their own panel.</strong> Nobody knows who they are, so they can&apos;t be excluded. Two of
              three must agree, so they can&apos;t decide alone.
            </li>
            <li>
              <strong>The fresh address is only fresh until you use it.</strong> Moving the money straight to your main wallet links
              them.
            </li>
          </ul>
        </div>

        <div className="card">
          <h3>Fraud is capped, not impossible</h3>
          <p>
            An AI can&apos;t reliably spot a forged document, and an anonymous cheat loses no reputation. So the rules limit the damage
            instead: a waiting period before any cover, a limit per tier, one claim per member per quarter, and a budget per quarter.
            The AI never holds a key. Tideover also assumes what a real mutual aid group assumes, which is that members know each
            other: the DAO decides who joins.
          </p>
        </div>

        <div className="card">
          <h3>This is a demo, and what a real fund would need</h3>
          <ul>
            <li>The zero-knowledge keys came from a one-person setup. Real money needs a multi-party ceremony.</li>
            <li>The contracts have not been audited.</li>
            <li>A real fund would need legal advice. Rules on mutual aid, insurance and health data differ by country.</li>
          </ul>
        </div>

        <ReaderCheck />
      </div>
    </div>
  );
}

function ReaderCheck() {
  const { data } = useLive(async () => {
    const fund = await getFund();
    const res = await fetch(`https://cloud-api.near.ai/v1/attestation/report?model=${encodeURIComponent(MODEL)}&signing_algo=ed25519`);
    const report = res.ok ? await res.json() : null;
    const live = report?.model_attestations?.[0];
    return { fund, attested: (live?.signing_public_key ?? live?.signing_address ?? "").replace(/^0x/, "") as string };
  }, 60000);
  const pinned = data?.fund.reviewer?.signer;
  const localPrompt = sha256hex(PROMPT);
  return (
    <div className="card">
      <h3>The sealed reader, checked live</h3>
      <dl className="kv small">
        <dt>Model</dt>
        <dd>{data?.fund.reviewer?.model_id ?? MODEL}</dd>
        <dt>Key the DAO pinned</dt>
        <dd className="mono">{pinned ? shortHex(pinned, 10) : "–"}</dd>
        <dt>Key attested right now</dt>
        <dd className="mono">{data?.attested ? shortHex(data.attested, 10) : "–"}</dd>
        <dt>Match</dt>
        <dd>{pinned && data?.attested ? (pinned === data.attested ? <span className="chip good">Same key</span> : <span className="chip stop">Different: the DAO must re-pin</span>) : "–"}</dd>
        <dt>Prompt on chain</dt>
        <dd className="mono">{data?.fund.reviewer ? shortHex(data.fund.reviewer.prompt_sha256, 10) : "–"}</dd>
        <dt>Prompt in this page</dt>
        <dd className="mono">{shortHex(localPrompt, 10)}</dd>
        <dt>Fund</dt>
        <dd>{D.fund ? <a href={accountUrl(D.fund)}>{D.fund}</a> : "–"}</dd>
      </dl>
      <details style={{ marginTop: 12 }}>
        <summary>Read the full prompt</summary>
        <p className="small muted" style={{ marginTop: 10 }}>
          {PROMPT}
        </p>
      </details>
    </div>
  );
}
