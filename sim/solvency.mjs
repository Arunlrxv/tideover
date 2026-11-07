// Can a fund like this survive? This simulates the demo fund's own rules for three
// years, thousands of times, with honest claims and with cheats who forge documents.
//
//   node sim/solvency.mjs            prints a table and writes docs/solvency.json
//
// It answers one question: when cheats exist, what do the caps actually limit?
// All the probabilities below are assumptions, not measurements. Change them.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RUNS = 10_000;
const MONTHS = 36;
const MONTHS_PER_CYCLE = 3;

const CYCLES_PER_YEAR = 4;

const FUND = {
  members: 40,
  dues: 10,
  startingReserve: 0,
  cycleBudget: 1500,
  autoLimit: 100,
  panelLimit: 400,
  // [months of record, limit per claim, limit per year]: the demo fund's tiers.
  tiers: [
    [0, 0, 0],
    [3, 100, 200],
    [6, 300, 450],
    [12, 800, 800],
  ],
};

const HONEST = {
  // The chance an honest member needs help in a given cycle.
  claimPerCycle: 0.05,
  // Most hardship is small.
  sizes: [
    [0.55, 80],
    [0.33, 220],
    [0.12, 600],
  ],
};

// A cheat forges a plausible document every cycle, for as much as the rules allow.
// Panels and councils see only the card, so they catch only some of them. A first
// small claim can take the automatic path, where nobody looks at all.
const CATCH = { auto: 0, panel: 0.25, council: 0.5 };

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tierAt = (months) => FUND.tiers.reduce((tier, t) => (months >= t[0] ? t : tier), FUND.tiers[0]);

function pickSize(r) {
  let x = r();
  for (const [p, size] of HONEST.sizes) {
    if (x < p) return size;
    x -= p;
  }
  return HONEST.sizes.at(-1)[1];
}

function caughtChance(amount, priorClaims) {
  if (amount > FUND.panelLimit) return CATCH.council;
  if (amount <= FUND.autoLimit && priorClaims === 0) return CATCH.auto;
  return CATCH.panel;
}

function run(cheatShare, seed) {
  const r = rng(seed);
  const cheats = Math.round(FUND.members * cheatShare);
  // Members start with a spread of records, as an established community would.
  const members = Array.from({ length: FUND.members }, (_, i) => ({ months: Math.floor(r() * 18), cheat: i < cheats, used: 0, claims: 0 }));
  let reserve = FUND.startingReserve;
  let lowest = reserve;
  const totals = { honestAsked: 0, honestPaid: 0, honestDollarsAsked: 0, honestDollarsPaid: 0, stolen: 0, emptied: 0 };

  for (let month = 1; month <= MONTHS; month++) {
    for (const m of members) {
      m.months += 1;
      reserve += FUND.dues;
    }
    if (month % MONTHS_PER_CYCLE) continue;
    const cycle = month / MONTHS_PER_CYCLE;
    if ((cycle - 1) % CYCLES_PER_YEAR === 0) {
      for (const m of members) {
        m.used = 0;
        m.claims = 0;
      }
    }

    // Everyone with a need this cycle, in a random order, so cheats have no special priority.
    const queue = [];
    for (const m of members) {
      const [, cap, yearCap] = tierAt(m.months);
      const room = Math.min(cap, yearCap - m.used);
      if (room <= 0) continue;
      if (m.cheat) queue.push({ cheat: true, amount: room, member: m });
      else if (r() < HONEST.claimPerCycle) queue.push({ cheat: false, amount: Math.min(pickSize(r), room), member: m });
    }
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }

    let budget = FUND.cycleBudget;
    for (const c of queue) {
      if (!c.cheat) {
        totals.honestAsked += 1;
        totals.honestDollarsAsked += c.amount;
      }
      if (c.amount > budget || c.amount > reserve) continue;
      const prior = c.member.claims;
      c.member.claims += 1;
      if (c.cheat && r() < caughtChance(c.amount, prior)) continue;
      budget -= c.amount;
      reserve -= c.amount;
      c.member.used += c.amount;
      if (c.cheat) totals.stolen += c.amount;
      else {
        totals.honestPaid += 1;
        totals.honestDollarsPaid += c.amount;
      }
    }
    lowest = Math.min(lowest, reserve);
    if (reserve < FUND.cycleBudget / 10) totals.emptied += 1;
  }
  return { ...totals, reserve, lowest, duesIn: FUND.members * FUND.dues * MONTHS };
}

function scenario(cheatShare) {
  const rows = [];
  for (let i = 0; i < RUNS; i++) rows.push(run(cheatShare, i * 7919 + 13));
  const mean = (f) => rows.reduce((s, x) => s + f(x), 0) / RUNS;
  const stolen = mean((x) => x.stolen);
  return {
    cheatShare,
    cheats: Math.round(FUND.members * cheatShare),
    honestClaimsPaid: mean((x) => x.honestPaid) / Math.max(1, mean((x) => x.honestAsked)),
    honestDollarsPaid: mean((x) => x.honestDollarsPaid) / Math.max(1, mean((x) => x.honestDollarsAsked)),
    stolenPerYear: stolen / (MONTHS / 12),
    stolenShareOfDues: stolen / mean((x) => x.duesIn),
    worstStolenPerYear: Math.max(...rows.map((x) => x.stolen)) / (MONTHS / 12),
    endReserve: mean((x) => x.reserve),
    runsNearlyEmptied: rows.filter((x) => x.emptied > 0).length / RUNS,
  };
}

const pct = (x) => `${(x * 100).toFixed(x < 0.1 && x > 0 ? 1 : 0)}%`;
const money = (x) => `$${Math.round(x).toLocaleString("en-US")}`;

const results = [0, 0.025, 0.05, 0.1, 0.2].map(scenario);

console.log(`${RUNS.toLocaleString("en-US")} runs of ${MONTHS} months, ${FUND.members} members paying $${FUND.dues} a month\n`);
console.log("Cheats   Honest claims paid   Honest $ paid   Stolen per year   Share of dues   Reserve after 3 years   Runs that nearly emptied");
for (const r of results) {
  console.log(
    `${String(r.cheats).padEnd(8)} ${pct(r.honestClaimsPaid).padEnd(20)} ${pct(r.honestDollarsPaid).padEnd(15)} ${money(r.stolenPerYear).padEnd(17)} ${pct(r.stolenShareOfDues).padEnd(15)} ${money(r.endReserve).padEnd(23)} ${pct(r.runsNearlyEmptied)}`,
  );
}

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "solvency.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ runs: RUNS, months: MONTHS, fund: FUND, honest: HONEST, catchRates: CATCH, results }, null, 2) + "\n");
