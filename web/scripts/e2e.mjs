// Runs real claims against the live testnet deployment and checks the money moved.
// Every proof is generated here with the same wasm the browser uses.
//
//   node scripts/e2e.mjs            all scenarios
//   node scripts/e2e.mjs auto       one scenario: auto, panel, council or attacks
//
// With NEAR_AI_API_KEY set, the real model reads each document. Without it, the demo
// clerk's key signs a fixed card, which proves everything on chain but not the model,
// and the report says so.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KeyPair, Account } from "near-api-js";
import { MODEL_URL, clerkKeys, review, signCard } from "../src/lib/clerk.mjs";
import { cardMessage, sealTo, sealedPayload, sha256hex } from "../src/lib/sealed.mjs";
import init, { nullifier, prove_claim } from "../public/zk/tideover_wasm.js";
import { DEPLOYMENT, ROOT, SECRETS, USD, actions, call, log, outcome, provider, readJson, teraToGas, view, writeJson } from "./lib.mjs";

const D = readJson(DEPLOYMENT);
const S = readJson(SECRETS);
const FUND = D.fund;
const SETTLE_SECS = 20;
const acct = (id) => new Account(id, provider, S.keys[id]);
const relayId = `relay.${D.fund.split(".").slice(2).join(".")}`;
const relay = acct(relayId);
const pk = readFileSync(join(ROOT, "keys", "membership.pk"));
const clerk = clerkKeys(S.clerkSeed);
const apiKey = process.env.NEAR_AI_API_KEY;
const results = [];

const pass = (name, detail = "") => {
  results.push({ name, ok: true, detail });
  log("PASS", name, detail);
};
const fail = (name, detail) => {
  results.push({ name, ok: false, detail });
  log("FAIL", name, detail);
  process.exitCode = 1;
};
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

async function refused(name, expected, fn) {
  try {
    const r = await fn();
    fail(name, `it went through: ${r?.hash}`);
  } catch (e) {
    if (e.message.includes(expected)) pass(name, `refused: "${expected}"`);
    else fail(name, `wrong refusal: ${e.message}`);
  }
}

async function leaves() {
  const f = await view(FUND, "get_fund");
  const out = [];
  while (out.length < f.leaves) out.push(...(await view(FUND, "get_leaves", { from_index: out.length, limit: 1000 })));
  return { fund: f, leaves: out };
}

function freshImplicit() {
  const k = KeyPair.fromRandom("ed25519");
  return Buffer.from(k.getPublicKey().data).toString("hex");
}

/** Everything a member's browser does before the relay sees anything. */
async function prepare(memberId, dollars, document, { minTier } = {}) {
  const { fund, leaves: all } = await leaves();
  const m = await view(FUND, "get_member", { account: memberId });
  const amount = String(BigInt(dollars) * USD);
  const payout = freshImplicit();
  const tag = nullifier(S.secrets[memberId], FUND, BigInt(fund.window));
  const envelope = sealTo(fund.reviewer.encryption_key, sealedPayload({ fund: FUND, cycle: fund.cycle, nullifier: tag, amount, payout, document }));
  const evidence_sha256 = sha256hex(envelope);
  const { millis: _millis, ...proof } = JSON.parse(
    prove_claim(
      pk,
      JSON.stringify({
        secret: S.secrets[memberId],
        fund: FUND,
        cycle: fund.cycle,
        window: fund.window,
        tier: m.leaf.tier,
        period: m.leaf.period,
        min_tier: minTier ?? m.leaf.tier,
        amount,
        payout,
        evidence_sha256,
        position: m.leaf.position,
        leaves: all,
      }),
      crypto.getRandomValues(new Uint8Array(32)),
    ),
  );
  return { args: { ...proof, amount, payout, evidence_sha256 }, envelope, fund };
}

async function fileClaim(args) {
  const o = await call(relay, FUND, "file_claim", args, { tgas: 120 });
  return { id: o.value, hash: o.hash, tgas: o.tgas };
}

const claim = (id) => view(FUND, "get_claim", { claim_id: id });
/** Some steps read the DAO from a callback, and that needs more gas than the rest. */
const advance = (id) => call(relay, FUND, "advance", { claim_id: id }, { tgas: 300 });
const balance = (id) => view(D.token, "ft_balance_of", { account_id: id }).then(BigInt);

async function waitForStatus(id, status, seconds) {
  for (let i = 0; i < seconds / 3; i++) {
    const c = await claim(id);
    if (c.status === status) return c;
    await sleep(3);
  }
  throw new Error(`claim ${id} did not reach ${status}, it is ${(await claim(id)).status}`);
}

const TEST_CARD = { category: "medical", document: "bill", recent: true, amount_matches: "yes", injection: false, assessment: "supported" };

