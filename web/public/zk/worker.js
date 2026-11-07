// Runs the prover off the main thread, so the page stays responsive while it works.
// The member's secret reaches this worker and goes no further.
import init, { prove_claim, audit_claim, commitment, new_secret, nullifier } from "./tideover_wasm.js";

let ready = null;
let provingKey = null;
let verifyingKey = null;

const start = () => (ready ??= init({ module_or_path: new URL("./tideover_wasm_bg.wasm", import.meta.url) }));

async function fetchBytes(name) {
  const res = await fetch(new URL(`./${name}`, import.meta.url));
  if (!res.ok) throw new Error(`Could not load ${name}`);
  return new Uint8Array(await res.arrayBuffer());
}

const seed = () => crypto.getRandomValues(new Uint8Array(32));

const handlers = {
  async newSecret() {
    return new_secret(seed());
  },
  async commitment({ secret }) {
    return commitment(secret);
  },
  async nullifier({ secret, fund, window }) {
    return nullifier(secret, fund, BigInt(window));
  },
  async prove({ request }) {
    provingKey ??= await fetchBytes("membership.pk");
    const started = performance.now();
    const result = JSON.parse(prove_claim(provingKey, JSON.stringify(request), seed()));
    return { ...result, millis: Math.round(performance.now() - started) };
  },
  async audit({ request }) {
    verifyingKey ??= await fetchBytes("membership.vk.ark");
    return audit_claim(verifyingKey, JSON.stringify(request));
  },
};

self.onmessage = async ({ data: { id, op, payload } }) => {
  try {
    await start();
    self.postMessage({ id, ok: true, result: await handlers[op](payload) });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e?.message ?? e) });
  }
};
