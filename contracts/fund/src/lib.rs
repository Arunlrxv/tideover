//! Tideover: a private hardship fund on top of a Sputnik DAO.
//!
//! The money stays in the DAO. This contract is the only member of a `tideover`
//! role that may add and approve `transfer` proposals, so it can pay a claim, but
//! it can do nothing else, and one DAO proposal removes it.
//!
//! A claim carries no name and no reason. It carries a zero-knowledge proof that
//! a paid-up member at a given level made it, a commitment to a sealed document,
//! and later a sealed reader's card made of closed fields. The route then depends
//! on the amount: small claims pay after a veto window, mid-size claims go to a
//! panel of random members, and large claims become normal council proposals.
//!
//! The AI never moves money. It can only choose the path a claim takes, and every
//! path is bounded by limits this contract enforces.

mod groth16;
mod review;
mod types;

#[cfg(test)]
mod tests;

pub use types::*;

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{json, Value};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseError, PromiseOrValue,
};
use tideover_zk::{
    encoding::{fr_from_bytes, fr_to_bytes},
    identity,
    tree::Frontier,
    Fr, MAX_TIER,
};

const MEMBERSHIP_VK: &[u8] = include_bytes!("../../../keys/membership.vk.near");

const NS_PER_SEC: u64 = 1_000_000_000;
const RECENT_ROOTS: usize = 32;
const MAX_TIERS: usize = MAX_TIER as usize + 1;
const MAX_GUARDIANS: usize = 16;
const MAX_ROSTER_SCAN: u32 = 512;
/// NEP-145 registration for a standard fungible token account.
const FT_STORAGE_DEPOSIT: u128 = 1_250_000_000_000_000_000_000;

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(20);
const GAS_STORAGE_DEPOSIT: Gas = Gas::from_tgas(10);
const GAS_ADD_PROPOSAL: Gas = Gas::from_tgas(20);
const GAS_ACT_PROPOSAL: Gas = Gas::from_tgas(80);
const GAS_VIEW_PROPOSAL: Gas = Gas::from_tgas(10);
const GAS_CALLBACK: Gas = Gas::from_tgas(15);

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[derive(BorshStorageKey)]
#[near(serializers = [borsh])]
enum StorageKey {
    Members,
    Roster,
    Leaves,
    Tags,
    Claims,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    dao: AccountId,
    token: AccountId,
    rules: Rules,
    guardians: Vec<AccountId>,
    registrar: Option<AccountId>,
    paused: bool,
    started_at: u64,

    members: LookupMap<AccountId, Member>,
    roster: Vector<AccountId>,

    tree: Frontier,
    leaves: Vector<[u8; 32]>,
    recent_roots: Vec<[u8; 32]>,
    tags: LookupMap<[u8; 32], TagRecord>,

    claims: Vector<Claim>,
    reviewer: Option<Reviewer>,

