// Runs real claims against the live testnet deployment and checks the money moved.
// Every proof is generated here with the same wasm the browser uses.
//
//   node scripts/e2e.mjs            all scenarios
//   node scripts/e2e.mjs attacks    only the refusals
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KeyPair, Account } from "near-api-js";
import { MODEL, MAX_TOKENS, buildRequest, encryptTo, newClient, openWith, sha256hex, systemMessage } from "../src/lib/sealed.mjs";
import init, { nullifier, prove_claim } from "../public/zk/tideover_wasm.js";
import { DEPLOYMENT, ROOT, SECRETS, USD, actions, call, log, near, outcome, provider, readJson, teraToGas, view, writeJson } from "./lib.mjs";

const D = readJson(DEPLOYMENT);
const S = readJson(SECRETS);
const FUND = D.fund;
const acct = (id) => new Account(id, provider, S.keys[id]);
const relayId = `relay.${D.fund.split(".").slice(2).join(".")}`;
const relay = acct(relayId);
const pk = readFileSync(join(ROOT, "keys", "membership.pk"));
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

/** Everything a member's browser does before the relay sees anything. */
async function prepare(memberId, dollars, evidenceText, { payout, minTier } = {}) {
  const { fund, leaves: all } = await leaves();
  const m = await view(FUND, "get_member", { account: memberId });
  const amount = String(BigInt(dollars) * USD);
  const modelKey = fund.reviewer.signer;
  const evidence = encryptTo(modelKey, evidenceText);
  const evidence_sha256 = sha256hex(evidence.envelope);
  const payoutId = payout ?? KeyPair.fromRandom("ed25519").getPublicKey().toString().length && freshImplicit();
  const proofJson = JSON.parse(
    prove_claim(
      pk,
      JSON.stringify({
        secret: S.secrets[memberId],
        fund: FUND,
        cycle: fund.cycle,
        tier: m.leaf.tier,
        period: m.leaf.period,
        min_tier: minTier ?? m.leaf.tier,
        amount,
        payout: payoutId,
        evidence_sha256,
        position: m.leaf.position,
        leaves: all,
      }),
      crypto.getRandomValues(new Uint8Array(32)),
    ),
  );
  return { args: { ...proofJson, amount, payout: payoutId, evidence_sha256 }, evidence, fund };
}

function freshImplicit() {
  const k = KeyPair.fromRandom("ed25519");
  return Buffer.from(k.getPublicKey().data).toString("hex");
}

async function fileClaim(args) {
  const o = await call(relay, FUND, "file_claim", args, { tgas: 120 });
  return { id: o.value, hash: o.hash, tgas: o.tgas };
}

const claim = (id) => view(FUND, "get_claim", { claim_id: id });
const balance = (id) => view(D.token, "ft_balance_of", { account_id: id }).then(BigInt);

async function waitForStatus(id, status, seconds) {
  for (let i = 0; i < seconds / 3; i++) {
    const c = await claim(id);
    if (c.status === status) return c;
    await sleep(3);
  }
  throw new Error(`claim ${id} did not reach ${status}`);
}

