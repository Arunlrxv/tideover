// Sends a transaction and polls for its result. An enclave run outlasts an RPC's
// patience, so waiting inside the send call would fail, and a send that returns early
// gives no outcome to read a hash from. The hash is computed here instead.
import { sha256 } from "@noble/hashes/sha2.js";
import { baseEncode } from "near-api-js";

export async function sendAndPoll(account, provider, receiverId, actions, seconds = 110) {
  const signed = await account.createSignedTransaction({ receiverId, actions });
  const txHash = baseEncode(sha256(signed.transaction.encode()));
  await provider.sendTransactionAsync(signed);
  for (let waited = 0; waited < seconds; waited += 2) {
    await new Promise((done) => setTimeout(done, 2000));
    const result = await provider.viewTransactionStatus({ txHash, accountId: account.accountId, waitUntil: "FINAL" }).catch(() => null);
    if (result?.status) return result;
  }
  throw new Error(`Transaction ${txHash} did not finish in time`);
}