    cycle_index: u64,
    cycle_committed: u128,
    dues_collected: u128,
    paid_out: u128,
    /// Dues whose forward to the DAO failed. `sweep` retries them.
    unforwarded: u128,
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        dao: AccountId,
        token: AccountId,
        rules: Rules,
        guardians: Vec<AccountId>,
        registrar: Option<AccountId>,
    ) -> Self {
        validate_rules(&rules);
        require!(guardians.len() <= MAX_GUARDIANS, "Too many guardians");
        let tree = Frontier::new();
        let recent_roots = vec![tree.root];
        Self {
            dao,
            token,
            rules,
            guardians,
            registrar,
            paused: false,
            started_at: env::block_timestamp(),
            members: LookupMap::new(StorageKey::Members),
            roster: Vector::new(StorageKey::Roster),
            tree,
            leaves: Vector::new(StorageKey::Leaves),
            recent_roots,
            tags: LookupMap::new(StorageKey::Tags),
            claims: Vector::new(StorageKey::Claims),
            reviewer: None,
            cycle_index: 0,
            cycle_committed: 0,
            dues_collected: 0,
            paid_out: 0,
            unforwarded: 0,
        }
    }

    // ---------- Calls the DAO makes through FunctionCall proposals ----------

    pub fn set_rules(&mut self, rules: Rules) {
        self.only_dao();
        validate_rules(&rules);
        require!(
            rules.period_secs == self.rules.period_secs
                && rules.periods_per_cycle == self.rules.periods_per_cycle
                && rules.window_cycles == self.rules.window_cycles,
            "Period, cycle and window lengths are fixed once a fund starts"
        );
        self.rules = rules;
    }

    pub fn set_guardians(&mut self, guardians: Vec<AccountId>) {
        self.only_dao();
        require!(guardians.len() <= MAX_GUARDIANS, "Too many guardians");
        self.guardians = guardians;
    }

    pub fn set_registrar(&mut self, registrar: Option<AccountId>) {
        self.only_dao();
        self.registrar = registrar;
    }

    /// Pins the enclave key and the prompt. Check the attestation before voting for this.
    pub fn set_reviewer(
        &mut self,
        model_id: String,
        signer: String,
        prompt_sha256: String,
        max_tokens: u32,
    ) {
        self.only_dao();
        self.reviewer = Some(review::new_reviewer(
            model_id,
            &signer,
            &prompt_sha256,
            max_tokens,
        ));
        emit("reviewer_set", json!({ "signer": signer, "prompt_sha256": prompt_sha256 }));
    }

    pub fn resume(&mut self) {
        self.only_dao();
        self.paused = false;
        emit("resumed", json!({}));
    }

    /// Stops a member's future leaves. Old leaves age out with their period.
    pub fn remove_member(&mut self, account: AccountId) {
        self.only_dao();
        let mut member = self.member_of(&account);
        member.active = false;
        self.members.insert(account.clone(), member);
        emit("member_removed", json!({ "account": account }));
    }

    /// Admits a member. `prior_periods` carries over a record the community
    /// already holds, so moving to Tideover does not restart anyone's waiting period.
    pub fn admit(
        &mut self,
        account: AccountId,
        prior_periods: u32,
        commitment: Option<String>,
    ) {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.dao || Some(&caller) == self.registrar.as_ref(),
            "Only the DAO or its registrar can admit members"
        );
        require!(!self.members.contains_key(&account), "Already a member");
        let commitment = commitment.map(|c| parse_field(&c, "commitment"));
        self.members.insert(
            account.clone(),
            Member {
                commitment,
                joined_at: env::block_timestamp(),
                paid_periods: prior_periods,
                service_points: 0,
                last_paid_period: None,
                leaf: None,
                active: true,
            },
        );
        self.roster.push(account.clone());
        emit("member_admitted", json!({ "account": account, "prior_periods": prior_periods }));
    }

    // ---------- Member calls ----------

    /// Registers the public half of the member's secret. It can be set once.
    pub fn register(&mut self, commitment: String) {
        let account = env::predecessor_account_id();
        let mut member = self.member_of(&account);
        require!(member.commitment.is_none(), "Already registered");
        member.commitment = Some(parse_field(&commitment, "commitment"));
        self.members.insert(account, member);
    }

    /// Dues arrive through `ft_transfer_call`. They pass straight to the DAO: this
    /// contract never keeps the money. Paying adds the member's leaf for this
    /// period, which is what lets them claim anonymously.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            env::predecessor_account_id() == self.token,
            "Only the fund's token is accepted"
        );
        require!(msg == "dues", "Unknown transfer message");
        let dues = self.rules.dues.0;
        require!(amount.0 >= dues, "Less than this period's dues");

        let mut member = self.member_of(&sender_id);
        require!(member.active, "Membership has ended");
        let commitment = member
            .commitment
            .unwrap_or_else(|| env::panic_str("Register before paying dues"));
        let period = self.current_period();
        require!(
            member.last_paid_period != Some(period),
            "Dues for this period are already paid"
        );

        // A missed period is forgiven once. After that the record halves, so
        // cover has to be earned back rather than bought back with one payment.
        if let Some(last) = member.last_paid_period {
            if period - last > 2 {
                member.paid_periods /= 2;
            }
        }
        member.paid_periods += 1;
        member.last_paid_period = Some(period);
        let tier = self.tier_for(member.paid_periods + member.service_points);

        let commitment = fr_from_bytes(&commitment).expect("stored commitment is canonical");
        let leaf = identity::leaf(commitment, period, tier);
        let position = self.tree.insert(leaf);
        self.leaves.push(fr_to_bytes(&leaf));
        self.remember_root();
        member.leaf = Some(Leaf {
            position,
            period,
            tier,
        });
        self.members.insert(sender_id.clone(), member);
        self.dues_collected += dues;
        emit(
            "dues_paid",
            json!({ "account": sender_id, "period": period, "tier": tier, "position": position }),
        );

        let excess = amount.0 - dues;
        PromiseOrValue::Promise(
            ext_ft::ext(self.token.clone())
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(GAS_FT_TRANSFER)
                .ft_transfer(
                    self.dao.clone(),
                    U128(dues),
                    Some(format!("Tideover dues, period {period}")),
                )
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(GAS_CALLBACK)
                        .on_dues_forwarded(U128(dues), U128(excess)),
                ),
        )
    }

    #[private]
    pub fn on_dues_forwarded(
        &mut self,
        dues: U128,
        excess: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> U128 {
        if result.is_err() {
            self.unforwarded += dues.0;
            env::log_str("Dues could not reach the DAO; `sweep` will retry");
        }
        excess
    }

    /// Anyone can push dues that failed to reach the DAO.
    pub fn sweep(&mut self) -> Promise {
        let amount = self.unforwarded;
        require!(amount > 0, "Nothing to sweep");
        self.unforwarded = 0;
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(self.dao.clone(), U128(amount), Some("Tideover dues".to_string()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_swept(U128(amount)),
            )
    }

    #[private]
    pub fn on_swept(&mut self, amount: U128, #[callback_result] result: Result<(), PromiseError>) {
        if result.is_err() {
            self.unforwarded += amount.0;
        }
    }

    /// Anyone can top up the NEAR that pays proposal bonds and storage.
    #[payable]
    pub fn fund_bonds(&mut self) {
        require!(!env::attached_deposit().is_zero(), "Attach NEAR");
    }

    // ---------- Claims ----------

    /// Files a claim. Any account can submit it, usually a relay, because the
    /// proof is what authorises it. The amount, payout and evidence are bound
    /// into the proof, so whoever relays it cannot change them.
    #[allow(clippy::too_many_arguments)]
    pub fn file_claim(
        &mut self,
        proof: String,
        root: String,
        period: u64,
        min_tier: u8,
        nullifier: String,
        amount: U128,
        payout: AccountId,
        evidence_sha256: String,
    ) -> U64 {
        require!(!self.paused, "The fund is paused");
        require!(amount.0 > 0, "Amount must be greater than zero");
        let tier = self
            .rules
            .tiers
            .get(min_tier as usize)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Unknown tier"));
        require!(amount.0 <= tier.cap.0, "Above the cover for this tier");

        let current = self.current_period();
        require!(
            period == current || period + 1 == current,
            "Dues must be paid up to last period"
        );
        let root_bytes = review::unhex32(&root, "root");
        require!(
            self.recent_roots.contains(&root_bytes),
            "Unknown or stale member root"
        );

        self.roll_cycle();
        let cycle = self.cycle_index;
        let window = cycle / self.rules.window_cycles as u64;

        // The tag is the same for all of one member's claims in a window, and it
        // says nothing about who they are. Strict decoding matters here: a
        // non-canonical value would otherwise count as a different member.
        let nullifier_fr = parse_field_fr(&nullifier, "nullifier");
        let nullifier_bytes = fr_to_bytes(&nullifier_fr);

        // The proof comes before any check that reads a tag's history, so that an
        // invalid proof learns nothing about anyone's record.
        let evidence_digest = review::unhex32(&evidence_sha256, "evidence hash");
        let fund = env::current_account_id();
        let scope = identity::scope(fund.as_str(), window);
        let signal = identity::signal(fund.as_str(), amount.0, payout.as_str(), &evidence_digest);
        let inputs = [
            root_bytes,
            fr_to_bytes(&Fr::from(period)),
            fr_to_bytes(&Fr::from(min_tier as u64)),
            fr_to_bytes(&scope),
            nullifier_bytes,
            fr_to_bytes(&signal),
        ];
        let proof_bytes = review::unhex(&proof, "proof");
        match groth16::verify(MEMBERSHIP_VK, &proof_bytes, &inputs) {
            Some(true) => {}
            Some(false) => env::panic_str("The membership proof does not verify"),
            None => env::panic_str("The membership proof is malformed"),
        }

        let record = self.tags.get(&nullifier_bytes).cloned().unwrap_or_default();
        require!(
            record.last_cycle != Some(cycle),
            "This member has already claimed this cycle"
        );
        require!(
            record.used + amount.0 <= tier.year_cap.0,
            "Above this member's limit for the year"
        );
        require!(
            self.cycle_committed + amount.0 <= self.rules.cycle_budget.0,
            "Above what is left in this cycle's budget"
        );

        self.tags.insert(
            nullifier_bytes,
            TagRecord {
                claims: record.claims + 1,
                used: record.used + amount.0,
                last_cycle: Some(cycle),
            },
        );
        self.cycle_committed += amount.0;
        let id = self.claims.len() as u64;
        let nonce = hex::encode(&env::sha256(&[env::random_seed(), id.to_le_bytes().to_vec()].concat())[..16]);
        let now = env::block_timestamp();
        self.claims.push(Claim {
            id: U64(id),
            cycle,
            window,
            prior_claims: record.claims,
            prior_amount: U128(record.used),
            filed_at: U64(now),
            min_tier,
            amount,
            payout: payout.clone(),
            status: ClaimStatus::AwaitingReview,
            route: None,
            card: None,
            deadline: U64(now + self.rules.review_window_secs * NS_PER_SEC),
            nonce,
            evidence_sha256,
            panel: vec![],
            votes: vec![],
            proposal_id: None,
            paid_at: None,
            note: None,
            root,
            nullifier: hex::encode(nullifier_bytes),
            period,
            proof,
            signed_text: None,
            signature: None,
        });
        emit("claim_filed", json!({ "id": U64(id), "amount": amount, "min_tier": min_tier }));
        U64(id)
    }

    /// Posts the sealed reader's verdict. Anyone can post it, because the checks in
    /// `review` need no trust in whoever does.
    #[allow(clippy::too_many_arguments)]
    pub fn post_review(
        &mut self,
        claim_id: U64,
        signed_text: String,
        signature: String,
        system_envelope: String,
        system_eph_secret: String,
        evidence_envelope: String,
        response_body: String,
        verdict_key: String,
    ) -> Card {
        let mut claim = self.claim_of(claim_id);
        let reviewer = self
            .reviewer
            .as_ref()
            .unwrap_or_else(|| env::panic_str("The DAO has not pinned a reviewer"));
        let case = self.case_file_of(&claim);
        let card = review::verify(
            reviewer,
            &review::Sealed {
                signed_text: &signed_text,
                signature_hex: &signature,
                system_envelope: &system_envelope,
                system_eph_secret_hex: &system_eph_secret,
                evidence_envelope: &evidence_envelope,
                response_body: &response_body,
                verdict_key_hex: &verdict_key,
            },
            claim.id.0,
            &case,
            &claim.nonce,
            &claim.evidence_sha256,
        );
        // Checked after the signature, so a forgery is refused as a forgery.
        require!(
            claim.status == ClaimStatus::AwaitingReview,
            "This claim is not waiting for a review"
        );
        claim.card = Some(card.clone());
        claim.signed_text = Some(signed_text);
        claim.signature = Some(signature);
        self.route(&mut claim);
        self.set_claim(claim);
        card
    }

    /// A guardian sends an auto-approved claim to the council instead.
    pub fn veto(&mut self, claim_id: U64) {
        self.only_guardian();
        let mut claim = self.claim_of(claim_id);
        require!(
            claim.status == ClaimStatus::VetoWindow,
            "Only a claim in its veto window can be vetoed"
        );
        claim.status = ClaimStatus::NeedsCouncil;
        claim.note = Some("Sent to the council by a guardian".to_string());
        emit("claim_vetoed", json!({ "id": claim.id }));
        self.set_claim(claim);
    }

    /// Any one guardian can stop new claims and payments. Only a DAO vote resumes.
    pub fn pause(&mut self) {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.dao || self.guardians.contains(&caller),
            "Only the DAO or a guardian can pause"
        );
        self.paused = true;
        emit("paused", json!({ "by": caller }));
    }

    pub fn panel_vote(&mut self, claim_id: U64, approve: bool) {
        let voter = env::predecessor_account_id();
        let mut claim = self.claim_of(claim_id);
        require!(
            claim.status == ClaimStatus::PanelVoting,
            "This claim is not with a panel"
        );
        require!(env::block_timestamp() < claim.deadline.0, "The panel window has closed");
        require!(claim.panel.contains(&voter), "You are not on this panel");
        require!(
            !claim.votes.iter().any(|v| v.member == voter),
            "You have already voted"
        );
        claim.votes.push(PanelVote {
            member: voter.clone(),
            approve,
        });

        // Serving earns points, whichever way the vote went.
        let mut member = self.member_of(&voter);
        member.service_points += 1;
        self.members.insert(voter.clone(), member);

        let quorum = self.rules.panel_quorum as usize;
        let yes = claim.votes.iter().filter(|v| v.approve).count();
        let no = claim.votes.len() - yes;
        if yes >= quorum {
            claim.status = ClaimStatus::Approved;
        } else if no > claim.panel.len() - quorum {
            claim.status = ClaimStatus::Rejected;
            claim.note = Some("Declined by the panel".to_string());
            self.release_budget(&claim);
        }
        emit("panel_vote", json!({ "id": claim.id, "member": voter, "approve": approve }));
        self.set_claim(claim);
    }

    /// Moves a claim to its next stage once that is due. Anyone can call this.
    pub fn advance(&mut self, claim_id: U64) -> Option<Promise> {
        let mut claim = self.claim_of(claim_id);
        let now = env::block_timestamp();
        match claim.status {
            ClaimStatus::AwaitingReview => {
                // The reader being down must not strand someone in need.
                require!(now >= claim.deadline.0, "The review window is still open");
                claim.note = Some("No review arrived in time".to_string());
                self.route(&mut claim);
                self.set_claim(claim);
                None
            }
            ClaimStatus::VetoWindow => {
                require!(now >= claim.deadline.0, "The veto window is still open");
                claim.status = ClaimStatus::Approved;
                self.set_claim(claim);
                Some(self.pay(claim_id))
            }
            ClaimStatus::Approved => Some(self.pay(claim_id)),
            ClaimStatus::PanelVoting => {
                require!(now >= claim.deadline.0, "The panel window is still open");
                claim.status = ClaimStatus::NeedsCouncil;
                claim.note = Some("The panel did not reach a decision in time".to_string());
                self.set_claim(claim);
                None
            }
            ClaimStatus::NeedsCouncil => Some(self.file_for_council(claim_id)),
            ClaimStatus::CouncilVote => {
                let proposal_id = claim
                    .proposal_id
                    .unwrap_or_else(|| env::panic_str("No DAO proposal yet"));
                Some(
                    self.get_proposal(proposal_id).then(
                        Self::ext(env::current_account_id())
                            .with_static_gas(GAS_CALLBACK)
                            .on_council_checked(claim_id),
                    ),
                )
            }
            _ => env::panic_str("There is nothing left to do for this claim"),
        }
    }

    // ---------- Payment through the DAO ----------

    #[private]
    pub fn on_proposal_added(
        &mut self,
        claim_id: U64,
        approve: bool,
        #[callback_result] result: Result<u64, PromiseError>,
    ) -> Option<Promise> {
        let mut claim = self.claim_of(claim_id);
        let proposal_id = match result {
            Ok(id) => id,
            Err(_) => {
                claim.status = if approve {
                    ClaimStatus::Approved
                } else {
                    ClaimStatus::NeedsCouncil
                };
                claim.note = Some("The DAO did not accept the proposal; try again".to_string());
                self.set_claim(claim);
                return None;
            }
        };
        claim.proposal_id = Some(proposal_id);
        if !approve {
            claim.status = ClaimStatus::CouncilVote;
            emit("claim_with_council", json!({ "id": claim.id, "proposal_id": proposal_id }));
            self.set_claim(claim);
            return None;
        }
        let args = json!({
            "id": proposal_id,
            "action": "VoteApprove",
            "proposal": self.transfer_kind(&claim),
        });
        self.set_claim(claim);
        Some(
            Promise::new(self.dao.clone())
                .function_call(
                    "act_proposal".to_string(),
                    args.to_string().into_bytes(),
                    NearToken::from_yoctonear(0),
                    GAS_ACT_PROPOSAL,
                )
                // The vote can succeed without approving, so read the proposal back.
                .then(self.get_proposal(proposal_id))
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(GAS_CALLBACK)
                        .on_payment_checked(claim_id),
                ),
        )
    }

    /// Records the payment from the DAO's own account of what happened.
    #[private]
    pub fn on_payment_checked(
        &mut self,
        claim_id: U64,
        #[callback_result] result: Result<Value, PromiseError>,
    ) {
        let mut claim = self.claim_of(claim_id);
        match proposal_status(&result).as_str() {
            "Approved" => self.mark_paid(&mut claim),
            "InProgress" => {
                claim.status = ClaimStatus::CouncilVote;
                claim.note = Some("The fund's vote did not pass; waiting for the council".to_string());
            }
            other => {
                claim.status = ClaimStatus::Approved;
                claim.note = Some(format!("The DAO marked the payment as {other}; try again"));
            }
        }
        self.set_claim(claim);
    }

    #[private]
    pub fn on_council_checked(
        &mut self,
        claim_id: U64,
        #[callback_result] result: Result<Value, PromiseError>,
    ) {
        let mut claim = self.claim_of(claim_id);
        if claim.status != ClaimStatus::CouncilVote {
            return;
        }
        match proposal_status(&result).as_str() {
            "Approved" => self.mark_paid(&mut claim),
            "InProgress" => {
                env::log_str("Still with the council");
                return;
            }
            other => {
                claim.status = ClaimStatus::Rejected;
                claim.note = Some(format!("The council's proposal ended as {other}"));
                self.release_budget(&claim);
            }
        }
        self.set_claim(claim);
    }

    // ---------- Views ----------

    pub fn get_fund(&self) -> FundView {
        let current = self.current_period();
        let (mut members, mut paid_up) = (0u32, 0u32);
        for account in self.roster.iter().take(MAX_ROSTER_SCAN as usize) {
            if let Some(m) = self.members.get(account) {
                if m.active {
                    members += 1;
                    if self.is_paid_up(m, current) {
                        paid_up += 1;
                    }
                }
            }
        }
        let cycle = self.current_cycle();
        FundView {
            dao: self.dao.clone(),
            token: self.token.clone(),
            rules: self.rules.clone(),
            guardians: self.guardians.clone(),
            registrar: self.registrar.clone(),
            paused: self.paused,
            started_at: U64(self.started_at),
            period: current,
            cycle,
            window: cycle / self.rules.window_cycles as u64,
            members,
            paid_up,
            leaves: self.tree.next_index,
            root: hex::encode(self.tree.root),
            claims: self.claims.len(),
            cycle_committed: U128(if cycle == self.cycle_index {
                self.cycle_committed
            } else {
                0
            }),
            dues_collected: U128(self.dues_collected),
            paid_out: U128(self.paid_out),
            unforwarded: U128(self.unforwarded),
            spare_near: U128(spare_near()),
            reviewer: self.reviewer.as_ref().map(|r| ReviewerView {
                model_id: r.model_id.clone(),
                signer: hex::encode(r.signer),
                prompt_sha256: hex::encode(r.prompt_sha256),
                max_tokens: r.max_tokens,
            }),
        }
    }

    pub fn get_member(&self, account: AccountId) -> Option<MemberView> {
        let m = self.members.get(&account)?;
        let score = m.paid_periods + m.service_points;
        let tier = self.tier_for(score);
        Some(MemberView {
            account,
            commitment: m.commitment.map(hex::encode),
            joined_at: U64(m.joined_at),
            paid_periods: m.paid_periods,
            service_points: m.service_points,
            last_paid_period: m.last_paid_period,
            leaf: m.leaf.clone(),
            active: m.active,
            score,
            tier,
            cap: self.rules.tiers[tier as usize].cap,
            paid_this_period: m.last_paid_period == Some(self.current_period()),
        })
    }

    pub fn get_claim(&self, claim_id: U64) -> Option<Claim> {
        self.claims.get(claim_id.0 as u32).cloned()
    }

    /// The exact text the sealed reader must be given for this claim.
    pub fn get_case_file(&self, claim_id: U64) -> String {
        self.case_file_of(&self.claim_of(claim_id))
    }

    /// Newest first.
    pub fn list_claims(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Claim> {
        let limit = limit.unwrap_or(20).min(50) as usize;
        self.claims
            .iter()
            .rev()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit)
            .cloned()
            .collect()
    }

    pub fn panel_cases(&self, account: AccountId) -> Vec<Claim> {
        self.claims
            .iter()
            .rev()
            .take(100)
            .filter(|c| {
                c.status == ClaimStatus::PanelVoting
                    && c.panel.contains(&account)
                    && !c.votes.iter().any(|v| v.member == account)
            })
            .cloned()
            .collect()
    }

    pub fn get_leaves(&self, from_index: u32, limit: u32) -> Vec<String> {
        self.leaves
            .iter()
            .skip(from_index as usize)
            .take(limit.min(1000) as usize)
            .map(hex::encode)
            .collect()
    }

    pub fn list_roster(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<AccountId> {
        self.roster
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(100).min(200) as usize)
            .cloned()
            .collect()
    }

    pub fn get_tag(&self, nullifier: String) -> Option<(u32, U128)> {
        self.tags
            .get(&review::unhex32(&nullifier, "nullifier"))
            .map(|t| (t.claims, U128(t.used)))
    }

    // ---------- Internal ----------

    fn only_dao(&self) {
        require!(
            env::predecessor_account_id() == self.dao,
            "Only the DAO can do this"
        );
    }

    fn only_guardian(&self) {
        require!(
            self.guardians.contains(&env::predecessor_account_id()),
            "Only a guardian can do this"
        );
    }

    fn current_period(&self) -> u64 {
        env::block_timestamp().saturating_sub(self.started_at)
            / (self.rules.period_secs * NS_PER_SEC)
    }

    fn current_cycle(&self) -> u64 {
        self.current_period() / self.rules.periods_per_cycle as u64
    }

    fn roll_cycle(&mut self) {
        let cycle = self.current_cycle();
        if cycle != self.cycle_index {
            self.cycle_index = cycle;
            self.cycle_committed = 0;
        }
    }

    /// A declined claim gives back its budget and the member's yearly allowance.
    /// It still counts as this cycle's claim.
    fn release_budget(&mut self, claim: &Claim) {
        if claim.cycle == self.cycle_index {
            self.cycle_committed = self.cycle_committed.saturating_sub(claim.amount.0);
        }
        let tag = review::unhex32(&claim.nullifier, "nullifier");
        if let Some(mut record) = self.tags.get(&tag).cloned() {
            record.used = record.used.saturating_sub(claim.amount.0);
            self.tags.insert(tag, record);
        }
    }

    fn tier_for(&self, score: u32) -> u8 {
        self.rules
            .tiers
            .iter()
            .rposition(|t| t.min_score <= score)
            .unwrap_or(0) as u8
    }

    fn is_paid_up(&self, member: &Member, current: u64) -> bool {
        member
            .last_paid_period
            .is_some_and(|p| p == current || p + 1 == current)
    }

    fn remember_root(&mut self) {
        if self.recent_roots.len() >= RECENT_ROOTS {
            self.recent_roots.remove(0);
        }
        self.recent_roots.push(self.tree.root);
    }

    fn member_of(&self, account: &AccountId) -> Member {
        self.members
            .get(account)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Not a member of this fund"))
    }

    fn claim_of(&self, claim_id: U64) -> Claim {
        self.claims
            .get(claim_id.0 as u32)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Unknown claim"))
    }

    fn set_claim(&mut self, claim: Claim) {
        let id = claim.id.0 as u32;
        self.claims.set(id, claim);
    }

    fn case_file_of(&self, claim: &Claim) -> String {
        review::case_file(
            claim.id.0,
            claim.amount.0,
            self.rules.token_decimals,
            claim.filed_at.0,
            &claim.nonce,
        )
    }

    /// Sends a claim down the path its amount and card call for.
    fn route(&mut self, claim: &mut Claim) {
        let route = route_for(&self.rules, claim.amount.0, claim.card.as_ref(), claim.prior_claims);
        let route = if route == Route::Panel {
            match self.draw_panel(claim.id.0) {
                Some(panel) => {
                    claim.panel = panel;
                    Route::Panel
                }
                None => Route::Council,
            }
        } else {
            route
        };
        let now = env::block_timestamp();
        match route {
            Route::Auto => {
                claim.status = ClaimStatus::VetoWindow;
                claim.deadline = U64(now + self.rules.veto_window_secs * NS_PER_SEC);
            }
            Route::Panel => {
                claim.status = ClaimStatus::PanelVoting;
                claim.deadline = U64(now + self.rules.panel_window_secs * NS_PER_SEC);
            }
            Route::Council => claim.status = ClaimStatus::NeedsCouncil,
        }
        claim.route = Some(route);
        emit(
            "claim_routed",
            json!({ "id": claim.id, "route": route, "panel": claim.panel }),
        );
    }

    /// Draws the panel from paid-up members. The claimant is one of them and
    /// cannot be excluded, because nobody knows who they are; the quorum is what
    /// stops them deciding alone.
    fn draw_panel(&self, claim_id: u64) -> Option<Vec<AccountId>> {
        let size = self.rules.panel_size as usize;
        let current = self.current_period();
        let mut eligible: Vec<AccountId> = self
            .roster
            .iter()
            .take(MAX_ROSTER_SCAN as usize)
            .filter(|a| {
                self.members
                    .get(*a)
                    .is_some_and(|m| m.active && self.is_paid_up(m, current))
            })
            .cloned()
            .collect();
        if eligible.len() < size {
            return None;
        }
        let mut seed = env::sha256(
            &[env::random_seed(), claim_id.to_le_bytes().to_vec()].concat(),
        );
        let mut panel = Vec::with_capacity(size);
        for _ in 0..size {
            seed = env::sha256(&seed);
            let draw = u64::from_le_bytes(seed[..8].try_into().unwrap_or([0; 8]));
            panel.push(eligible.swap_remove((draw % eligible.len() as u64) as usize));
        }
        Some(panel)
    }

    fn transfer_kind(&self, claim: &Claim) -> Value {
        json!({
            "Transfer": {
                "token_id": self.token,
                "receiver_id": claim.payout,
                "amount": claim.amount,
                "msg": null,
            }
        })
    }

    /// Registers the receiver on the token, then files the Transfer proposal.
    fn add_transfer_proposal(&self, claim: &Claim, approve: bool) -> Promise {
        let bond = self.rules.proposal_bond.0;
        require!(
            spare_near() >= bond + FT_STORAGE_DEPOSIT,
            "The fund needs more NEAR for bonds; call fund_bonds"
        );
        let description = format!("Tideover claim #{}. Reason sealed.", claim.id.0);
        let args = json!({
            "proposal": { "description": description, "kind": self.transfer_kind(claim) }
        });
        Promise::new(self.token.clone())
            .function_call(
                "storage_deposit".to_string(),
                json!({ "account_id": claim.payout, "registration_only": true })
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(FT_STORAGE_DEPOSIT),
                GAS_STORAGE_DEPOSIT,
            )
            .then(Promise::new(self.dao.clone()).function_call(
                "add_proposal".to_string(),
                args.to_string().into_bytes(),
                NearToken::from_yoctonear(bond),
                GAS_ADD_PROPOSAL,
            ))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(
                        GAS_ACT_PROPOSAL
                            .saturating_add(GAS_VIEW_PROPOSAL)
                            .saturating_add(GAS_CALLBACK)
                            .saturating_add(GAS_CALLBACK),
                    )
                    .on_proposal_added(claim.id, approve),
            )
    }

    fn pay(&mut self, claim_id: U64) -> Promise {
        require!(!self.paused, "The fund is paused");
        let mut claim = self.claim_of(claim_id);
        claim.status = ClaimStatus::Paying;
        let promise = self.add_transfer_proposal(&claim, true);
        self.set_claim(claim);
        promise
    }

    fn file_for_council(&mut self, claim_id: U64) -> Promise {
        require!(!self.paused, "The fund is paused");
        let mut claim = self.claim_of(claim_id);
        claim.status = ClaimStatus::Paying;
        let promise = self.add_transfer_proposal(&claim, false);
        self.set_claim(claim);
        promise
    }

    fn get_proposal(&self, proposal_id: u64) -> Promise {
        Promise::new(self.dao.clone()).function_call(
            "get_proposal".to_string(),
            json!({ "id": proposal_id }).to_string().into_bytes(),
            NearToken::from_yoctonear(0),
            GAS_VIEW_PROPOSAL,
        )
    }

    fn mark_paid(&mut self, claim: &mut Claim) {
        claim.status = ClaimStatus::Paid;
        claim.paid_at = Some(U64(env::block_timestamp()));
        self.paid_out += claim.amount.0;
        emit("claim_paid", json!({ "id": claim.id, "amount": claim.amount }));
    }
}

