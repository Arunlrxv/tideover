// Deploys the Harbor demo community on NEAR testnet, one idempotent step at a time.
//
//   node scripts/deploy.mjs                    run every step that has not run yet
//   node scripts/deploy.mjs enclave    put the built clerk on OutLayer and pin it
//
// A real install is steps "fund" and "role": two ordinary proposals on an existing
// DAO. Everything else here only builds a demo community to install it on.
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

const sub = (label) => `${label}.${MASTER}`;
const TOKEN = sub("usd");
const FACTORY = sub("funds");
const RELAY = sub("relay");
const JOINER = sub("m");
const DAO = `${DAO_NAME}.${DAO_FACTORY}`;
const FUND = `${FUND_LABEL}.${FACTORY}`;
const COUNCIL = ["maya", "tomas", "ines"].map(sub);
// Twelve points reach the top tier, and these three make that group big enough to claim from.
const MEMBERS = [
  ["amara", 13],
  ["ben", 12],
  ["chi", 12],
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
  review_window_secs: 150,
  veto_window_secs: 45,
  panel_window_secs: 1800,
  // Sputnik's default voting period is seven days. This is a day past it.
  council_window_secs: 8 * 24 * 3600,
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

/**
 * Publishes the build on FastFS. The call has one gas on purpose: it fails, and the
 * indexer reads the file from its arguments. A file appears a minute or two later.
 */
async function uploadClerk(code, hash) {
  const url = `https://test.fastfs.io/${RELAY}/${OUTLAYER}/${hash}.wasm`;
  if ((await fetch(url, { method: "HEAD" })).ok) return url;
  await acct(RELAY).signAndSendTransaction({
    receiverId: OUTLAYER,
    actions: [actions.functionCall("__fastdata_fastfs", fastfsPayload(`${hash}.wasm`, "application/wasm", code), 1n, 0n)],
    waitUntil: "INCLUDED",
    throwOnFailure: false,
  });
  for (let i = 0; i < 60; i++) {
    await new Promise((done) => setTimeout(done, 5000));
    if ((await fetch(url, { method: "HEAD" })).ok) return url;
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
  const { pubkey } = await postJson(`${OUTLAYER_API}/secrets/pubkey`, { ...base, secrets_json: secrets });
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
  const apiKey = process.env.NEAR_AI_API_KEY ?? existingAiKey();
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

/** Keeps a key someone already put in web/.env.local. */
function existingAiKey() {
  const path = join(ROOT, "web", ".env.local");
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").match(/^NEAR_AI_API_KEY=(.*)$/m)?.[1]?.trim() ?? "";
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
    `NEAR_AI_API_KEY=${process.env.NEAR_AI_API_KEY ?? existingAiKey()}`,
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

  if (process.argv[2] === "enclave") {
    await pinEnclave();
    writeOutputs();
    return;
  }

  await step("accounts", async () => {
    await ensureAccount(TOKEN, 3);
    await ensureAccount(FACTORY, 7.6);
    await ensureAccount(RELAY, 2.5);
    await ensureAccount(JOINER, 1);
    // The DAO takes 6 NEAR, and a new DAO's first proposal needs a 1 NEAR bond.
    await ensureAccount(COUNCIL[0], 7.8, [actions.addFunctionCallAccessKey(demoPub, DAO, ["act_proposal"], near(1))]);
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

  await step("bonds", async () => {
    // Pays for proposal bonds, token registration and claim records through judging.
    await call(master, FUND, "fund_bonds", {}, { deposit: near(2), tgas: 30 });
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

  writeOutputs();
  const fund = await view(FUND, "get_fund");
  log("deployed:", FUND, `members ${fund.members}, paid up ${fund.paid_up}, leaves ${fund.leaves}`);
}

main().catch((e) => {
  console.error("FAILED:", e.message, e.hash ?? "");
  process.exit(1);
});
