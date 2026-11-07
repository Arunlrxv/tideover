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
                  <th>Clerk and model</th>
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
                  <td>No</td>
                  <td>No</td>
                  <td>No</td>
                  <td>Yes, then it is dropped</td>
                </tr>
                <tr>
                  <td>That two claims came from the same member, within a year</td>
                  <td>Yes</td>
                  <td>Yes</td>
                  <td>Yes</td>
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
                  <td>Yes</td>
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
              <strong>Small groups give less cover.</strong> You are hidden among the members who paid in the month you prove, at your
              tier or above. The contract refuses a claim if that group is below the fund&apos;s minimum, and your browser proves last
              month&apos;s finished group when it is the bigger one, but a small fund still gives less cover than a large one.
            </li>
            <li>
              <strong>Timing can leak.</strong> If you tell a friend you had a hard week and a claim appears that week, that link is
              outside anything cryptography can protect.
            </li>
            <li>
              <strong>Sealed documents can end up public as ciphertext.</strong> On its way to the enclave, a sealed document sits in a
              public transaction. Only the clerk can open it, but anyone who later obtained the clerk&apos;s key could read old documents,
              so blank out what you can before you seal.
            </li>
            <li>
              <strong>You are trusting enclave hardware.</strong> The clerk runs on Intel TDX through OutLayer. The model runs on NEAR
              AI&apos;s private inference, which uses Intel TDX and NVIDIA confidential computing. Both publish attestations. The clerk reaches
              the model over TLS and does not check the model&apos;s attestation itself yet.
            </li>
            <li>
              <strong>A clerk on a server is not private.</strong> Before a fund pins an enclave build, the same steps run on the
              demo&apos;s server, and that server could read a document. The check below says which one this fund is using. Use invented
              documents until it says enclave.
            </li>
            <li>
              <strong>A relay can hold a card back.</strong> It can&apos;t change a card, because the clerk&apos;s signature covers it, but it could
              sit on one. The claim then goes to people instead, so nothing is lost, and panelists are told that a missing card proves
              nothing.
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
            instead: a waiting period before any cover, a limit per claim, a limit per member per year, one claim per quarter, and a
            budget per quarter. Each member carries an anonymous tag for the year, so the contract can count their claims without
            knowing who they are, and a second claim in a year always goes to people. The tag changes every year, so last year&apos;s
            claims don&apos;t link to this year&apos;s. The AI never holds a key. Tideover also assumes what a real mutual aid group assumes,
            which is that members know each other: the DAO decides who joins.
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

        <ClerkCheck />
      </div>
    </div>
  );
}

function ClerkCheck() {
  const { data } = useLive(async () => {
    const [fund, res] = await Promise.all([getFund(), fetch("/api/attestation")]);
    const report = res.ok ? await res.json() : null;
    return { fund, build: (report?.build ?? null) as string | null, model: Boolean(report?.model) };
  }, 60000);
  const pinned = data?.fund.reviewer;
  const enclave = Boolean(pinned && /^[0-9a-f]{64}$/.test(pinned.code_hash));
  const localPrompt = sha256hex(PROMPT);
  return (
    <div className="card">
      <h3>The sealed clerk, checked live</h3>
      <dl className="kv small">
        <dt>Where it runs</dt>
        <dd>{pinned ? enclave ? <span className="chip good">In an enclave</span> : <span className="chip stop">On a server, so not private yet</span> : "–"}</dd>
        <dt>Build the DAO pinned</dt>
        <dd className="mono">{enclave ? shortHex(pinned!.code_hash, 10) : "–"}</dd>
        <dt>Build that made these keys</dt>
        <dd className="mono">{data?.build ? shortHex(data.build, 10) : "–"}</dd>
        <dt>Same build</dt>
        <dd>{enclave && data?.build ? pinned!.code_hash === data.build ? <span className="chip good">Yes</span> : <span className="chip stop">Different: the DAO must re-pin</span> : "–"}</dd>
        <dt>Signing key</dt>
        <dd className="mono">{pinned ? shortHex(pinned.signer, 10) : "–"}</dd>
        <dt>Encryption key</dt>
        <dd className="mono">{pinned ? shortHex(pinned.encryption_key, 10) : "–"}</dd>
        <dt>Prompt on chain</dt>
        <dd className="mono">{pinned ? shortHex(pinned.prompt_sha256, 10) : "–"}</dd>
        <dt>Prompt in this page</dt>
        <dd className="mono">{shortHex(localPrompt, 10)}</dd>
        <dt>Model</dt>
        <dd>{MODEL}</dd>
        <dt>NEAR AI&apos;s report for it</dt>
        <dd>{data ? data.model ? <span className="chip good">Published</span> : <span className="chip">Not available</span> : "–"}</dd>
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
