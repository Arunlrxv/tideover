// Deploys the Harbor demo community on NEAR testnet, one idempotent step at a time.
//
//   node scripts/deploy.mjs            run every step that has not run yet
//   node scripts/deploy.mjs reviewer   re-pin the attested model key through a DAO vote
//
// A real install is steps "fund" and "role": two ordinary proposals on an existing
// DAO. Everything else here only builds a demo community to install it on.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KeyPair } from "near-api-js";
import { MAX_TOKENS, MODEL, PROMPT, sha256hex } from "../src/lib/sealed.mjs";
import init, { commitment, new_secret } from "../public/zk/tideover_wasm.js";
import {
  DEPLOYMENT,
  ROOT,
  SECRETS,
  USD,
  accountOf,
  actions,
  call,
  log,
  near,
  outcome,
  provider,
  readJson,
  teraToGas,
  view,
  wasm,
  writeJson,
} from "./lib.mjs";
import { Account } from "near-api-js";

const MASTER = process.env.TIDEOVER_MASTER ?? "tideover-hq.testnet";
const DAO_FACTORY = "sputnikv2.testnet";
const DAO_NAME = process.env.TIDEOVER_DAO_NAME ?? "harbor-mutual";
const FUND_LABEL = "harbor";

const sub = (label) => `${label}.${MASTER}`;
const TOKEN = sub("usd");
const FACTORY = sub("funds");
const RELAY = sub("relay");
const JOINER = sub("m");
const DAO = `${DAO_NAME}.${DAO_FACTORY}`;
const FUND = `${FUND_LABEL}.${FACTORY}`;
const COUNCIL = ["maya", "tomas", "ines"].map(sub);
const MEMBERS = [
  ["amara", 13],
  ["ben", 12],
  ["chi", 8],
  ["dara", 7],
  ["eli", 6],
  ["farah", 5],
  ["goran", 4],
  ["hana", 3],
];

const RULES = {
  dues: String(10n * USD),
  period_secs: 30 * 24 * 3600,
  periods_per_cycle: 3,
  window_cycles: 4,
  tiers: [
    { min_score: 0, cap: "0", year_cap: "0" },
    { min_score: 3, cap: String(100n * USD), year_cap: String(200n * USD) },
    { min_score: 6, cap: String(300n * USD), year_cap: String(450n * USD) },
    { min_score: 12, cap: String(800n * USD), year_cap: String(800n * USD) },
  ],
  auto_limit: String(100n * USD),
  panel_limit: String(400n * USD),
  cycle_budget: String(15_000n * USD),
  panel_size: 3,
  panel_quorum: 2,
  review_window_secs: 150,
  veto_window_secs: 45,
  panel_window_secs: 1800,
  proposal_bond: String(near("0.1")),
  token_decimals: 6,
};

const S = readJson(SECRETS, { keys: {}, secrets: {}, done: {}, txs: {} });
const save = () => writeJson(SECRETS, S);
const master = accountOf(MASTER);

function keyOf(id) {
  S.keys[id] ??= KeyPair.fromRandom("ed25519").toString();
  save();
  return S.keys[id];
}
const pub = (key) => KeyPair.fromString(key).getPublicKey().toString();
const acct = (id) => new Account(id, provider, keyOf(id));

async function exists(id) {
  try {
    await provider.viewAccount({ accountId: id });
    return true;
  } catch {
    return false;
  }
}

async function ensureAccount(id, amount, extra = []) {
  if (await exists(id)) return;
  const r = await master.signAndSendTransaction({
    receiverId: id,
    actions: [actions.createAccount(), actions.transfer(near(amount)), actions.addFullAccessKey(KeyPair.fromString(keyOf(id)).getPublicKey()), ...extra],
    throwOnFailure: false,
  });
  outcome(r);
  log("created", id, `(${amount} NEAR)`);
}

async function step(name, fn) {
  if (S.done[name]) return;
  log("step:", name);
  await fn();
  S.done[name] = true;
  save();
}

async function deployAndInit(id, file, method, args) {
  const r = await acct(id).signAndSendTransaction({
    receiverId: id,
    actions: [actions.deployContract(wasm(file)), actions.functionCall(method, args, teraToGas(100), 0n)],
    throwOnFailure: false,
  });
  return outcome(r);
}