/// The routing rule, in one place. Being supported is what earns the fast path, and
/// only a first claim in the year can take it. Nothing the reader says can move a
/// claim past the panel or council limits.
pub fn route_for(rules: &Rules, amount: u128, card: Option<&Card>, prior_claims: u32) -> Route {
    if amount > rules.panel_limit.0 {
        return Route::Council;
    }
    let well_supported = card.is_some_and(|c| {
        c.assessment == "supported" && c.recent && c.amount_matches == "yes" && !c.injection
    });
    if well_supported && prior_claims == 0 && amount <= rules.auto_limit.0 {
        Route::Auto
    } else {
        Route::Panel
    }
}

fn spare_near() -> u128 {
    let locked = env::storage_byte_cost().as_yoctonear() * env::storage_usage() as u128;
    env::account_balance().as_yoctonear().saturating_sub(locked)
}

fn proposal_status(result: &Result<Value, PromiseError>) -> String {
    match result {
        Ok(p) => p
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .to_string(),
        // A removed proposal no longer exists on the DAO.
        Err(_) => "Removed".to_string(),
    }
}

fn parse_field(hex_value: &str, what: &str) -> [u8; 32] {
    fr_to_bytes(&parse_field_fr(hex_value, what))
}

fn parse_field_fr(hex_value: &str, what: &str) -> Fr {
    fr_from_bytes(&review::unhex32(hex_value, what))
        .unwrap_or_else(|| env::panic_str(&format!("{what} is not a canonical field element")))
}

