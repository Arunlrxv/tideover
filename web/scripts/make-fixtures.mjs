// Writes golden fixtures from the code the browser actually runs, so the Rust tests
// can prove that the two sides agree byte for byte:
//
//   - a claim proof made by the browser's wasm prover, for `file_claim`
//   - a sealed review made by sealed.mjs, for `post_review`
//
// Run after changing the circuit or the sealed format:  node scripts/make-fixtures.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import init, { commitment, leaf, prove_claim, secret_from_bytes } from "../public/zk/tideover_wasm.js";
import { buildRequest, encryptTo, newClient, openWith, sha256hex, systemMessage } from "../src/lib/sealed.mjs";
import { ROOT } from "./lib.mjs";

await init({ module_or_path: readFileSync(join(ROOT, "web", "public", "zk", "tideover_wasm_bg.wasm")) });

const FUND = "harbor.tideover.testnet";
const USD = 1_000_000n;

// ---- A claim proof, for the member the Rust test sets up: 7 prior months, then dues. ----
const secret = secret_from_bytes(new TextEncoder().encode("tideover golden member"));
const memberCommitment = commitment(secret);
const amount = String(90n * USD);
const payout = "a1b2c3.testnet";
const evidenceSha256 = sha256hex("golden evidence");
const leaves = [leaf(memberCommitment, 0n, 2)];
const proof = JSON.parse(
  prove_claim(
    readFileSync(join(ROOT, "keys", "membership.pk")),
    JSON.stringify({
      secret,
      fund: FUND,
      window: 0,
      tier: 2,
      period: 0,
      min_tier: 2,
      amount,
      payout,
      evidence_sha256: evidenceSha256,
      position: 0,
      leaves,
    }),
    new Uint8Array(32).fill(5),
  ),
);

// ---- A sealed review. This script plays the enclave, with the Rust tests' model key. ----
const modelSeed = new Uint8Array(32).fill(42);
const modelPub = bytesToHex(ed25519.getPublicKey(modelSeed));
const model = "z-ai/test-model";
const maxTokens = 800;
const nonce = "feedfacefeedface";
const caseFile = `{"claim":"0","amount":"90.00","date":"2030-01-15","nonce":"${nonce}"}`;

const evidence = encryptTo(modelPub, "St Brigid's Hospital. Amount due $90. Patient: Rosa Almeida.");
const system = encryptTo(modelPub, systemMessage(caseFile));
const request = buildRequest({ model, systemEnvelope: system.envelope, evidenceEnvelope: evidence.envelope, maxTokens });

const client = newClient();
const verdict = `{"claim":"0","nonce":"${nonce}","category":"medical","document":"bill","recent":true,"amount_matches":"yes","injection":false,"assessment":"supported"}`;
const content = encryptTo(client.pubHex, verdict).envelope;
const reasoning = encryptTo(client.pubHex, "The bill names Rosa Almeida at St Brigid's.").envelope;
const responseBody = JSON.stringify({ id: "chatcmpl-golden", choices: [{ message: { role: "assistant", content, reasoning_content: reasoning } }] });
const signedText = `${model}:${sha256hex(request)}:${sha256hex(responseBody)}`;
const signature = bytesToHex(ed25519.sign(new TextEncoder().encode(signedText), modelSeed));
const opened = openWith(client.x25519Secret, content);

writeFileSync(
  join(ROOT, "contracts", "fund", "src", "golden.json"),
  JSON.stringify(
    {
      claim: { commitment: memberCommitment, ...proof, amount, payout, evidence_sha256: evidenceSha256 },
      review: {
        model,
        max_tokens: maxTokens,
        signer: modelPub,
        case_file: caseFile,
        nonce,
        prompt_sha256: sha256hex(systemMessage(caseFile).slice(0, -(`\n\nCASE FILE: ${caseFile}`.length))),
        evidence_sha256: sha256hex(evidence.envelope),
        signed_text: signedText,
        signature,
        system_envelope: system.envelope,
        system_eph_secret: system.ephSecretHex,
        evidence_envelope: evidence.envelope,
        response_body: responseBody,
        verdict_key: opened.keyHex,
      },
    },
    null,
    2,
  ) + "\n",
);
console.log("wrote contracts/fund/src/golden.json");
