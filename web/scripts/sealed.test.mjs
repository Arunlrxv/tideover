import assert from "node:assert/strict";
import { test } from "node:test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { PROMPT, buildRequest, encryptTo, maskDetails, newClient, openWith, sha256hex, systemMessage } from "../src/lib/sealed.mjs";

test("a sealed document opens only with the recipient's key", () => {
  const client = newClient();
  const other = newClient();
  const { envelope } = encryptTo(client.pubHex, "Hospital invoice for $85");
  assert.equal(openWith(client.x25519Secret, envelope).plaintext, "Hospital invoice for $85");
  assert.throws(() => openWith(other.x25519Secret, envelope));
});

test("two seals of the same text look nothing alike", () => {
  const client = newClient();
  assert.notEqual(encryptTo(client.pubHex, "same").envelope, encryptTo(client.pubHex, "same").envelope);
});

test("an envelope is lowercase hex, which the contract requires", () => {
  const { envelope } = encryptTo(newClient().pubHex, "text");
  assert.match(envelope, /^[0-9a-f]+$/);
});

test("the request has exactly the key order the contract rebuilds", () => {
  assert.equal(
    buildRequest({ model: "m", systemEnvelope: "aa", evidenceEnvelope: "bb", maxTokens: 9 }),
    '{"model":"m","messages":[{"role":"system","content":"aa"},{"role":"user","content":"bb"}],"max_tokens":9,"temperature":0,"stream":false}',
  );
});

test("the system message ends with the case file", () => {
  assert.ok(systemMessage('{"claim":"1"}').startsWith(PROMPT));
  assert.ok(systemMessage('{"claim":"1"}').endsWith('\n\nCASE FILE: {"claim":"1"}'));
});

test("the hash matches the standard sha256 vector", () => {
  assert.equal(sha256hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("a key made for ed25519 also opens X25519 envelopes", () => {
  const seed = new Uint8Array(32).fill(7);
  const pub = bytesToHex(ed25519.getPublicKey(seed));
  const secret = ed25519.utils.toMontgomerySecret(seed);
  assert.equal(openWith(secret, encryptTo(pub, "ok").envelope).plaintext, "ok");
});

test("easy details are masked before a document is sealed", () => {
  const out = maskDetails("Call +44 20 7946 0958 or rosa@example.org about invoice 7");
  assert.ok(!out.includes("rosa@example.org"));
  assert.ok(!out.includes("7946"));
  assert.ok(out.includes("invoice 7"));
});