fn validate_rules(rules: &Rules) {
    require!(rules.dues.0 > 0, "Dues must be greater than zero");
    require!(rules.period_secs >= 60, "A period must be at least a minute");
    require!(rules.periods_per_cycle >= 1, "A cycle needs at least one period");
    require!(rules.window_cycles >= 1, "A window needs at least one cycle");
    require!(
        !rules.tiers.is_empty() && rules.tiers.len() <= MAX_TIERS,
        "A fund needs between 1 and 16 tiers"
    );
    require!(rules.tiers[0].cap.0 == 0, "Tier 0 is the waiting period and has no cover");
    require!(
        rules
            .tiers
            .windows(2)
            .all(|w| w[0].min_score < w[1].min_score && w[0].cap.0 <= w[1].cap.0),
        "Tiers must rise in both score and cover"
    );
    require!(
        rules.tiers.iter().all(|t| t.year_cap.0 >= t.cap.0),
        "A yearly limit cannot be below the limit for one claim"
    );
    require!(
        rules.auto_limit.0 <= rules.panel_limit.0,
        "The auto limit cannot exceed the panel limit"
    );
    require!(
        rules.panel_quorum >= 1 && rules.panel_quorum <= rules.panel_size,
        "The panel quorum must fit the panel"
    );
    require!(rules.token_decimals <= 24, "Too many decimals");
}

fn emit(event: &str, data: Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "tideover", "version": "1.0.0", "event": event, "data": [data] })
    ));
}
