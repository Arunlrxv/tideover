// Runs the sealed reader's real prompt on the sample documents, with the real model.
// Needs only NEAR_AI_API_KEY, so it works before anything is deployed. It prints the
// closed cards the clerk would sign, and whether each one is what the sample should get.
// Each run spends one model request per sample, so run it when the prompt changes.
//
//   npm run model-check
import { MODEL_URL, modelRequest, parseVerdict } from "../src/lib/clerk.mjs";
import { MODEL } from "../src/lib/sealed.mjs";
import { SAMPLES } from "../src/lib/samples.ts";
import { aiKey, log, writeJson, ROOT } from "./lib.mjs";
import { join } from "node:path";

const apiKey = aiKey();
const WHERE = "A NEAR AI key comes from the API Keys page at https://cloud.near.ai, and starts with sk-.";
if (!apiKey) {
  console.error(`No key yet. Put NEAR_AI_API_KEY in web/.env.local, then run this again. ${WHERE}`);
  process.exit(1);
}
if (!/^sk-[0-9a-f]{32}$/.test(apiKey)) {
  console.error(`The key in web/.env.local is not a NEAR AI key. ${WHERE}`);
  process.exit(1);
}

const EXPECTED = {
  hospital: { category: "medical", assessment: "supported", amount_matches: "yes", injection: false },
  eviction: { category: "housing", assessment: "supported", amount_matches: "yes", injection: false },
  funeral: { category: "funeral", assessment: "supported", amount_matches: "yes", injection: false },
  injection: { injection: true, assessment: "unsupported" },
};

// A nonce and date as the contract would give them.
const caseFile = (claim, dollars, nonce) =>
  JSON.stringify({ claim, amount: `${dollars}.00`, date: new Date().toISOString().slice(0, 10), nonce });

async function ask(body) {
  const res = await fetch(MODEL_URL, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body });
  if (res.status === 401) {
    console.error(`NEAR AI refused this key, so it may be expired or deleted. ${WHERE}`);
    process.exit(1);
  }
  if (res.status === 402) {
    console.error("NEAR AI accepted the key, but this account has no credits. Add some on the Credits page at https://cloud.near.ai.");
    process.exit(1);
  }
  if (!res.ok) throw new Error(`NEAR AI answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).choices?.[0]?.message?.content;
}

log("model", MODEL);
const results = [];
let failed = 0;
for (const [i, sample] of SAMPLES.entries()) {
  const claim = String(i);
  const nonce = `0000${i}`;
  const started = Date.now();
  try {
    const content = await ask(modelRequest(caseFile(claim, sample.amount, nonce), sample.text()));
    const card = parseVerdict(content ?? "", claim, nonce);
    const wrong = Object.entries(EXPECTED[sample.id]).filter(([k, v]) => card[k] !== v);
    if (wrong.length) failed += 1;
    log(wrong.length ? "DIFFERENT" : "ok", sample.id, `${Date.now() - started} ms`, JSON.stringify(card), wrong.length ? `wanted ${JSON.stringify(Object.fromEntries(wrong))}` : "");
    results.push({ sample: sample.id, card, ok: wrong.length === 0, millis: Date.now() - started });
  } catch (e) {
    failed += 1;
    log("FAILED", sample.id, e.message);
    results.push({ sample: sample.id, error: e.message, ok: false });
  }
}
writeJson(join(ROOT, "docs", "model-check.json"), { at: new Date().toISOString(), model: MODEL, results });
log(`${results.length - failed} of ${results.length} samples came back as expected`);
process.exitCode = failed ? 1 : 0;
