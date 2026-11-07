// Mirrors contracts/fund/src/types.rs.

export type Tier = { min_score: number; cap: string; year_cap: string };

export type Rules = {
  dues: string;
  period_secs: number;
  periods_per_cycle: number;
  window_cycles: number;
  min_group: number;
  tiers: Tier[];
  auto_limit: string;
  panel_limit: string;
  cycle_budget: string;
  panel_size: number;
  panel_quorum: number;
  council_panel: boolean;
  review_window_secs: number;
  veto_window_secs: number;
  panel_window_secs: number;
  council_window_secs: number;
  proposal_bond: string;
  token_decimals: number;
};

export type Card = {
  category: string;
  document: string;
  recent: boolean;
  amount_matches: string;
  injection: boolean;
  assessment: string;
};

export type Route = "Auto" | "Panel" | "Council";

export type ClaimStatus =
  | "AwaitingReview"
  | "VetoWindow"
  | "PanelVoting"
  | "NeedsCouncil"
  | "Filing"
  | "CouncilVote"
  | "Approved"
  | "Paying"
  | "Settling"
  | "Paid"
  | "Rejected";

export type Claim = {
  id: string;
  cycle: number;
  window: number;
  prior_claims: number;
  prior_amount: string;
  filed_at: string;
  min_tier: number;
  amount: string;
  payout: string;
  status: ClaimStatus;
  route: Route | null;
  card: Card | null;
  deadline: string;
  nonce: string;
  evidence_sha256: string;
  panel: string[];
  votes: { member: string; approve: boolean }[];
  proposal_id: number | null;
  paid_at: string | null;
  note: string | null;
  root: string;
  nullifier: string;
  period: number;
  proof: string;
  card_signature: string | null;
};

export type Leaf = { position: number; period: number; tier: number };

export type PointSource = { Carried: { months: number } } | { Dues: { period: number } } | { Panel: { claim: string } } | { Lapsed: { lost: number } };
export type RecordEntry = { at: string; source: PointSource };

export type MemberView = {
  account: string;
  commitment: string | null;
  joined_at: string;
  paid_periods: number;
  service_points: number;
  last_paid_period: number | null;
  leaf: Leaf | null;
  prev_leaf: Leaf | null;
  active: boolean;
  score: number;
  tier: number;
  cap: string;
  paid_this_period: boolean;
};

export type FundView = {
  dao: string;
  token: string;
  rules: Rules;
  guardians: string[];
  registrar: string | null;
  paused: boolean;
  started_at: string;
  period: number;
  cycle: number;
  window: number;
  members: number;
  paid_up: number;
  leaves: number;
  root: string;
  claims: number;
  cycle_committed: string;
  dues_collected: string;
  paid_out: string;
  unforwarded: string;
  spare_near: string;
  reviewer: { signer: string; encryption_key: string; code_hash: string; prompt_sha256: string } | null;
};

export type Deployment = {
  network: string;
  fund: string;
  dao: string;
  token: string;
  factory: string;
  tokenSymbol: string;
  tokenDecimals: number;
  council: string[];
  guardians: string[];
  seededMembers: string[];
  factoryLive?: boolean;
  clerk?: { keysTx?: string; keysSender?: string; wasmUrl?: string };
  transactions: Record<string, string>;
};
