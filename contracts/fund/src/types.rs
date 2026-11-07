use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};

/// A cover level. `min_score` is paid periods plus panel service.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Tier {
    pub min_score: u32,
    /// The most one claim can ask for at this level.
    pub cap: U128,
    /// The most one member can receive in a window. This is what stops a repeat cheat.
    pub year_cap: U128,
}

/// A fund's rules, set by the DAO. Amounts are in the token's smallest unit.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Rules {
    pub dues: U128,
    pub period_secs: u64,
    /// One claim per member per cycle.
    pub periods_per_cycle: u32,
    /// Cycles a member's anonymous tag lasts. `Tier::year_cap` applies across this
    /// window, and claims in it can be linked to each other but not to the member.
    pub window_cycles: u32,
    /// The smallest group a claim may hide in. A proof for a period and tier is
    /// refused until this many members paid that period at that tier or above.
    pub min_group: u32,
    pub tiers: Vec<Tier>,
    /// At or below this, a well-supported claim pays after the veto window.
    pub auto_limit: U128,
    /// At or below this, a panel of members decides. Above it, the council does.
    pub panel_limit: U128,
    /// The most that can be committed to claims in one cycle.
    pub cycle_budget: U128,
    pub panel_size: u8,
    pub panel_quorum: u8,
    pub review_window_secs: u64,
    pub veto_window_secs: u64,
    pub panel_window_secs: u64,
    /// How long a council proposal may sit before the fund finalises it. Set this
    /// to at least the DAO's `proposal_period`.
    pub council_window_secs: u64,
    /// Must match the DAO's own `proposal_bond`.
    pub proposal_bond: U128,
    pub token_decimals: u8,
}

/// What the sealed reader reports. Every field is a closed set of values, so it
/// cannot carry a name or a sentence out of the sealed document.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Card {
    pub category: String,
    pub document: String,
    pub recent: bool,
    pub amount_matches: String,
    pub injection: bool,
    pub assessment: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Route {
    /// Paid after the veto window, with no vote.
    Auto,
    /// Decided by randomly drawn members who never see a name.
    Panel,
    /// Decided by the DAO council through a normal proposal.
    Council,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ClaimStatus {
    AwaitingReview,
    VetoWindow,
    PanelVoting,
    NeedsCouncil,
    /// A proposal for the council is being filed.
    Filing,
    CouncilVote,
    Approved,
    /// A proposal is being filed and approved.
    Paying,
    /// The DAO approved it. The transfer runs separately and can still fail, so
    /// the claim waits here until the DAO's record is final.
    Settling,
    Paid,
    Rejected,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct PanelVote {
    pub member: AccountId,
    pub approve: bool,
}

/// A claim as it sits on chain. There is no name and no reason here: only what
/// is needed to check that every rule was followed.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Claim {
    pub id: U64,
    pub cycle: u64,
    pub window: u64,
    /// What this anonymous member had already claimed in this window.
    pub prior_claims: u32,
    pub prior_amount: U128,
    pub filed_at: U64,
    pub min_tier: u8,
    pub amount: U128,
    pub payout: AccountId,
    pub status: ClaimStatus,
    pub route: Option<Route>,
    pub card: Option<Card>,
    /// When the current stage ends, in nanoseconds.
    pub deadline: U64,
    pub nonce: String,
    pub evidence_sha256: String,
    pub panel: Vec<AccountId>,
    pub votes: Vec<PanelVote>,
    pub proposal_id: Option<u64>,
    pub paid_at: Option<U64>,
    pub note: Option<String>,
    // Everything below lets anyone re-check this claim away from the contract.
    pub root: String,
    pub nullifier: String,
    pub period: u64,
    pub proof: String,
    pub card_signature: Option<String>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Leaf {
    pub position: u64,
    pub period: u64,
    pub tier: u8,
}

/// Where a change to a member's score came from.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum PointSource {
    /// Months the community carried over when it admitted them.
    Carried { months: u32 },
    /// Dues paid for a period, worth one point.
    Dues { period: u64 },
    /// Service on a claim's panel, worth one point.
    Panel { claim: U64 },
    /// A long gap in dues halved their paid months.
    Lapsed { lost: u32 },
}

/// One line of a member's public record. A score is exactly the sum of these, so
/// every point traces back to what earned it.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct RecordEntry {
    pub at: U64,
    pub source: PointSource,
}

/// One anonymous member's record for one window. The key is their tag, so the
/// contract can count their claims without learning who they are.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default)]
pub struct TagRecord {
    pub claims: u32,
    pub used: u128,
    pub last_cycle: Option<u64>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Member {
    pub commitment: Option<[u8; 32]>,
    pub joined_at: u64,
    pub paid_periods: u32,
    pub service_points: u32,
    pub last_paid_period: Option<u64>,
    pub leaf: Option<Leaf>,
    /// Last period's leaf. Proving this one hides a member among everyone who paid
    /// that period, a finished group, rather than whoever has paid so far this period.
    pub prev_leaf: Option<Leaf>,
    pub active: bool,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct MemberView {
    pub account: AccountId,
    pub commitment: Option<String>,
    pub joined_at: U64,
    pub paid_periods: u32,
    pub service_points: u32,
    pub last_paid_period: Option<u64>,
    pub leaf: Option<Leaf>,
    pub prev_leaf: Option<Leaf>,
    pub active: bool,
    pub score: u32,
    pub tier: u8,
    pub cap: U128,
    pub paid_this_period: bool,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Reviewer {
    /// The clerk's ed25519 key, which signs cards.
    pub signer: [u8; 32],
    /// The clerk's X25519 key, which documents are encrypted to.
    pub encryption_key: [u8; 32],
    /// The build the DAO checked. Recorded for anyone auditing the attestation.
    pub code_hash: String,
    pub prompt_sha256: [u8; 32],
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct ReviewerView {
    pub signer: String,
    pub encryption_key: String,
    pub code_hash: String,
    pub prompt_sha256: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct FundView {
    pub dao: AccountId,
    pub token: AccountId,
    pub rules: Rules,
    pub guardians: Vec<AccountId>,
    pub registrar: Option<AccountId>,
    pub paused: bool,
    pub started_at: U64,
    pub period: u64,
    pub cycle: u64,
    pub window: u64,
    pub members: u32,
    pub paid_up: u32,
    pub leaves: u64,
    pub root: String,
    pub claims: u32,
    pub cycle_committed: U128,
    pub dues_collected: U128,
    pub paid_out: U128,
    pub unforwarded: U128,
    pub spare_near: U128,
    pub reviewer: Option<ReviewerView>,
}
