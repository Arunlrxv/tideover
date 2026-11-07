"use client";

// The member's device. The account key and the member secret live here, and
// neither is ever sent anywhere. Clearing this browser's data loses both, which
// is fine for a demo. A real member would derive them from their wallet.
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, actions, encodeSignedDelegate, teraToGas } from "near-api-js";
import { allLeaves, getClaim, getFund, getMember, groupSize } from "./chain";
import { D, RPCS } from "./config";
import { sealTo, sealedPayload, sha256hex } from "./sealed.mjs";
import type { Claim, Card, FundView, Leaf, MemberView } from "./types";
import { commitmentOf, newSecret, nullifierOf, proveClaim, type ClaimProof } from "./zk";

const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url }, { retries: 1, wait: 300, backoff: 2 })));

export type LocalMember = { account: string; key: string; secret: string };
export type LocalClaim = { id: string; payout: string; payoutKey: string | null; at: number };

const MEMBER_KEY = "tideover.member";
const CLAIMS_KEY = "tideover.claims";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* A private window may refuse storage. The demo still works for this visit. */
  }
}

export const loadMember = () => read<LocalMember>(MEMBER_KEY);
export const saveMember = (m: LocalMember) => write(MEMBER_KEY, m);
export const forgetMember = () => {
  try {
    localStorage.removeItem(MEMBER_KEY);
  } catch {
    /* Nothing to forget. */
  }
};
export const loadClaims = () => read<LocalClaim[]>(CLAIMS_KEY) ?? [];
export const rememberClaim = (c: LocalClaim) => write(CLAIMS_KEY, [c, ...loadClaims()].slice(0, 20));

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error ?? `Request failed (${res.status})`), j);
  return j as T;
}

export const api = post;

/** Joins the demo fund. The key and secret are made here, and only public halves leave. */
export async function joinDemo(): Promise<LocalMember> {
  const keyPair = KeyPair.fromRandom("ed25519");
  const secret = await newSecret();
  const commitment = await commitmentOf(secret);
  const { account } = await post<{ account: string }>("/api/demo/join", { publicKey: keyPair.getPublicKey().toString(), commitment });
  const member = { account, key: keyPair.toString(), secret };
  saveMember(member);
  return member;
}

/** Signs a delegate action. The relay pays the gas, so a member needs no NEAR. */
async function gasless(m: LocalMember, receiverId: string, method: string, args: Record<string, unknown>, tgas: number, deposit = 0n) {
  const acct = new Account(m.account, provider, m.key as `ed25519:${string}`);
  const { signedDelegate } = await acct.createSignedMetaTransaction({
    receiverId,
    actions: [actions.functionCall(method, args, teraToGas(tgas), deposit)],
    blockHeightTtl: 120,
  });
  let bin = "";
  encodeSignedDelegate(signedDelegate).forEach((b) => (bin += String.fromCharCode(b)));
  return post<{ hash: string }>("/api/delegate", { signedDelegate: btoa(bin) });
}

export const payDues = (m: LocalMember, dues: string) =>
  gasless(m, D.token, "ft_transfer_call", { receiver_id: D.fund, amount: dues, msg: "dues" }, 200, 1n);

export const voteOnPanel = (m: LocalMember, claimId: string, approve: boolean) =>
  gasless(m, D.fund, "panel_vote", { claim_id: claimId, approve }, 30);

/** An address with no history, so a payment leads nowhere. */
export function freshPayout() {
  const pair = KeyPair.fromRandom("ed25519");
  const hex = [...pair.getPublicKey().data].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { account: hex, key: pair.toString() };
}

export type Prepared = {
  fund: FundView;
  member: MemberView;
  envelope: string;
  evidenceSha256: string;
  proof: ClaimProof;
  amount: string;
  payout: string;
};

/** Proving the lowest tier that covers the amount hides the member among more people. */
function lowestTierFor(fund: FundView, amount: string, mine: number) {
  const i = fund.rules.tiers.findIndex((t) => BigInt(t.cap) >= BigInt(amount));
  return i === -1 ? mine : Math.min(i, mine);
}

/**
 * Chooses which paid month to prove. Last month's group is finished, so it is usually
 * bigger than whoever has paid so far this month, and the claim hides in a bigger
 * crowd. On a tie, the first entry wins, and that is last month.
 */
async function bestGroup(fund: FundView, member: MemberView, amount: string) {
  const usable = [member.prev_leaf, member.leaf].filter((l): l is Leaf => l !== null && l.period + 1 >= fund.period);
  if (!usable.length) throw new Error("Pay this month's dues first");
  const mine = Math.max(...usable.map((l) => l.tier));
  const minTier = lowestTierFor(fund, amount, mine);
  const sized = await Promise.all(
    usable.filter((l) => l.tier >= minTier).map(async (leaf) => ({ leaf, size: await groupSize(leaf.period, minTier) })),
  );
  const best = sized.reduce((a, b) => (b.size > a.size ? b : a));
  if (best.size < fund.rules.min_group) {
    throw new Error(
      `Only ${best.size} members could have made this claim, and this fund needs ${fund.rules.min_group} before it will hide one. A smaller amount hides you among more people.`,
    );
  }
  return { leaf: best.leaf, minTier };
}

/** Everything that happens on this device before anything is sent. */
export async function prepareClaim(m: LocalMember, amount: string, payout: string, document: string): Promise<Prepared> {
  const [fund, member] = await Promise.all([getFund(), getMember(m.account)]);
  if (!fund.reviewer) throw new Error("This fund has not pinned a clerk yet");
  if (!member) throw new Error("Join the fund first");
  const { leaf, minTier } = await bestGroup(fund, member, amount);
  const nullifier = await nullifierOf(m.secret, D.fund, fund.window);
  const envelope = sealTo(fund.reviewer.encryption_key, sealedPayload({ fund: D.fund, cycle: fund.cycle, nullifier, amount, payout, document }));
  const evidenceSha256 = sha256hex(envelope);
  const leaves = await allLeaves(fund.leaves);
  const proof = await proveClaim({
    secret: m.secret,
    fund: D.fund,
    cycle: fund.cycle,
    window: fund.window,
    tier: leaf.tier,
    period: leaf.period,
    min_tier: minTier,
    amount,
    payout,
    evidence_sha256: evidenceSha256,
    position: leaf.position,
    leaves,
  });
  return { fund, member, envelope, evidenceSha256, proof, amount, payout };
}

export const fileClaim = (p: Prepared) =>
  post<{ id: string; hash: string }>("/api/claim", {
    proof: p.proof.proof,
    root: p.proof.root,
    period: p.proof.period,
    min_tier: p.proof.min_tier,
    nullifier: p.proof.nullifier,
    amount: p.amount,
    payout: p.payout,
    evidence_sha256: p.evidenceSha256,
  });

/**
 * Hands the sealed document to the clerk and posts the card it signs. The relay
 * carries a ciphertext it can't open, and it can't change the card.
 */
export async function runSealedReview(claimId: string, envelope: string): Promise<Card> {
  const { card, signature } = await post<{ card: Card; signature: string }>("/api/review", { claimId, envelope });
  await post("/api/review/post", { claim_id: claimId, card, signature });
  return card;
}

export const advance = (claimId: string) => post<{ hash: string }>("/api/advance", { claimId });

export async function waitFor(claimId: string, done: (c: Claim) => boolean, seconds = 60): Promise<Claim> {
  for (let i = 0; i < seconds / 2; i++) {
    const c = await getClaim(claimId);
    if (c && done(c)) return c;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Timed out waiting for the chain");
}