/** Files a proposal as the first council member, then votes it through. */
async function propose(description, kind) {
  const bond = BigInt((await view(DAO, "get_policy")).proposal_bond);
  const { value: id } = await call(acct(COUNCIL[0]), DAO, "add_proposal", { proposal: { description, kind } }, { deposit: bond, tgas: 50 });
  log(`  proposal #${id}: ${description}`);
  let last;
  for (const member of COUNCIL.slice(0, 2)) {
    last = await call(acct(member), DAO, "act_proposal", { id, action: "VoteApprove", proposal: kind }, { tgas: 300 });
  }
  const p = await view(DAO, "get_proposal", { id });
  if (p.status !== "Approved") throw new Error(`proposal ${id} ended as ${p.status}`);
  S.txs[description] = last.hash;
  save();
  return { id, hash: last.hash };
}

const functionCallKind = (receiver_id, method_name, args, deposit, gas) => ({
  FunctionCall: {
    receiver_id,
    actions: [
      {
        method_name,
        args: Buffer.from(JSON.stringify(args)).toString("base64"),
        deposit: String(deposit),
        gas: String(gas),
      },
    ],
  },
});

async function attestedKey() {
  const res = await fetch(`https://cloud-api.near.ai/v1/attestation/report?model=${encodeURIComponent(MODEL)}&signing_algo=ed25519`);
  if (!res.ok) throw new Error(`attestation report: HTTP ${res.status}`);
  const report = await res.json();
  const a = report.model_attestations?.find((m) => m.signing_public_key || m.signing_address);
  if (!a) throw new Error("no model attestation in the report");
  return (a.signing_public_key ?? a.signing_address).replace(/^0x/, "");
}

async function pinReviewer() {
  const signer = await attestedKey();
  const args = { model_id: MODEL, signer, prompt_sha256: sha256hex(PROMPT), max_tokens: MAX_TOKENS };
  await propose(
    `Pin the sealed reader: ${MODEL}, enclave key ${signer.slice(0, 12)}…`,
    functionCallKind(FUND, "set_reviewer", args, 0, teraToGas(50)),
  );
  log("  pinned", signer);
}

function writeOutputs() {
  writeJson(DEPLOYMENT, {
    network: "testnet",
    fund: FUND,
    dao: DAO,
    token: TOKEN,
    factory: FACTORY,
    tokenSymbol: "tUSD",
    tokenDecimals: 6,
    council: COUNCIL,
    guardians: [COUNCIL[0]],
    seededMembers: MEMBERS.map(([n]) => sub(n)),
    transactions: S.txs,
  });
  const env = [
    `TIDEOVER_RELAY_ACCOUNT=${RELAY}`,
    `TIDEOVER_RELAY_KEY=${keyOf(RELAY)}`,
    `TIDEOVER_JOINER_ACCOUNT=${JOINER}`,
    `TIDEOVER_JOINER_KEY=${keyOf(JOINER)}`,
    `TIDEOVER_DEMO_KEY=${S.demoKey}`,
    `NEAR_AI_API_KEY=${process.env.NEAR_AI_API_KEY ?? ""}`,
    "",
  ].join("\n");
  writeJson(join(ROOT, ".testnet", "public.json"), { fund: FUND, dao: DAO, token: TOKEN });
  return env;
}