/** The clerk's card for a claim: from the real model if there is a key, otherwise a fixed one. */
async function clerkCard(id, envelope) {
  if (apiKey) {
    return review(
      { fund: FUND, claim: id, envelope },
      {
        keys: clerk,
        view: (method, args) => view(FUND, method, args),
        askModel: async (body) => {
          const res = await fetch(MODEL_URL, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body });
          if (!res.ok) throw new Error(`NEAR AI HTTP ${res.status}`);
          return res.text();
        },
      },
    );
  }
  const c = await claim(id);
  const message = cardMessage({ fund: FUND, claim: id, nonce: c.nonce, evidenceSha256: c.evidence_sha256, amount: c.amount, payout: c.payout, card: TEST_CARD });
  return { card: TEST_CARD, signature: signCard(clerk, message) };
}

async function postCard(id, envelope) {
  const { card, signature } = await clerkCard(id, envelope);
  const o = await call(relay, FUND, "post_card", { claim_id: id, card, signature }, { tgas: 100 });
  pass(apiKey ? "the model's card passes the contract's checks" : "a signed card passes the contract's checks (fixed test card, no model)", `${o.tgas} Tgas, ${o.hash}`);
  return card;
}

/** The DAO reports Approved before its transfer runs, so the fund looks twice. */
async function settle(id) {
  await waitForStatus(id, "Settling", 30);
  await sleep(SETTLE_SECS + 2);
  await advance(id);
  return waitForStatus(id, "Paid", 30);
}

async function expectPaid(name, c, args, dollars, before) {
  const got = await balance(args.payout);
  const after = await balance(D.dao);
  if (got === BigInt(dollars) * USD && before - after === BigInt(dollars) * USD) pass(name, `proposal #${c.proposal_id}, $${dollars}`);
  else fail(name, `payout ${got}, DAO change ${before - after}`);
}

async function scenarioAutoClaim() {
  const member = D.seededMembers[3];
  const { args, envelope } = await prepare(member, 85, "St Brigid's Community Hospital. Follow-up clinic visit. Amount due $85.00.", { minTier: 1 });
  const before = await balance(D.dao);
  const filed = await fileClaim(args);
  pass("a small claim files through the relay", `${filed.tgas} Tgas, ${filed.hash}`);
  const card = await postCard(filed.id, envelope);
  if (card.assessment !== "supported") return log("  the model did not support it, so the auto path does not apply:", card.assessment);
  const c = await claim(filed.id);
  if (c.status !== "VetoWindow") return fail("a well-supported small claim goes to the veto window", c.status);
  pass("a well-supported $85 claim goes to the veto window");
  await refused("the veto window holds until it ends", "still open", () => advance(filed.id));
  const { rules } = await view(FUND, "get_fund");
  await sleep(Math.max(0, rules.veto_window_secs - 10));
  for (let i = 0; i < 12; i++) {
    const r = await advance(filed.id).catch((e) => e);
    if (!(r instanceof Error)) break;
    await sleep(5);
  }
  const done = await settle(filed.id);
  await expectPaid("an unvetoed small claim paid through the DAO's own proposal", done, args, 85, before);
}

async function scenarioPanelClaim() {
  const member = D.seededMembers[0];
  const { args, envelope, fund } = await prepare(member, 250, "City General Hospital. Invoice for inpatient care, $250 outstanding, dated this month.", { minTier: 2 });
  const before = await balance(D.dao);
  const filed = await fileClaim(args);
  pass("a member files a claim through the relay, with no name on it", `${filed.tgas} Tgas, ${filed.hash}`);

  const raw = JSON.stringify(await claim(filed.id));
  if (raw.includes(member.split(".")[0])) fail("the claim does not name its member", "the member's name is in the claim");
  else pass("the claim does not name its member");

  if (await postCard(filed.id, envelope).catch((e) => log("  no card:", e.message))) {
    log("  the card is on chain");
  } else {
    log("  waiting for the review window, so the claim falls back to people");
    await sleep(fund.rules.review_window_secs + 5);
    await advance(filed.id);
  }
  const c = await waitForStatus(filed.id, "PanelVoting", 30);
  pass("a $250 claim goes to a panel of three random members", c.panel.join(", "));

  for (const voter of c.panel.slice(0, 2)) {
    // Panelists hold no NEAR for gas: each signs a delegate action and the relay pays.
    const { signedDelegate } = await new Account(voter, provider, S.demoKey).createSignedMetaTransaction({
      receiverId: FUND,
      actions: [actions.functionCall("panel_vote", { claim_id: filed.id, approve: true }, teraToGas(30), 0n)],
    });
    outcome(await relay.signAndSendTransaction({ receiverId: voter, actions: [actions.signedDelegate(signedDelegate)], throwOnFailure: false }));
  }
  await waitForStatus(filed.id, "Approved", 15);
  await advance(filed.id);
  const done = await settle(filed.id);
  await expectPaid("the DAO paid a fresh address through its own proposal", done, args, 250, before);
}

