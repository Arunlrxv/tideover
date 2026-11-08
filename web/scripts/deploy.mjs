// Deploys the Harbor demo community on NEAR testnet, one idempotent step at a time.
//
//   node scripts/deploy.mjs            run every step that has not run yet
//   node scripts/deploy.mjs enclave    put the built clerk on OutLayer and pin it
//   node scripts/deploy.mjs factory    add the factory, so any DAO can install a fund
//
// This spends as little test NEAR as it can, about 12. To save the 5 a factory locks, the
// demo fund is created directly, as the factory would create it: same account name, same
// code, no keys. The factory can be added to that account later.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Account, KeyPair } from "near-api-js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { clerkKeys } from "../src/lib/clerk.mjs";
import { sendAndPoll } from "../src/lib/wait.mjs";
import { PROMPT, sha256hex } from "../src/lib/sealed.mjs";
import init, { commitment, new_secret } from "../public/zk/tideover_wasm.js";
import {
  DEPLOYMENT,
  ROOT,
  SECRETS,
  USD,
  accountOf,
  actions,
  aiKey,
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

const MASTER = process.env.TIDEOVER_MASTER ?? "tideover-hq.testnet";
const DAO_FACTORY = "sputnikv2.testnet";
const DAO_NAME = process.env.TIDEOVER_DAO_NAME ?? "harbor-mutual";
const FUND_LABEL = "harbor";
const OUTLAYER = "outlayer.testnet";
const OUTLAYER_API = "https://testnet-api.outlayer.ai";
const CLERK_WASM = join(ROOT, "target", "wasm32-wasip2", "release", "tideover-clerk.wasm");
const CLERK_PROFILE = "clerk";
/** Recorded on chain instead of a build hash, so a server clerk can't pass for an enclave. */
const SERVER_CLERK = "server-demo";
/** A new DAO locks about 5.41 NEAR. The rest pays for its proposals' storage. */
const DAO_DEPOSIT = 5.55;
/** Claims cost the fund about 0.02 NEAR each in storage. It can be topped up at any time. */
const FUND_WORKING_NEAR = 0.3;

const sub = (label) => `${label}.${MASTER}`;
const TOKEN = sub("usd");
const FACTORY = sub("funds");
const RELAY = sub("relay");
const JOINER = sub("m");
const DAO = `${DAO_NAME}.${DAO_FACTORY}`;
const FUND = `${FUND_LABEL}.${FACTORY}`;
const COUNCIL = ["maya", "tomas", "ines"].map(sub);
// Twelve points reach the top tier, and three members there make a group big enough to
// claim from. Five members fill a panel of three with some choice left.
const MEMBERS = [
  ["amara", 13],
  ["ben", 12],
  ["chi", 12],
  ["dara", 7],
  ["eli", 6],
];

const RULES = {
  dues: String(10n * USD),
  period_secs: 30 * 24 * 3600,
  periods_per_cycle: 3,
  window_cycles: 4,
  min_group: 3,
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
  council_panel: false,
  review_window_secs: 150,
  veto_window_secs: 45,
  panel_window_secs: 1800,
  // The DAO's voting period below is seven days. This is a day past it.
  council_window_secs: 8 * 24 * 3600,
  proposal_bond: String(near("0.01")),
  token_decimals: 6,
};

const DAYS_NS = 24n * 3600n * 1_000_000_000n;
// Set at creation, so the DAO needs no first proposal, and no 1 NEAR default bond, to change it.
const POLICY = {
  roles: [
    {
      name: "council",
      kind: { Group: COUNCIL },
      permissions: ["*:AddProposal", "*:VoteApprove", "*:VoteReject", "*:VoteRemove", "*:Finalize"],
      vote_policy: {},
    },
  ],
  default_vote_policy: { weight_kind: "RoleWeight", quorum: "0", threshold: [1, 2] },
  proposal_bond: RULES.proposal_bond,
  proposal_period: String(7n * DAYS_NS),
  bounty_bond: RULES.proposal_bond,
  bounty_forgiveness_period: String(DAYS_NS),
};

const S = readJson(SECRETS, { keys: {}, secrets: {}, done: {}, txs: {} });
const save = () => writeJson(SECRETS, S);
const master = accountOf(MASTER);

function keyOf(id) {
  S.keys[id] ??= KeyPair.fromRandom("ed25519").toString();
  save();
  return S.keys[id];
}
const acct = (id) => new Account(id, provider, keyOf(id));

async function exists(id) {
  try {
    await provider.viewAccount({ accountId: id });
    return true;
  } catch {
    return false;
  }
}

/** What these contracts cost to store, in NEAR, rounded up to a hundredth. */
function storageNear(...files) {
  const bytes = files.reduce((sum, file) => sum + wasm(file).length, 0);
  return Math.ceil(bytes / 1000) / 100;
}

/** Test NEAR can arrive at the implicit address after the named account exists. */
async function sweepImplicit() {
  const { account } = JSON.parse(readFileSync(join(ROOT, ".testnet", "funder.json"), "utf8"));
  const balance = await provider
    .viewAccount({ accountId: account })
    .then((a) => BigInt(a.amount))
    .catch(() => 0n);
  if (balance < near(0.1)) return;
  const r = await accountOf(account).signAndSendTransaction({
    receiverId: MASTER,
    actions: [actions.transfer(balance - near(0.01))],
    throwOnFailure: false,
  });
  outcome(r);
  log("moved", balance / 10n ** 21n, "milliNEAR from the implicit address");
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
  // A rerun picks up the same proposal rather than filing it again.
  const lastId = await view(DAO, "get_last_proposal_id");
  const recent = await view(DAO, "get_proposals", { from_index: Math.max(0, lastId - 10), limit: 10 });
  let id = recent.find((p) => p.description === description && p.status === "InProgress")?.id;
  if (id === undefined) {
    ({ value: id } = await call(acct(COUNCIL[0]), DAO, "add_proposal", { proposal: { description, kind } }, { deposit: bond, tgas: 50 }));
  }
  log(`  proposal #${id}: ${description}`);
  // A transaction must hold its gas at a pessimistic price up front. The first vote only
  // records, so it needs little; the second runs the proposal, so it carries the gas.
  let last;
  for (const [member, tgas] of [
    [COUNCIL[1], 30],
    [COUNCIL[0], 150],
  ]) {
    const now = await view(DAO, "get_proposal", { id });
    if (now.status !== "InProgress" || now.votes?.[member]) continue;
    last = await call(acct(member), DAO, "act_proposal", { id, action: "VoteApprove", proposal: kind }, { tgas });
  }
  const p = await view(DAO, "get_proposal", { id });
  if (p.status !== "Approved") throw new Error(`proposal ${id} ended as ${p.status}`);
  if (last) S.txs[description] = last.hash;
  save();
  return { id, hash: last?.hash };
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

async function pinClerk({ signer, encryption_key }, codeHash, label) {
  const args = { signer, encryption_key, code_hash: codeHash, prompt_sha256: sha256hex(PROMPT) };
  await propose(`Pin the sealed clerk: ${label}, key ${signer.slice(0, 12)}…`, functionCallKind(FUND, "set_reviewer", args, 0, teraToGas(50)));
  log("  pinned", signer);
}

/**
 * Runs the uploaded build once, in OutLayer's enclave, to read the public keys it made.
 * The transaction's attestation is the record of which build printed them.
 */
async function enclaveKeys(url, hash) {
  const limits = { max_instructions: 2_000_000_000, max_memory_mb: 128, max_execution_seconds: 30 };
  const input_data = JSON.stringify({ action: "keys" });
  const relay = acct(RELAY);
  const deposit = await view(OUTLAYER, "estimate_execution_cost", { resource_limits: limits, input_len: input_data.length });
  const finished = await sendAndPoll(relay, provider, OUTLAYER, [
    actions.functionCall(
      "request_execution",
      {
        source: { WasmUrl: { url, hash, build_target: "wasm32-wasip2" } },
        resource_limits: limits,
        input_data,
        secrets_ref: { profile: CLERK_PROFILE, account_id: RELAY },
        response_format: "Json",
        payer_account_id: RELAY,
      },
      teraToGas(300),
      BigInt(deposit),
    ),
  ]);
  const o = outcome(finished);
  if (o.value?.error) throw new Error(`the clerk refused: ${o.value.error}`);
  if (o.value?.prompt_sha256 !== sha256hex(PROMPT)) throw new Error("that build carries a different prompt from this repo");
  return { keys: o.value, tx: o.hash };
}

/** One file on FastFS, as borsh: enum variant 0, then path, Some, mime type and content. */
function fastfsPayload(path, mime, content) {
  const sized = (bytes) => {
    const length = Buffer.alloc(4);
    length.writeUInt32LE(bytes.length);
    return Buffer.concat([length, bytes]);
  };
  return Buffer.concat([Buffer.from([0]), sized(Buffer.from(path)), Buffer.from([1]), sized(Buffer.from(mime)), sized(content)]);
}

/** FastFS answers 404 to HEAD even for a file it has, so this fetches the file and checks it. */
async function published(url, hash) {
  const res = await fetch(url);
  return res.ok && sha256hex(Buffer.from(await res.arrayBuffer())) === hash;
}

/**
 * Publishes the build on FastFS. The call has one gas on purpose: it fails, and the
 * indexer reads the file from its arguments. A file appears a minute or two later.
 */
async function uploadClerk(code, hash) {
  const url = `https://test.fastfs.io/${RELAY}/${OUTLAYER}/${hash}.wasm`;
  if (await published(url, hash)) return url;
  await acct(RELAY).signAndSendTransaction({
    receiverId: OUTLAYER,
    actions: [actions.functionCall("__fastdata_fastfs", fastfsPayload(`${hash}.wasm`, "application/wasm", code), 1n, 0n)],
    waitUntil: "INCLUDED",
    throwOnFailure: false,
  });
  for (let i = 0; i < 60; i++) {
    await new Promise((done) => setTimeout(done, 5000));
    if (await published(url, hash)) return url;
  }
  throw new Error(`${url} did not appear`);
}

async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** OutLayer's keystore format: [1 | ephemeral X25519 key | nonce | ChaCha20-Poly1305]. */
function encryptToKeystore(pubkeyHex, plaintext) {
  const ephemeral = randomBytes(32);
  const key = hkdf(sha256, x25519.getSharedSecret(ephemeral, hexToBytes(pubkeyHex)), undefined, utf8ToBytes("outlayer-keystore-v1"), 32);
  const nonce = randomBytes(12);
  const sealed = chacha20poly1305(key, nonce).encrypt(utf8ToBytes(plaintext));
  return Buffer.concat([Buffer.from([1]), x25519.getPublicKey(ephemeral), nonce, sealed]).toString("base64");
}

/**
 * Stores the clerk's secrets against this exact build. The seed is generated inside
 * the keystore's enclave and never leaves it, and only the relay may run the build.
 */
async function storeClerkSecrets(hash, apiKey) {
  const accessor = { type: "WasmHash", hash };
  const base = { accessor, owner: RELAY, profile: CLERK_PROFILE };
  const secrets = JSON.stringify({ NEAR_AI_API_KEY: apiKey });
  // This key depends only on the build and the owner, so the real value stays out of this
  // request. The model key leaves this machine only inside the encrypted blob below.
  const { pubkey } = await postJson(`${OUTLAYER_API}/secrets/pubkey`, { ...base, secrets_json: JSON.stringify({ NEAR_AI_API_KEY: "placeholder" }) });
  const generated = await postJson(`${OUTLAYER_API}/secrets/add_generated_secret`, {
    ...base,
    encrypted_secrets_base64: encryptToKeystore(pubkey, secrets),
    new_secrets: [{ name: "PROTECTED_CLERK_SEED", generation_type: "hex32" }],
  });
  await call(
    acct(RELAY),
    OUTLAYER,
    "store_secrets",
    {
      accessor: { WasmHash: { hash } },
      profile: CLERK_PROFILE,
      encrypted_secrets_base64: generated.encrypted_data_base64,
      access: { Whitelist: { accounts: [RELAY] } },
      vault_id: null,
    },
    { deposit: near("0.1"), tgas: 50 },
  );
}

async function pinEnclave() {
  if (!existsSync(CLERK_WASM)) throw new Error("build the clerk first: cargo build -p tideover-clerk --target wasm32-wasip2 --release");
  const apiKey = aiKey();
  if (!apiKey) throw new Error("the clerk needs NEAR_AI_API_KEY, in the environment or in web/.env.local");
  const code = readFileSync(CLERK_WASM);
  const hash = sha256hex(code);
  log("  clerk build", hash);
  const url = await uploadClerk(code, hash);
  log("  published at", url);
  await storeClerkSecrets(hash, apiKey);
  log("  secrets stored");
  const { keys, tx } = await enclaveKeys(url, hash);
  log("  the enclave's keys:", keys.signer, keys.encryption_key, `(${tx})`);
  await pinClerk(keys, hash, `enclave build ${hash.slice(0, 12)}…`);
  S.clerk = { url, hash, keysTx: tx };
  save();
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
    factoryLive: Boolean(S.done.factory),
    clerk: S.clerk ? { keysTx: S.clerk.keysTx, keysSender: RELAY, wasmUrl: S.clerk.url } : {},
    transactions: S.txs,
  });
  const env = [
    `TIDEOVER_RELAY_ACCOUNT=${RELAY}`,
    `TIDEOVER_RELAY_KEY=${keyOf(RELAY)}`,
    `TIDEOVER_JOINER_ACCOUNT=${JOINER}`,
    `TIDEOVER_JOINER_KEY=${keyOf(JOINER)}`,
    `TIDEOVER_DEMO_KEY=${S.demoKey}`,
    `TIDEOVER_CLERK_WASM_URL=${S.clerk?.url ?? ""}`,
    `TIDEOVER_CLERK_WASM_HASH=${S.clerk?.hash ?? ""}`,
    // The enclave never uses this seed, so an enclave fund's server does not hold it.
    `TIDEOVER_CLERK_SEED=${S.clerk ? "" : S.clerkSeed}`,
    `NEAR_AI_API_KEY=${aiKey()}`,
    "",
  ].join("\n");
  writeJson(join(ROOT, ".testnet", "public.json"), { fund: FUND, dao: DAO, token: TOKEN });
  writeFileSync(join(ROOT, "web", ".env.local"), env);
}