async function main() {
  const wasmBytes = readFileSync(join(ROOT, "web", "public", "zk", "tideover_wasm_bg.wasm"));
  await init({ module_or_path: wasmBytes });
  S.demoKey ??= KeyPair.fromRandom("ed25519").toString();
  save();
  const demoPub = KeyPair.fromString(S.demoKey).getPublicKey();

  if (process.argv[2] === "reviewer") {
    await pinReviewer();
    return;
  }

  await step("accounts", async () => {
    await ensureAccount(TOKEN, 3);
    await ensureAccount(FACTORY, 7.6);
    await ensureAccount(RELAY, 1.5);
    await ensureAccount(JOINER, 1);
    await ensureAccount(COUNCIL[0], 6.7, [actions.addFunctionCallAccessKey(demoPub, DAO, ["act_proposal"], near(1))]);
    for (const c of COUNCIL.slice(1)) await ensureAccount(c, 0.3, [actions.addFunctionCallAccessKey(demoPub, DAO, ["act_proposal"], near(1))]);
  });

  await step("token", async () => {
    await deployAndInit(TOKEN, "tideover_test_usd.wasm", "new", {});
  });

  await step("dao", async () => {
    const args = Buffer.from(
      JSON.stringify({
        config: { name: DAO_NAME, purpose: "Harbor Mutual, a demo community for Tideover on NEAR testnet", metadata: "" },
        policy: COUNCIL,
      }),
    ).toString("base64");
    const r = await call(acct(COUNCIL[0]), DAO_FACTORY, "create", { name: DAO_NAME, args }, { deposit: near(6), tgas: 300 });
    S.txs["Create the DAO"] = r.hash;
  });

  await step("bond", async () => {
    await propose("Lower the proposal bond to 0.1 NEAR for the demo", {
      ChangePolicyUpdateParameters: {
        parameters: { proposal_bond: RULES.proposal_bond, proposal_period: null, bounty_bond: null, bounty_forgiveness_period: null },
      },
    });
  });

  await step("factory", async () => {
    await deployAndInit(FACTORY, "tideover_factory.wasm", "new", { owner: FACTORY });
    await acct(FACTORY).signAndSendTransaction({
      receiverId: FACTORY,
      actions: [actions.functionCall("set_code", wasm("tideover_fund.wasm"), teraToGas(100), 0n)],
    });
    log("  factory holds the fund code; a fund needs", (await view(FACTORY, "required_deposit")).toString(), "yoctoNEAR");
  });

  // ---- A real install is these two proposals. ----

  await step("fund", async () => {
    const deposit = BigInt(await view(FACTORY, "required_deposit"));
    const fundOutcome = await master.signAndSendTransaction({
      receiverId: DAO,
      actions: [actions.transfer(deposit + near(1))],
      throwOnFailure: false,
    });
    outcome(fundOutcome);
    const args = { name: FUND_LABEL, dao: DAO, token: TOKEN, rules: RULES, guardians: [COUNCIL[0]], registrar: RELAY };
    await propose(
      "Install Tideover: create our fund, with its rules",
      functionCallKind(FACTORY, "create_fund", args, deposit, teraToGas(220)),
    );
    if (!(await exists(FUND))) throw new Error("the fund account was not created");
  });

  await step("role", async () => {
    await propose("Install Tideover: give the fund a role limited to transfers", {
      ChangePolicyAddOrUpdateRole: {
        role: {
          name: "tideover",
          kind: { Group: [FUND] },
          permissions: ["transfer:AddProposal", "transfer:VoteApprove"],
          vote_policy: { transfer: { weight_kind: "RoleWeight", quorum: "0", threshold: [1, 1] } },
        },
      },
    });
  });

  // ---- The rest gives the demo community some history. ----

  await step("reviewer", pinReviewer);

  await step("seed-money", async () => {
    for (const id of [DAO, FUND]) {
      await call(acct(TOKEN), TOKEN, "mint", { account_id: id, amount: String(id === DAO ? 20_000n * USD : 0n) });
    }
  });

  await step("members", async () => {
    const relay = acct(RELAY);
    for (const [name, prior] of MEMBERS) {
      const id = sub(name);
      await ensureAccount(id, 0.02, [actions.addFunctionCallAccessKey(demoPub, FUND, ["panel_vote"], near(0.25))]);
      S.secrets[id] ??= new_secret(crypto.getRandomValues(new Uint8Array(32)));
      save();
      if (!(await view(FUND, "get_member", { account: id }))) {
        await call(relay, FUND, "admit", { account: id, prior_periods: prior, commitment: commitment(S.secrets[id]) });
      }
      await call(relay, TOKEN, "mint", { account_id: id, amount: String(100n * USD) });
      log("  admitted", id);
    }
  });

  await step("dues", async () => {
    // Members hold no NEAR for gas: each signs a delegate action and the relay pays.
    const relay = acct(RELAY);
    for (const [name] of MEMBERS) {
      const id = sub(name);
      const member = acct(id);
      const { signedDelegate } = await member.createSignedMetaTransaction({
        receiverId: TOKEN,
        actions: [actions.functionCall("ft_transfer_call", { receiver_id: FUND, amount: RULES.dues, msg: "dues" }, teraToGas(120), 1n)],
      });
      const r = await relay.signAndSendTransaction({ receiverId: id, actions: [actions.signedDelegate(signedDelegate)], throwOnFailure: false });
      const o = outcome(r);
      log("  dues paid", id, `${o.tgas} Tgas`);
    }
  });

  const env = writeOutputs();
  writeJson(join(ROOT, ".testnet", "env.json"), { env });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(ROOT, "web", ".env.local"), env);
  const fund = await view(FUND, "get_fund");
  log("deployed:", FUND, `members ${fund.members}, paid up ${fund.paid_up}, leaves ${fund.leaves}`);
}

main().catch((e) => {
  console.error("FAILED:", e.message, e.hash ?? "");
  process.exit(1);
});
