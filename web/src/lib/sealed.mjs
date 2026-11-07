// Sealing a document for the clerk, shared by the browser and the scripts.
//
// A document is encrypted to the clerk's X25519 key, never to the AI model. A shared
// model decrypts anything sent to it, for anyone with an API key, so a ciphertext
// addressed to it would be open to the world the moment it was public.
//
// An envelope is hex(ephemeral_pub[32] || nonce[24] || ciphertext+tag), using X25519,
// HKDF-SHA256 with no salt, and XChaCha20-Poly1305. clerk/src/lib.rs opens it.
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import procedure from "./prompt.json" with { type: "json" };

export const MODEL = procedure.model;
export const MAX_TOKENS = procedure.max_tokens;
export const PROMPT = procedure.prompt;
export const CASE_SEPARATOR = "\n\nCASE FILE: ";
export const MAX_DOCUMENT_BYTES = 8_000;
// A full document of three-byte characters, doubled by hex, plus the sealed fields.
export const MAX_ENVELOPE_CHARS = 50_000;

const SEAL_INFO = utf8ToBytes("tideover/clerk/seal/v1");
const sealKey = (shared) => hkdf(sha256, shared, undefined, SEAL_INFO, 32);

export const sha256hex = (x) => bytesToHex(sha256(typeof x === "string" ? utf8ToBytes(x) : x));

/** Encrypts to the clerk's X25519 public key. The ephemeral secret is dropped here. */
export function sealTo(clerkKeyHex, plaintext, ephSecret = randomBytes(32), nonce = randomBytes(24)) {
  const key = sealKey(x25519.getSharedSecret(ephSecret, hexToBytes(clerkKeyHex)));
  const ct = xchacha20poly1305(key, nonce).encrypt(utf8ToBytes(plaintext));
  const out = new Uint8Array(32 + 24 + ct.length);
  out.set(x25519.getPublicKey(ephSecret), 0);
  out.set(nonce, 32);
  out.set(ct, 56);
  return bytesToHex(out);
}

/** Opens an envelope. Only a clerk, or a test, holds the secret for this. */
export function openEnvelope(x25519Secret, envelopeHex) {
  const env = hexToBytes(envelopeHex);
  const key = sealKey(x25519.getSharedSecret(x25519Secret, env.subarray(0, 32)));
  const plain = xchacha20poly1305(key, env.subarray(32, 56)).decrypt(env.subarray(56));
  return new TextDecoder("utf-8", { fatal: true }).decode(plain);
}

/**
 * What a member seals. The amount and payout are inside the envelope, so nobody can
 * copy a good document's ciphertext onto a claim of their own.
 */
export const sealedPayload = ({ fund, amount, payout, document }) => JSON.stringify({ fund, amount, payout, document });

/** The exact text the clerk signs and the contract rebuilds. */
export function cardMessage({ fund, claim, nonce, evidenceSha256, amount, payout, card }) {
  return [
    "tideover/card/v1",
    fund,
    claim,
    nonce,
    evidenceSha256,
    amount,
    payout,
    card.category,
    card.document,
    card.recent,
    card.amount_matches,
    card.injection,
    card.assessment,
  ].join("\n");
}

/** Masks what is easy to recognise before a document is sealed. The member can edit the rest. */
export function maskDetails(text) {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d[\d ().-]{8,}\d/g, "[number]");
}