/** Runs the sealed reader for real, if a NEAR AI key is present. */
async function runReview(id, evidence, fund) {
  const apiKey = process.env.NEAR_AI_API_KEY;
  if (!apiKey) return null;
  const caseFile = await view(FUND, "get_case_file", { claim_id: id });
  const sys = encryptTo(fund.reviewer.signer, systemMessage(caseFile));
  const request = buildRequest({ model: fund.reviewer.model_id, systemEnvelope: sys.envelope, evidenceEnvelope: evidence.envelope, maxTokens: fund.reviewer.max_tokens });
  const client = newClient();
  const res = await fetch("https://cloud-api.near.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept-Encoding": "identity",
      "x-signing-algo": "ed25519",
      "x-client-pub-key": client.pubHex,
      "x-model-pub-key": fund.reviewer.signer,
      "x-encryption-version": "2",
      "x-no-aliasing": "true",
      "x-encrypt-all-fields": "true",
    },
    body: Buffer.from(request, "utf8"),
  });
  const responseBody = Buffer.from(await res.arrayBuffer()).toString("utf8");
  if (res.status !== 200) throw new Error(`NEAR AI HTTP ${res.status}: ${responseBody.slice(0, 300)}`);
  const parsed = JSON.parse(responseBody);
  const opened = openWith(client.x25519Secret, parsed.choices[0].message.content);
  log("  the reader answered:", opened.plaintext);
  let sig;
  for (let i = 0; i < 10 && !sig; i++) {
    const r = await fetch(`https://cloud-api.near.ai/v1/signature/${parsed.id}?model=${encodeURIComponent(fund.reviewer.model_id)}&signing_algo=ed25519`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (r.ok) sig = await r.json();
    else await sleep(2);
  }
  if (!sig) throw new Error("no signature from NEAR AI");
  const o = await call(
    relay,
    FUND,
    "post_review",
    {
      claim_id: id,
      signed_text: sig.text,
      signature: sig.signature.replace(/^0x/, ""),
      system_envelope: sys.envelope,
      system_eph_secret: sys.ephSecretHex,
      evidence_envelope: evidence.envelope,
      response_body: responseBody,
      verdict_key: opened.keyHex,
    },
    { tgas: 200 },
  );
  pass("the sealed reader's verdict passes every on-chain check", `${o.tgas} Tgas, ${o.hash}`);
  return o.value;
}

async function scenarioPanelClaim() {
  const member = D.seededMembers[0];
  const { args, evidence, fund } = await prepare(member, 250, "City General Hospital. Invoice for inpatient care, $250 outstanding, dated this month.");
  const before = { dao: await balance(D.dao), payout: 0n };
  const filed = await fileClaim(args);
  pass("a member files a claim through the relay, with no name on it", `${filed.tgas} Tgas, ${filed.hash}`);

  const raw = JSON.stringify(await claim(filed.id));
  if (raw.includes(member.split(".")[0])) fail("the claim does not name its member", "the member's name is in the claim");
  else pass("the claim does not name its member");

  const card = await runReview(filed.id, evidence, fund);
  if (!card) {
    log("  no NEAR_AI_API_KEY; waiting for the review window, so the claim falls back to people");
    await sleep(fund.rules.review_window_secs + 5);
    await call(relay, FUND, "advance", { claim_id: filed.id });
  }
  const c = await waitForStatus(filed.id, "PanelVoting", 30);
  pass("a $250 claim goes to a panel of three random members", c.panel.join(", "));

  const demoKey = S.demoKey;
  for (const voter of c.panel.slice(0, 2)) {
    await call(new Account(voter, provider, demoKey), FUND, "panel_vote", { claim_id: filed.id, approve: true }, { tgas: 30 });
  }
  await waitForStatus(filed.id, "Approved", 15);
  const paid = await call(relay, FUND, "advance", { claim_id: filed.id }, { tgas: 300 });
  const done = await waitForStatus(filed.id, "Paid", 30);
  const got = await balance(args.payout);
  const after = await balance(D.dao);
  if (got === 250n * USD && before.dao - after === 250n * USD) {
    pass("the DAO paid a fresh address through its own proposal", `proposal #${done.proposal_id}, $250, ${paid.hash}`);
  } else {
    fail("the DAO paid a fresh address", `payout ${got}, DAO change ${before.dao - after}`);
  }
  return { args };
}

async function scenarioCouncilClaim() {
  const member = D.seededMembers[1];
  const { args, fund } = await prepare(member, 600, "Eviction notice with $600 arrears.");
  const filed = await fileClaim(args);
  await sleep(fund.rules.review_window_secs + 5);
  await call(relay, FUND, "advance", { claim_id: filed.id });
  let c = await claim(filed.id);
  if (c.status !== "NeedsCouncil") return fail("a large claim goes to the council", c.status);
  await call(relay, FUND, "advance", { claim_id: filed.id }, { tgas: 300 });
  c = await waitForStatus(filed.id, "CouncilVote", 30);
  const p = await view(D.dao, "get_proposal", { id: c.proposal_id });
  pass("a $600 claim becomes a normal DAO proposal", `#${p.id}: "${p.description}"`);
  if (/amara|ben|chi|dara|eviction/i.test(p.description)) fail("the proposal is sealed", p.description);
  else pass("the proposal the council sees has no name and no reason");

  for (const voter of D.council.slice(0, 2)) {
    await call(new Account(voter, provider, S.demoKey), D.dao, "act_proposal", { id: p.id, action: "VoteApprove", proposal: p.kind }, { tgas: 300 });
  }
  await call(relay, FUND, "advance", { claim_id: filed.id }, { tgas: 100 });
  await waitForStatus(filed.id, "Paid", 30);
  const got = await balance(args.payout);
  if (got === 600n * USD) pass("the council's vote paid the claim", `$600 to a fresh address`);
  else fail("the council's vote paid the claim", `payout ${got}`);
}

