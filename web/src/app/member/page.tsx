"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLive } from "@/components/Ledger";
import { getFund, getMember, tokenBalance } from "@/lib/chain";
import { accountUrl, isDeployed, txUrl } from "@/lib/config";
import { usd } from "@/lib/format";
import { forgetMember, joinDemo, loadMember, payDues, type LocalMember } from "@/lib/member";

type Quote = { label: string; amountIn?: string; timeEstimate?: number };

export default function MemberPage() {
  const [me, setMe] = useState<LocalMember | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [lastTx, setLastTx] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setMe(loadMember());
    setReady(true);
  }, []);

  const { data } = useLive(
    async () => {
      const fund = await getFund();
      const account = loadMember()?.account;
      if (!account) return { fund, member: null, balance: "0" };
      const [member, balance] = await Promise.all([getMember(account), tokenBalance(account)]);
      return { fund, member, balance };
    },
    4000,
  );

  async function join() {
    setBusy("Creating your account and your secret on this device…");
    setError("");
    try {
      setMe(await joinDemo());
      setTick(tick + 1);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy("");
  }

  async function dues() {
    if (!me || !data) return;
    setBusy("Paying dues. The relay covers the gas…");
    setError("");
    try {
      const { hash } = await payDues(me, data.fund.rules.dues);
      setLastTx(hash);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy("");
  }

  const fund = data?.fund;
  const member = data?.member;

  return (
    <div className="page">
      <div className="wrap">
        <p className="eyebrow">Membership</p>
        <h1>{member ? "Your place in the fund" : "Join Harbor Mutual"}</h1>
        <p className="lede">
          Harbor Mutual is a demo community with a real Sputnik DAO on NEAR testnet. Membership needs no wallet and no gas.
          Your keys are made in this browser and stay here.
        </p>

        {!isDeployed() && <div className="notice warn">The demo fund is not deployed yet.</div>}

        <div className="split">
          <div>
            {ready && !me && isDeployed() && (
              <div className="card">
                <h3>Start as a new member</h3>
                <p className="muted">
                  You&apos;ll get a named account, 100 test dollars and a record of seven paid months, so you can try a claim
                  straight away.
                </p>
                <button className="btn" onClick={join} disabled={Boolean(busy)}>
                  Join the fund
                </button>
              </div>
            )}

            {member && fund && (
              <>
                <div className="figures">
                  <div className="figure">
                    <span className="value">{usd(member.cap)}</span>
                    <span className="label">Your cover, tier {member.tier}</span>
                  </div>
                  <div className="figure">
                    <span className="value">{member.paid_periods}</span>
                    <span className="label">Months paid</span>
                  </div>
                  <div className="figure">
                    <span className="value">{member.service_points}</span>
                    <span className="label">Panels served</span>
                  </div>
                </div>

                <div className="card" style={{ marginTop: 18 }}>
                  {member.paid_this_period ? (
                    <>
                      <h3>You&apos;re paid up</h3>
                      <p className="muted">
                        This month&apos;s {usd(fund.rules.dues)} went straight to the DAO. Paying added you to this month&apos;s
                        anonymous group, so you can now ask for help without saying who you are.
                      </p>
                      <Link className="btn" href="/claim">
                        Ask for help
                      </Link>
                    </>
                  ) : (
                    <>
                      <h3>Pay this month&apos;s dues</h3>
                      <p className="muted">
                        {usd(fund.rules.dues)} goes straight to the DAO&apos;s treasury. This contract never holds it. You hold{" "}
                        {usd(data?.balance ?? "0")}, and no NEAR for gas.
                      </p>
                      <button className="btn" onClick={dues} disabled={Boolean(busy)}>
                        Pay {usd(fund.rules.dues)}
                      </button>
                    </>
                  )}
                  {lastTx && (
                    <p className="small muted" style={{ marginTop: 12 }}>
                      Paid. <a href={txUrl(lastTx)}>See the transaction</a>
                    </p>
                  )}
                </div>

                <TierLadder score={member.score} tiers={fund.rules.tiers} />
              </>
            )}

            {busy && <div className="notice">{busy}</div>}
            {error && <div className="notice bad">{error}</div>}
          </div>

          <div>
            <div className="card">
              <h3>On this device</h3>
              {me ? (
                <dl className="kv">
                  <dt>Account</dt>
                  <dd>
                    <a href={accountUrl(me.account)}>{me.account}</a>
                  </dd>
                  <dt>Secret</dt>
                  <dd className="muted">Held here. It never leaves.</dd>
                  <dt>Commitment</dt>
                  <dd className="mono small">{member?.commitment?.slice(0, 18)}…</dd>
                </dl>
              ) : (
                <p className="muted">Nothing yet.</p>
              )}
              {me && (
                <button
                  className="btn ghost small-btn"
                  style={{ marginTop: 14 }}
                  onClick={() => {
                    forgetMember();
                    setMe(null);
                  }}
                >
                  Forget this member
                </button>
              )}
            </div>
            <IntentsQuote />
          </div>
        </div>
      </div>
    </div>
  );
}

function TierLadder({ score, tiers }: { score: number; tiers: { min_score: number; cap: string }[] }) {
  return (
    <div className="card">
      <h3>How cover grows</h3>
      <p className="muted small">Every paid month and every panel you serve on adds one point. Nobody can buy a higher tier.</p>
      <div className="table-scroll">
        <table className="plain">
          <thead>
            <tr>
              <th>Points</th>
              <th>Cover per claim</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tiers.map((t, i) => (
              <tr key={t.min_score}>
                <td>{t.min_score}+</td>
                <td>{i === 0 ? "Waiting period" : usd(t.cap)}</td>
                <td>{score >= t.min_score && (i === tiers.length - 1 || score < tiers[i + 1].min_score) ? <span className="chip good">You</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IntentsQuote() {
  const [from, setFrom] = useState("solana");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let stop = false;
    setQuote(null);
    setErr("");
    fetch(`/api/intents/quote?from=${from}`)
      .then((r) => r.json())
      .then((j) => {
        if (stop) return;
        if (j.error) setErr(j.error);
        else setQuote(j);
      })
      .catch(() => !stop && setErr("No quote right now"));
    return () => {
      stop = true;
    };
  }, [from]);

  return (
    <div className="card">
      <h3>Dues from any chain</h3>
      <p className="muted small">
        NEAR Intents lets a member pay in stablecoins from another chain. This is a live mainnet quote for one month&apos;s
        dues. It does not execute, because Intents has no testnet.
      </p>
      <label className="field">
        <span className="small">Pay with</span>
        <select value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="solana">USDC on Solana</option>
          <option value="base">USDC on Base</option>
          <option value="arbitrum">USDC on Arbitrum</option>
        </select>
      </label>
      {quote && (
        <p className="small">
          Send <strong>{quote.amountIn}</strong> {quote.label.split(" ")[0]}, arrives as 10 USDC on NEAR in about {quote.timeEstimate ?? "?"}s.
        </p>
      )}
      {err && <p className="small muted">{err}</p>}
    </div>
  );
}