async function main() {
  const wasmBytes = readFileSync(join(ROOT, "web", "public", "zk", "tideover_wasm_bg.wasm"));
  await init({ module_or_path: wasmBytes });
  S.demoKey ??= KeyPair.fromRandom("ed25519").toString();
  S.clerkSeed ??= bytesToHex(randomBytes(32));
  save();
  const demoPub = KeyPair.fromString(S.demoKey).getPublicKey();

  await sweepImplicit();

  if (process.argv[2] === "enclave") {
    await pinEnclave();
    writeOutputs();
    return;
  }

  if (process.argv[2] === "factory") {
    await step("factory", async () => {
      // A rerun after a dropped connection tops up only what is missing and does not redeploy.
      const needed = near(storageNear("tideover_factory.wasm", "tideover_fund.wasm") + 0.1);
      const held = BigInt((await provider.viewAccount({ accountId: FACTORY })).amount);
      if (held < needed) {
        outcome(await master.signAndSendTransaction({ receiverId: FACTORY, actions: [actions.transfer(needed - held)], throwOnFailure: false }));
      }
      if ((await view(FACTORY, "required_deposit").catch(() => null)) === null) {
        S.txs["Deploy the factory"] = (await deployAndInit(FACTORY, "tideover_factory.wasm", "new", { owner: FACTORY })).hash;
      }
      // The call holds its gas while the code is stored, so less gas leaves more for storage.
      const set = outcome(
        await acct(FACTORY).signAndSendTransaction({
          receiverId: FACTORY,
          actions: [actions.functionCall("set_code", wasm("tideover_fund.wasm"), teraToGas(50), 0n)],
          throwOnFailure: false,
        }),
      );
      S.txs["Store the fund code in the factory"] = set.hash;
      log(" ", set.logs.join(" "));
      log("  a new fund needs", (await view(FACTORY, "required_deposit")).toString(), "yoctoNEAR");
    });
    writeOutputs();
    return;
  }

  await step("accounts", async () => {
    await ensureAccount(TOKEN, storageNear("tideover_test_usd.wasm") + 0.1);
    await ensureAccount(FACTORY, storageNear("tideover_fund.wasm") + FUND_WORKING_NEAR + 0.03);
    await ensureAccount(RELAY, 0.4);
    await ensureAccount(JOINER, 0.1);
    await ensureAccount(COUNCIL[0], DAO_DEPOSIT + 0.1, [actions.addFunctionCallAccessKey(demoPub, DAO, ["act_proposal"], near(0.5))]);
    for (const c of COUNCIL.slice(1)) await ensureAccount(c, 0.05, [actions.addFunctionCallAccessKey(demoPub, DAO, ["act_proposal"], near(0.5))]);
  });

  await step("token", async () => {
    await deployAndInit(TOKEN, "tideover_test_usd.wasm", "new", {});
  });

  await step("dao", async () => {
    const args = Buffer.from(
      JSON.stringify({
        config: { name: DAO_NAME, purpose: "Harbor Mutual, a demo community for Tideover on NEAR testnet", metadata: "" },
        policy: POLICY,
      }),
    ).toString("base64");
    const r = await call(acct(COUNCIL[0]), DAO_FACTORY, "create", { name: DAO_NAME, args }, { deposit: near(DAO_DEPOSIT), tgas: 150 });
    S.txs["Create the DAO"] = r.hash;
  });

  // ---- As the factory would do it: same name, same code, and no access keys. ----

  await step("fund", async () => {
    const args = { dao: DAO, token: TOKEN, rules: RULES, guardians: [COUNCIL[0]], registrar: RELAY };
    outcome(
      await acct(FACTORY).signAndSendTransaction({
        receiverId: FUND,
        actions: [
          actions.createAccount(),
          actions.transfer(near(storageNear("tideover_fund.wasm") + FUND_WORKING_NEAR)),
          actions.deployContract(wasm("tideover_fund.wasm")),
          actions.functionCall("new", args, teraToGas(30), 0n),
        ],
        throwOnFailure: false,
      }),
    );
    if (!(await exists(FUND))) throw new Error("the fund account was not created");
  });

  await step("role", async () => {
    await propose("Install Tideover: give the fund a role limited to transfers", {
      ChangePolicyAddOrUpdateRole: {
        role: {
          name: "tideover",
          kind: { Group: [FUND] },
          permissions: ["transfer:AddProposal", "transfer:VoteApprove", "transfer:Finalize"],
          vote_policy: { transfer: { weight_kind: "RoleWeight", quorum: "0", threshold: [1, 1] } },
        },
      },
    });
  });

  // ---- The rest gives the demo community some history. ----

  await step("clerk", async () => {
    await pinClerk(clerkKeys(S.clerkSeed), SERVER_CLERK, "the demo server's clerk, until an enclave build is pinned");
  });

  await step("seed-money", async () => {
    for (const id of [DAO, FUND]) {
      await call(acct(TOKEN), TOKEN, "mint", { account_id: id, amount: String(id === DAO ? 20_000n * USD : 0n) });
    }
  });

  await step("members", async () => {
    const relay = acct(RELAY);
    for (const [name, prior] of MEMBERS) {
      const id = sub(name);
      await ensureAccount(id, 0.01, [actions.addFunctionCallAccessKey(demoPub, FUND, ["panel_vote"], near(0.25))]);
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
        actions: [actions.functionCall("ft_transfer_call", { receiver_id: FUND, amount: RULES.dues, msg: "dues" }, teraToGas(200), 1n)],
      });
      const r = await relay.signAndSendTransaction({ receiverId: id, actions: [actions.signedDelegate(signedDelegate)], throwOnFailure: false });
      const o = outcome(r);
      log("  dues paid", id, `${o.tgas} Tgas`);
    }
  });

  writeOutputs();
  const fund = await view(FUND, "get_fund");
  log("deployed:", FUND, `members ${fund.members}, paid up ${fund.paid_up}, leaves ${fund.leaves}`);
}

main().catch((e) => {
  console.error("FAILED:", e.message, e.hash ?? "");
  process.exit(1);
});