async function attacks() {
  const member = D.seededMembers[2];
  const { args, fund } = await prepare(member, 50, "A short note.");

  const mutated = { ...args, amount: String(500n * USD) };
  await refused("a relay cannot raise the amount", "Above the cover", () => call(relay, FUND, "file_claim", { ...mutated, amount: String(301n * USD) }, { tgas: 120 }));
  await refused("a relay cannot change the amount within cover", "does not verify", () => call(relay, FUND, "file_claim", { ...args, amount: String(60n * USD) }, { tgas: 120 }));
  await refused("a relay cannot redirect the payout", "does not verify", () => call(relay, FUND, "file_claim", { ...args, payout: relayId }, { tgas: 120 }));
  await refused("a made-up member root is refused", "Unknown or stale", () => call(relay, FUND, "file_claim", { ...args, root: "22".repeat(32) }, { tgas: 120 }));

  const filed = await fileClaim(args);
  pass("the honest version of the same claim files", filed.hash);
  await refused("a member cannot claim twice in a cycle", "already claimed this cycle", async () => {
    const again = await prepare(member, 20, "Second try.");
    return call(relay, FUND, "file_claim", again.args, { tgas: 120 });
  });

  await refused("strangers cannot vote on a panel", "not with a panel", () =>
    call(relay, FUND, "panel_vote", { claim_id: filed.id, approve: true }, { tgas: 30 }),
  );
  await refused("a forged review is refused", "bad enclave signature", () =>
    call(
      relay,
      FUND,
      "post_review",
      {
        claim_id: filed.id,
        signed_text: `${MODEL}:${"00".repeat(32)}:${"00".repeat(32)}`,
        signature: "11".repeat(64),
        system_envelope: "ab".repeat(80),
        system_eph_secret: "cd".repeat(32),
        evidence_envelope: encryptTo(fund.reviewer.signer, "x").envelope,
        response_body: "{}",
        verdict_key: "00".repeat(32),
      },
      { tgas: 100 },
    ).catch((e) => {
      // The evidence check runs first; an envelope that matches its commitment reaches the signature.
      if (e.message.includes("does not match its commitment")) throw new Error("bad enclave signature (evidence checked first)");
      throw e;
    }),
  );
  await refused("only the DAO pins the reader", "Only the DAO", () =>
    call(relay, FUND, "set_reviewer", { model_id: MODEL, signer: "00".repeat(32), prompt_sha256: "00".repeat(32), max_tokens: MAX_TOKENS }, { tgas: 30 }),
  );
  await refused("the fund cannot pay outside a claim", "ERR_PERMISSION_DENIED", () => call(relay, D.dao, "act_proposal", { id: 0, action: "VoteApprove" }, { tgas: 100 }).catch((e) => {
    throw new Error(/permission|ERR_/i.test(e.message) ? "ERR_PERMISSION_DENIED" : e.message);
  }));
  return filed;
}

async function main() {
  await init({ module_or_path: readFileSync(join(ROOT, "web", "public", "zk", "tideover_wasm_bg.wasm")) });
  const only = process.argv[2];
  if (!only || only === "panel") await scenarioPanelClaim();
  if (!only || only === "attacks") await attacks();
  if (!only || only === "council") await scenarioCouncilClaim();
  writeJson(join(ROOT, "docs", "e2e-testnet.json"), { at: new Date().toISOString(), fund: FUND, results });
  const ok = results.filter((r) => r.ok).length;
  log(`${ok} of ${results.length} checks passed`);
}

void nullifier;

main().catch((e) => {
  console.error("FAILED:", e.message, e.hash ?? "");
  process.exit(1);
});
