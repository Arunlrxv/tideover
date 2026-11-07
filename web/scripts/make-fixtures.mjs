// Writes golden fixtures from the code the browser actually runs, so the Rust tests
// can prove the two sides agree byte for byte:
//
//   - a claim proof made by the browser's wasm prover, for `file_claim`
//   - an envelope sealed by sealed.mjs, for the clerk to open
//
// Run after changing the circuit or the sealed format:  node scripts/make-fixtures.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clerkKeys } from "../src/lib/clerk.mjs";
import init, { commitment, leaf, prove_claim, secret_from_bytes } from "../public/zk/tideover_wasm.js";
import { PROMPT, sealTo, sealedPayload, sha256hex } from "../src/lib/sealed.mjs";
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
const proof = JSON.parse(
  prove_claim(
    readFileSync(join(ROOT, "keys", "membership.pk")),
    JSON.stringify({
      secret,
      fund: FUND,
      cycle: 0,
      window: 0,
      tier: 2,
      period: 0,
      min_tier: 2,
      amount,
      payout,
      evidence_sha256: evidenceSha256,
      position: 0,
      leaves: [leaf(memberCommitment, 0n, 2)],
    }),
    new Uint8Array(32).fill(5),
  ),
);
writeFileSync(
  join(ROOT, "contracts", "fund", "src", "golden.json"),
  JSON.stringify({ claim: { commitment: memberCommitment, ...proof, amount, payout, evidence_sha256: evidenceSha256 } }, null, 2) + "\n",
);

// ---- An envelope, sealed the way a browser does, to the clerk tests' test seed. ----
const clerk = clerkKeys("07".repeat(32));
const sealedAmount = String(85n * USD);
const sealedPayout = "c0ffee.testnet";
const envelope = sealTo(
  clerk.encryption_key,
  sealedPayload({
    fund: FUND,
    amount: sealedAmount,
    payout: sealedPayout,
    document: "St Brigid's Community Hospital. Patient: Rosa Almeida. Amount due $85.00.",
  }),
);
writeFileSync(
  join(ROOT, "clerk", "src", "golden.json"),
  JSON.stringify(
    {
      clerk: { signer: clerk.signer, encryption_key: clerk.encryption_key, prompt_sha256: sha256hex(PROMPT) },
      fund: FUND,
      amount: sealedAmount,
      payout: sealedPayout,
      evidence_sha256: sha256hex(envelope),
      envelope,
    },
    null,
    2,
  ) + "\n",
);

console.log("wrote the proof and envelope fixtures");
