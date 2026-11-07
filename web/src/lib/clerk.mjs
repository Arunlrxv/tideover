// The clerk's steps in JavaScript. clerk/src/lib.rs is the real one, which runs in an
// enclave. This copy runs on a plain server, so whoever runs that server could read
// what it opens. It exists so the fund works before an enclave build is pinned, and
// the Trust page says which of the two a fund is using. Both make the same keys and
// sign the same text, so a DAO vote moves a fund from one to the other.
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { CASE_SEPARATOR, MAX_TOKENS, MODEL, PROMPT, cardMessage, openEnvelope, sha256hex } from "./sealed.mjs";

export const MODEL_URL = "https://cloud-api.near.ai/v1/chat/completions";

const CATEGORIES = ["medical", "housing", "funeral", "income", "food", "legal", "safety", "other"];
const DOCUMENTS = ["bill", "letter", "notice", "receipt", "statement", "other", "none"];
const AMOUNT_MATCHES = ["yes", "partly", "no", "unknown"];
const ASSESSMENTS = ["supported", "unclear", "unsupported"];

const derive = (seed, info) => hkdf(sha256, seed, undefined, utf8ToBytes(info), 32);

export function clerkKeys(seedHex) {
  const seed = hexToBytes(seedHex);
  const x25519Secret = derive(seed, "tideover/clerk/x25519/v1");
  const signingSecret = derive(seed, "tideover/clerk/ed25519/v1");
  return {
    x25519Secret,
    signingSecret,
    encryption_key: bytesToHex(x25519.getPublicKey(x25519Secret)),
    signer: bytesToHex(ed25519.getPublicKey(signingSecret)),
  };
}

export const modelRequest = (caseFile, document) =>
  JSON.stringify({
    model: MODEL,
    messages: [
      { role: "system", content: `${PROMPT}${CASE_SEPARATOR}${caseFile}` },
      { role: "user", content: document },
    ],
    max_tokens: MAX_TOKENS,
    temperature: 0,
    stream: false,
  });

function oneOf(v, field, allowed) {
  if (!allowed.includes(v[field])) throw new Error(`the model's ${field} is outside its closed set`);
  return v[field];
}

function flag(v, field) {
  if (typeof v[field] !== "boolean") throw new Error(`the model's ${field} is not true or false`);
  return v[field];
}

/** Keeps only the closed fields, and only for this claim. */
export function parseVerdict(content, claim, nonce) {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end < start) throw new Error("no JSON in the model's answer");
  let v;
  try {
    v = JSON.parse(content.slice(start, end + 1));
  } catch {
    throw new Error("the model's answer is not JSON");
  }
  if (v.claim !== claim || v.nonce !== nonce) throw new Error("the model answered for another claim");
  return {
    category: oneOf(v, "category", CATEGORIES),
    document: oneOf(v, "document", DOCUMENTS),
    recent: flag(v, "recent"),
    amount_matches: oneOf(v, "amount_matches", AMOUNT_MATCHES),
    injection: flag(v, "injection"),
    assessment: oneOf(v, "assessment", ASSESSMENTS),
  };
}

export const signCard = (keys, message) => bytesToHex(ed25519.sign(utf8ToBytes(message), keys.signingSecret));

/**
 * One review, in the same order as the enclave's. `view` reads the fund contract and
 * `askModel` takes a request body and resolves to the response body.
 */
export async function review({ fund, claim, envelope }, { keys, view, askModel }) {
  const record = await view("get_claim", { claim_id: claim });
  if (!record) throw new Error("the fund has no such claim");
  if (record.status !== "AwaitingReview") throw new Error("this claim is not waiting for a review");
  if (sha256hex(envelope) !== record.evidence_sha256) throw new Error("the envelope does not match the claim's evidence");
  const sealed = JSON.parse(openEnvelope(keys.x25519Secret, envelope));
  const fits = sealed.fund === fund && sealed.cycle === record.cycle && sealed.nullifier === record.nullifier && sealed.amount === record.amount && sealed.payout === record.payout;
  if (!fits) throw new Error("this document was sealed for a different claim");
  const caseFile = await view("get_case_file", { claim_id: claim });
  const response = JSON.parse(await askModel(modelRequest(caseFile, sealed.document)));
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("the model returned no answer");
  const card = parseVerdict(content, claim, record.nonce);
  const message = cardMessage({
    fund,
    claim,
    nonce: record.nonce,
    evidenceSha256: record.evidence_sha256,
    amount: record.amount,
    payout: record.payout,
    card,
  });
  return { card, signature: signCard(keys, message) };
}