async function scenarioCouncilClaim() {
  const member = D.seededMembers[1];
  const { args, fund } = await prepare(member, 600, "Eviction notice with $600 arrears.");
  const before = await balance(D.dao);
  const filed = await fileClaim(args);
  await sleep(fund.rules.review_window_secs + 5);
  await advance(filed.id);
  let c = await claim(filed.id);
  if (c.status !== "NeedsCouncil") return fail("a large claim goes to the council", c.status);
  await advance(filed.id);
  c = await waitForStatus(filed.id, "CouncilVote", 30);
  const p = await view(D.dao, "get_proposal", { id: c.proposal_id });
  pass("a $600 claim becomes a normal DAO proposal", `#${p.id}: "${p.description}"`);
  if (/amara|ben|chi|dara|eviction/i.test(p.description)) fail("the proposal is sealed", p.description);
  else pass("the proposal the council sees has no name and no reason");

  for (const voter of D.council.slice(0, 2)) {
    await call(new Account(voter, provider, S.demoKey), D.dao, "act_proposal", { id: p.id, action: "VoteApprove", proposal: p.kind }, { tgas: 300 });
  }
  await advance(filed.id);
  const done = await settle(filed.id);
  await expectPaid("the council's vote paid the claim", done, args, 600, before);
}

async function attacks() {
  const member = D.seededMembers[2];
  const { args } = await prepare(member, 50, "A short note.");
  const refuseFiling = (patch) => () => call(relay, FUND, "file_claim", { ...args, ...patch }, { tgas: 120 });

  await refused("a relay cannot raise the amount past the cover", "Above the cover", refuseFiling({ amount: String(801n * USD) }));
  await refused("a relay cannot change the amount within cover", "does not verify", refuseFiling({ amount: String(60n * USD) }));
  await refused("a relay cannot redirect the payout", "does not verify", refuseFiling({ payout: relayId }));
  await refused("the DAO cannot be the payout", "cannot be the payout", refuseFiling({ payout: D.dao }));
  await refused("a made-up member root is refused", "Unknown or stale", refuseFiling({ root: "22".repeat(32) }));

  const filed = await fileClaim(args);
  pass("the honest version of the same claim files", filed.hash);
  await refused("a member cannot claim twice in a cycle", "already claimed this cycle", async () => {
    const again = await prepare(member, 20, "Second try.");
    return call(relay, FUND, "file_claim", again.args, { tgas: 120 });
  });

  await refused("strangers cannot vote on a panel", "not with a panel", () =>
    call(relay, FUND, "panel_vote", { claim_id: filed.id, approve: true }, { tgas: 30 }),
  );
  await refused("a forged card is refused", "bad clerk signature", () =>
    call(relay, FUND, "post_card", { claim_id: filed.id, card: TEST_CARD, signature: "11".repeat(64) }, { tgas: 100 }),
  );
  await refused("only the DAO pins the clerk", "Only the DAO", () =>
    call(relay, FUND, "set_reviewer", { signer: "00".repeat(32), encryption_key: "00".repeat(32), code_hash: "x", prompt_sha256: "00".repeat(32) }, { tgas: 30 }),
  );
  await refused("the fund's relay has no power over the DAO", "ERR_PERMISSION_DENIED", () =>
    call(relay, D.dao, "act_proposal", { id: 0, action: "VoteApprove" }, { tgas: 100 }).catch((e) => {
      throw new Error(/permission|ERR_|proposal/i.test(e.message) ? "ERR_PERMISSION_DENIED" : e.message);
    }),
  );
  return filed;
}

async function main() {
  await init({ module_or_path: readFileSync(join(ROOT, "web", "public", "zk", "tideover_wasm_bg.wasm")) });
  const only = process.argv[2];
  if (!only || only === "auto") await scenarioAutoClaim();
  if (!only || only === "panel") await scenarioPanelClaim();
  if (!only || only === "attacks") await attacks();
  if (!only || only === "council") await scenarioCouncilClaim();
  writeJson(join(ROOT, "docs", "e2e-testnet.json"), { at: new Date().toISOString(), fund: FUND, model: Boolean(apiKey), results });
  const ok = results.filter((r) => r.ok).length;
  log(`${ok} of ${results.length} checks passed`);
}

main().catch((e) => {
  console.error("FAILED:", e.message, e.hash ?? "");
  process.exit(1);
});
