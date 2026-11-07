// Read access to NEAR. The browser talks to public RPC directly, so what a page
// shows comes from the chain and not from this app's server.
import { D, RPCS } from "./config";
import type { Claim, FundView, MemberView } from "./types";

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b);
  return btoa(out);
};

export async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  let lastError: unknown;
  for (const rpc of RPCS) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "tideover",
          method: "query",
          params: {
            request_type: "call_function",
            finality: "final",
            account_id: contractId,
            method_name: method,
            args_base64: b64(JSON.stringify(args)),
          },
        }),
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error.data ?? j.error.message);
      if (j.result?.error) throw new Error(j.result.error);
      return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result))) as T;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export const getFund = () => view<FundView>(D.fund, "get_fund");
export const getClaim = (id: string) => view<Claim | null>(D.fund, "get_claim", { claim_id: id });
export const listClaims = (limit = 20, from = 0) => view<Claim[]>(D.fund, "list_claims", { from_index: from, limit });
export const getMember = (account: string) => view<MemberView | null>(D.fund, "get_member", { account });
export const panelCases = (account: string) => view<Claim[]>(D.fund, "panel_cases", { account });
export const groupSize = (period: number, minTier: number) => view<number>(D.fund, "get_group_size", { period, min_tier: minTier });
export const tokenBalance = (account: string) => view<string>(D.token, "ft_balance_of", { account_id: account });

export async function allLeaves(total: number): Promise<string[]> {
  const out: string[] = [];
  while (out.length < total) {
    const page = await view<string[]>(D.fund, "get_leaves", { from_index: out.length, limit: 1000 });
    if (!page.length) break;
    out.push(...page);
  }
  return out;
}

export type Policy = {
  roles: { name: string; kind: unknown; permissions: string[]; vote_policy: Record<string, unknown> }[];
  proposal_bond: string;
  proposal_period: string;
};
export const getPolicy = (dao: string) => view<Policy>(dao, "get_policy");
export type Proposal = {
  id: number;
  proposer: string;
  description: string;
  status: string;
  kind: unknown;
  vote_counts: Record<string, number[]>;
  votes: Record<string, string>;
};
export const getProposal = (dao: string, id: number) => view<Proposal>(dao, "get_proposal", { id });
