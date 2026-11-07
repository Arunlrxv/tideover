import Link from "next/link";
import { Figures, LedgerList } from "@/components/Ledger";
import { Sealed } from "@/components/Seal";

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="wrap">
          <div>
            <p className="eyebrow">A community hardship fund on NEAR</p>
            <h1>Help in your worst month, without telling anyone why.</h1>
            <p className="lede">
              Members pay small dues into their community&apos;s own treasury. When someone needs help, nobody can see who
              asked or why, and anyone can check that every rule was followed.
            </p>
            <div className="btn-row">
              <Link className="btn" href="/member">
                Try it, no wallet needed
              </Link>
              <Link className="btn ghost" href="/ledger">
                Read the public ledger
              </Link>
            </div>
          </div>
          <div>
            <p className="eyebrow">Live from the chain</p>
            <LedgerList limit={4} compact />
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <h2>A public treasury is the wrong place for your worst month.</h2>
          <p className="lede">
            A DAO is good at showing everyone everything. That is what you want for a grant. It is the last thing you want
            when the payment is for a cancer bill or an eviction notice, because the record is permanent.
          </p>
          <div className="compare">
            <figure>
              <figcaption>A normal DAO proposal</figcaption>
              <div className="entry exposed">
                <p className="what">
                  Pay <mark>rosa.near</mark> $300 for <mark>her son&apos;s chemotherapy deposit</mark>
                </p>
                <span className="muted small">Public forever. Voted on by name.</span>
              </div>
            </figure>
            <figure>
              <figcaption>The same help on Tideover</figcaption>
              <div className="entry">
                <p className="what">Claim #7, $300, paid to a fresh address</p>
                <Sealed />
                <div className="muted small" style={{ marginTop: 6 }}>
                  Member proof, cover limit, one claim per quarter and the sealed review are all checked on chain.
                </div>
              </div>
            </figure>
          </div>
        </div>
      </section>

      <section className="band sunk">
        <div className="wrap">
          <h2>How it works</h2>
          <ol className="flow">
            <li>
              <h3>Earn cover</h3>
              <p className="muted">
                Dues go straight to the community&apos;s Sputnik DAO. A longer record unlocks a higher limit.
              </p>
            </li>
            <li>
              <h3>Ask anonymously</h3>
              <p className="muted">
                A zero-knowledge proof shows a paid-up member made this claim. It does not show which one.
              </p>
            </li>
            <li>
              <h3>Seal the reason</h3>
              <p className="muted">
                Your document is encrypted in your browser. Only an AI model in a secure enclave reads it, and it can only
                answer in fixed fields, so it has no way to repeat a name.
              </p>
            </li>
            <li>
              <h3>Get paid by the rules</h3>
              <p className="muted">
                Small claims pay automatically, mid-size claims go to three random members, and large ones go to the
                council. The AI never touches the money.
              </p>
            </li>
          </ol>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <h2>This fund, right now</h2>
          <Figures />
          <p className="small muted" style={{ marginTop: 12 }}>
            Read directly from NEAR testnet by your browser.
          </p>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="grid-3">
            <div>
              <h3>Your DAO keeps the money</h3>
              <p className="muted">
                Tideover is a role in your Sputnik DAO, limited to transfers. Install it with two ordinary proposals, and
                remove it with one.
              </p>
              <Link href="/install">See the install</Link>
            </div>
            <div>
              <h3>Try to break it</h3>
              <p className="muted">
                Forge a review, change an amount, claim twice. Every attempt runs against the live contract, and you see
                its refusal.
              </p>
              <Link href="/break-it">Open the attack lab</Link>
            </div>
            <div>
              <h3>What it does not hide</h3>
              <p className="muted">
                Amounts and timing are public, and a small fund gives less cover. We say exactly where the limits are.
              </p>
              <Link href="/trust">Read the limits</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
