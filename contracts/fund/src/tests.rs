//! Contract tests with real Groth16 proofs and a simulated clerk. Promises do not
//! run here, so callbacks are called directly with the DAO's answers; the live
//! testnet flow in web/scripts/e2e.mjs covers the real DAO.

use super::*;
use ark_bls12_381::Bls12_381;
use ark_groth16::ProvingKey;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, PromiseResult};
use std::sync::OnceLock;
use tideover_zk::{circuit::MembershipCircuit, keys, near_encoding};

const USD: u128 = 1_000_000;
const PERIOD: u64 = 30 * 24 * 3600;
const T0: u64 = 1_800_000_000;
const COUNCIL_WINDOW: u64 = 7 * 24 * 3600;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn fund() -> AccountId {
    acc("harbor.tideover.testnet")
}
fn dao() -> AccountId {
    acc("harbor.sputnikv2.testnet")
}
fn token() -> AccountId {
    acc("tusd.testnet")
}
fn guardian() -> AccountId {
    acc("guardian.testnet")
}

fn ctx(who: AccountId, now_secs: u64) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(fund())
        .predecessor_account_id(who.clone())
        .signer_account_id(who)
        .block_timestamp(now_secs * NS_PER_SEC)
        .random_seed([7u8; 32])
        .account_balance(NearToken::from_near(100));
    b
}

fn set_ctx(who: AccountId, now_secs: u64) {
    testing_env!(ctx(who, now_secs).build());
}

/// Runs the next call as a callback that received this answer.
fn set_callback(now_secs: u64, result: PromiseResult) {
    testing_env!(
        ctx(fund(), now_secs).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
}

fn rules() -> Rules {
    Rules {
        dues: U128(10 * USD),
        period_secs: PERIOD,
        periods_per_cycle: 3,
        window_cycles: 4,
        min_group: 1,
        tiers: vec![
            Tier {
                min_score: 0,
                cap: U128(0),
                year_cap: U128(0),
            },
            Tier {
                min_score: 3,
                cap: U128(100 * USD),
                year_cap: U128(200 * USD),
            },
            Tier {
                min_score: 6,
                cap: U128(300 * USD),
                year_cap: U128(450 * USD),
            },
            Tier {
                min_score: 12,
                cap: U128(800 * USD),
                year_cap: U128(800 * USD),
            },
        ],
        auto_limit: U128(100 * USD),
        panel_limit: U128(400 * USD),
        cycle_budget: U128(1000 * USD),
        panel_size: 3,
        panel_quorum: 2,
        review_window_secs: 300,
        veto_window_secs: 600,
        panel_window_secs: 3600,
        council_window_secs: COUNCIL_WINDOW,
        proposal_bond: U128(NearToken::from_millinear(100).as_yoctonear()),
        token_decimals: 6,
    }
}

fn pk() -> &'static ProvingKey<Bls12_381> {
    static K: OnceLock<ProvingKey<Bls12_381>> = OnceLock::new();
    K.get_or_init(|| {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../keys/membership.pk");
        keys::pk_from_bytes(&std::fs::read(path).unwrap()).unwrap()
    })
}

struct Person {
    account: AccountId,
    secret: Fr,
}

fn person(name: &str, seed: u64) -> Person {
    Person {
        account: acc(&format!("{name}.testnet")),
        secret: Fr::from(seed * 7919 + 13),
    }
}

fn commitment_hex(p: &Person) -> String {
    hex::encode(fr_to_bytes(&identity::commitment(p.secret)))
}

struct World {
    c: Contract,
    now: u64,
}

impl World {
    fn new() -> Self {
        Self::with_rules(rules())
    }

    fn with_rules(r: Rules) -> Self {
        set_ctx(dao(), T0);
        let c = Contract::new(
            dao(),
            token(),
            r,
            vec![guardian()],
            Some(acc("clerk.testnet")),
        );
        World { c, now: T0 }
    }

    fn at(&mut self, who: AccountId) {
        set_ctx(who, self.now);
    }

    fn join(&mut self, p: &Person, prior: u32) {
        self.at(dao());
        self.c
            .admit(p.account.clone(), prior, Some(commitment_hex(p)));
    }

    fn pay(&mut self, p: &Person) {
        self.at(token());
        let _ = self
            .c
            .ft_on_transfer(p.account.clone(), U128(10 * USD), "dues".to_string());
    }

    fn leaves(&self) -> Vec<Fr> {
        self.c
            .get_leaves(0, 1000)
            .iter()
            .map(|h| fr_from_bytes(&review::unhex32(h, "leaf")).unwrap())
            .collect()
    }

    fn scope(&self, window: u64) -> Fr {
        identity::scope(fund().as_str(), window)
    }
}

#[derive(Clone)]
struct ClaimInput {
    proof: String,
    root: String,
    period: u64,
    min_tier: u8,
    nullifier: String,
    amount: U128,
    payout: AccountId,
    evidence: String,
}

fn evidence_hash() -> String {
    hex::encode(env::sha256(b"a sealed envelope"))
}

fn prove(w: &World, p: &Person, min_tier: u8, amount: u128, payout: &AccountId) -> ClaimInput {
    let leaf = w.c.get_member(p.account.clone()).unwrap().leaf.unwrap();
    prove_leaf(w, p, &leaf, min_tier, amount, payout)
}

fn prove_leaf(
    w: &World,
    p: &Person,
    leaf: &Leaf,
    min_tier: u8,
    amount: u128,
    payout: &AccountId,
) -> ClaimInput {
    let evidence = evidence_hash();
    let digest = review::unhex32(&evidence, "evidence");
    let view = w.c.get_fund();
    let signal = identity::signal(
        fund().as_str(),
        view.cycle,
        amount,
        payout.as_str(),
        &digest,
    );
    let circuit = MembershipCircuit::from_leaves(
        p.secret,
        leaf.tier,
        leaf.period,
        min_tier,
        w.scope(view.window),
        signal,
        &w.leaves(),
        leaf.position,
    );
    let public = circuit.public.clone();
    let proof = keys::prove(pk(), circuit, [3u8; 32]);
    ClaimInput {
        proof: hex::encode(near_encoding::proof_bytes(&proof)),
        root: hex::encode(fr_to_bytes(&public.root)),
        period: leaf.period,
        min_tier,
        nullifier: hex::encode(fr_to_bytes(&public.nullifier)),
        amount: U128(amount),
        payout: payout.clone(),
        evidence,
    }
}

fn file(w: &mut World, i: ClaimInput) -> U64 {
    w.at(acc("relay.testnet"));
    w.c.file_claim(
        i.proof,
        i.root,
        i.period,
        i.min_tier,
        i.nullifier,
        i.amount,
        i.payout,
        i.evidence,
    )
}

fn payout() -> AccountId {
    acc("a1b2c3.testnet")
}

/// A member at tier 2 with paid-up dues, plus enough others to draw a panel from.
fn world_with_members() -> (World, Person) {
    let mut w = World::new();
    let amara = person("amara", 1);
    w.join(&amara, 7);
    w.pay(&amara);
    for (i, name) in ["ben", "chi", "dara", "eli"].iter().enumerate() {
        let p = person(name, 10 + i as u64);
        w.join(&p, 3);
        w.pay(&p);
    }
    (w, amara)
}

fn filed_claim(amount: u128) -> (World, Person, U64) {
    let (mut w, amara) = world_with_members();
    let input = prove(&w, &amara, 2, amount, &payout());
    let id = file(&mut w, input);
    (w, amara, id)
}

// ---------- A simulated clerk ----------

fn clerk_key() -> SigningKey {
    SigningKey::from_bytes(&[42u8; 32])
}

fn pin_clerk(w: &mut World) {
    w.at(dao());
    w.c.set_reviewer(
        hex::encode(clerk_key().verifying_key().to_bytes()),
        "aa".repeat(32),
        "sha256-of-the-clerk-build".to_string(),
        "bb".repeat(32),
    );
}

fn card(assessment: &str, injection: bool) -> Card {
    Card {
        category: "medical".to_string(),
        document: "bill".to_string(),
        recent: true,
        amount_matches: "yes".to_string(),
        injection,
        assessment: assessment.to_string(),
    }
}

fn sign(w: &World, id: U64, c: &Card, key: &SigningKey) -> String {
    let claim = w.c.get_claim(id).unwrap();
    let message = review::card_message(
        fund().as_str(),
        id.0,
        &claim.nonce,
        &claim.evidence_sha256,
        claim.amount.0,
        claim.payout.as_str(),
        c,
    );
    hex::encode(key.sign(message.as_bytes()).to_bytes())
}

fn post(w: &mut World, id: U64, c: Card, signature: String) {
    w.at(acc("relay.testnet"));
    w.c.post_card(id, c, signature);
}

fn reviewed(amount: u128, assessment: &str, injection: bool) -> (World, U64) {
    let (mut w, _, id) = filed_claim(amount);
    pin_clerk(&mut w);
    let c = card(assessment, injection);
    let signature = sign(&w, id, &c, &clerk_key());
    post(&mut w, id, c, signature);
    (w, id)
}

fn status(w: &World, id: U64) -> ClaimStatus {
    w.c.get_claim(id).unwrap().status
}

// ---------- Dues and tiers ----------

#[test]
fn dues_add_a_leaf_and_raise_the_record() {
    let mut w = World::new();
    let p = person("amara", 1);
    w.join(&p, 2);
    assert_eq!(w.c.get_member(p.account.clone()).unwrap().tier, 0);
    w.pay(&p);
    let m = w.c.get_member(p.account.clone()).unwrap();
    assert_eq!((m.paid_periods, m.tier, m.cap.0), (3, 1, 100 * USD));
    assert_eq!(
        m.leaf,
        Some(Leaf {
            position: 0,
            period: 0,
            tier: 1
        })
    );
    assert!(m.paid_this_period);
    assert_eq!(w.c.get_fund().dues_collected.0, 10 * USD);
}

#[test]
fn the_previous_leaf_is_kept_so_a_member_can_prove_a_finished_group() {
    let mut w = World::new();
    let p = person("amara", 1);
    w.join(&p, 3);
    w.pay(&p);
    w.now += PERIOD + 1;
    w.pay(&p);
    let m = w.c.get_member(p.account).unwrap();
    assert_eq!(m.prev_leaf.unwrap().period, 0);
    assert_eq!(m.leaf.unwrap().period, 1);
}

#[test]
#[should_panic(expected = "Only the fund's token")]
fn dues_only_arrive_in_the_funds_token() {
    let mut w = World::new();
    let p = person("amara", 1);
    w.join(&p, 0);
    w.at(acc("fake-usd.testnet"));
    let _ =
        w.c.ft_on_transfer(p.account, U128(10 * USD), "dues".to_string());
}

#[test]
#[should_panic(expected = "already paid")]
fn dues_cannot_be_paid_twice_in_a_period() {
    let mut w = World::new();
    let p = person("amara", 1);
    w.join(&p, 0);
    w.pay(&p);
    w.pay(&p);
}

#[test]
#[should_panic(expected = "Less than this period's dues")]
fn short_dues_are_refused() {
    let mut w = World::new();
    let p = person("amara", 1);
    w.join(&p, 0);
    w.at(token());
    let _ = w.c.ft_on_transfer(p.account, U128(USD), "dues".to_string());
}

#[test]
#[should_panic(expected = "Not a member")]
fn strangers_cannot_pay_their_way_in() {
    let mut w = World::new();
    w.pay(&person("mallory", 9));
}

#[test]
fn a_long_lapse_halves_the_record() {
    let mut w = World::new();
    let p = person("amara", 1);
    w.join(&p, 9);
    w.pay(&p);
    w.now += PERIOD * 2;
    w.pay(&p);
    assert_eq!(w.c.get_member(p.account.clone()).unwrap().paid_periods, 11);
    w.now += PERIOD * 4;
    w.pay(&p);
    assert_eq!(w.c.get_member(p.account).unwrap().paid_periods, 6);
}

// ---------- Filing ----------

#[test]
fn a_paid_up_member_files_a_claim_with_no_name_on_it() {
    let (w, _, id) = filed_claim(90 * USD);
    let claim = w.c.get_claim(id).unwrap();
    assert_eq!(claim.status, ClaimStatus::AwaitingReview);
    assert_eq!(claim.amount.0, 90 * USD);
    assert_eq!(w.c.get_fund().cycle_committed.0, 90 * USD);
    let json = near_sdk::serde_json::to_string(&claim).unwrap();
    assert!(
        !json.contains("amara"),
        "the claim must not name its member"
    );
}

#[test]
fn a_member_can_prove_last_periods_finished_group() {
    let (mut w, amara) = world_with_members();
    w.now += PERIOD + 1;
    w.pay(&amara);
    let m = w.c.get_member(amara.account.clone()).unwrap();
    let last = m.prev_leaf.unwrap();
    let input = prove_leaf(&w, &amara, &last, 1, 90 * USD, &payout());
    let id = file(&mut w, input);
    assert_eq!(w.c.get_claim(id).unwrap().period, 0);
}

#[test]
#[should_panic(expected = "already claimed this cycle")]
fn one_claim_per_cycle() {
    let (mut w, amara, _) = filed_claim(90 * USD);
    let second = prove(&w, &amara, 2, 10 * USD, &acc("other.testnet"));
    file(&mut w, second);
}

#[test]
#[should_panic(expected = "does not verify")]
fn nobody_can_replay_a_members_proof_into_the_next_cycle() {
    let mut w = World::new();
    let p = person("amara", 1);
    w.join(&p, 7);
    w.pay(&p);
    // The last period of the first cycle.
    w.now += PERIOD * 2 + 1;
    w.pay(&p);
    let input = prove(&w, &p, 2, 90 * USD, &payout());
    file(&mut w, input.clone());
    // The next period, in the same year, with the same root still recent.
    w.now += PERIOD;
    file(&mut w, input);
}

#[test]
fn a_new_cycle_allows_a_new_claim() {
    let (mut w, amara, _) = filed_claim(90 * USD);
    w.now += PERIOD + 1;
    w.pay(&amara);
    w.now += PERIOD + 1;
    w.pay(&amara);
    w.now += PERIOD + 1;
    w.pay(&amara);
    let again = prove(&w, &amara, 1, 10 * USD, &payout());
    assert_eq!(file(&mut w, again).0, 1);
}

#[test]
#[should_panic(expected = "limit for the year")]
fn a_repeat_cheat_hits_the_yearly_limit() {
    let (mut w, amara, _) = filed_claim(300 * USD);
    for _ in 0..3 {
        w.now += PERIOD + 1;
        w.pay(&amara);
    }
    // $300 this year already, with $150 left of the $450 limit.
    let second = prove(&w, &amara, 2, 160 * USD, &payout());
    file(&mut w, second);
}

#[test]
fn the_contract_counts_an_anonymous_members_claims_without_knowing_who() {
    let (mut w, amara, first) = filed_claim(100 * USD);
    assert_eq!(w.c.get_claim(first).unwrap().prior_claims, 0);
    for _ in 0..3 {
        w.now += PERIOD + 1;
        w.pay(&amara);
    }
    let second = prove(&w, &amara, 1, 50 * USD, &payout());
    let id = file(&mut w, second);
    let c = w.c.get_claim(id).unwrap();
    assert_eq!((c.prior_claims, c.prior_amount.0), (1, 100 * USD));
}

#[test]
fn a_second_claim_in_a_year_never_takes_the_fast_path() {
    let (mut w, amara, _) = filed_claim(100 * USD);
    for _ in 0..3 {
        w.now += PERIOD + 1;
        w.pay(&amara);
        for (i, name) in ["ben", "chi", "dara", "eli"].iter().enumerate() {
            w.pay(&person(name, 10 + i as u64));
        }
    }
    let second = prove(&w, &amara, 1, 50 * USD, &payout());
    let id = file(&mut w, second);
    pin_clerk(&mut w);
    let c = card("supported", false);
    let signature = sign(&w, id, &c, &clerk_key());
    post(&mut w, id, c, signature);
    assert_eq!(w.c.get_claim(id).unwrap().route, Some(Route::Panel));
}

#[test]
fn a_new_year_gives_a_new_tag_and_a_new_allowance() {
    let (mut w, amara, first) = filed_claim(300 * USD);
    let tag = w.c.get_claim(first).unwrap().nullifier;
    w.now += PERIOD * 12 + 1;
    // The 12-month gap halves her record, so this claim proves the lower tier.
    w.pay(&amara);
    let next = prove(&w, &amara, 1, 100 * USD, &payout());
    let id = file(&mut w, next);
    let c = w.c.get_claim(id).unwrap();
    assert_eq!(c.prior_claims, 0);
    assert_ne!(
        c.nullifier, tag,
        "last year's claims must not link to this year's"
    );
}

#[test]
fn a_declined_claim_gives_back_the_yearly_allowance() {
    let (mut w, id) = reviewed(250 * USD, "unclear", false);
    let tag = w.c.get_claim(id).unwrap().nullifier;
    let panel = panel_of(&w, id);
    for voter in &panel[..2] {
        w.at(voter.clone());
        w.c.panel_vote(id, false);
    }
    assert_eq!(w.c.get_tag(tag), Some((1, U128(0))));
}

#[test]
#[should_panic(expected = "Above the cover")]
fn a_claim_cannot_exceed_the_proven_tier() {
    let (mut w, amara) = world_with_members();
    let input = prove(&w, &amara, 1, 150 * USD, &payout());
    file(&mut w, input);
}

#[test]
#[should_panic(expected = "Above what is left")]
fn the_cycle_budget_holds() {
    let (mut w, amara) = world_with_members();
    w.at(dao());
    let mut r = rules();
    r.cycle_budget = U128(50 * USD);
    w.c.set_rules(r);
    let input = prove(&w, &amara, 2, 60 * USD, &payout());
    file(&mut w, input);
}

#[test]
#[should_panic(expected = "does not verify")]
fn a_relay_cannot_change_the_amount() {
    let (mut w, amara) = world_with_members();
    let mut input = prove(&w, &amara, 2, 50 * USD, &payout());
    input.amount = U128(250 * USD);
    file(&mut w, input);
}

#[test]
#[should_panic(expected = "does not verify")]
fn a_relay_cannot_redirect_the_payout() {
    let (mut w, amara) = world_with_members();
    let mut input = prove(&w, &amara, 2, 50 * USD, &payout());
    input.payout = acc("thief.testnet");
    file(&mut w, input);
}

#[test]
#[should_panic(expected = "does not verify")]
fn a_relay_cannot_swap_the_evidence() {
    let (mut w, amara) = world_with_members();
    let mut input = prove(&w, &amara, 2, 50 * USD, &payout());
    input.evidence = "11".repeat(32);
    file(&mut w, input);
}

#[test]
fn a_relay_changing_the_hex_case_changes_nothing() {
    let (mut w, amara) = world_with_members();
    let mut input = prove(&w, &amara, 2, 50 * USD, &payout());
    input.evidence = input.evidence.to_uppercase();
    let id = file(&mut w, input);
    assert_eq!(w.c.get_claim(id).unwrap().evidence_sha256, evidence_hash());
}

#[test]
#[should_panic(expected = "does not verify")]
fn a_member_cannot_claim_a_higher_tier_with_a_lower_proof() {
    let (mut w, amara) = world_with_members();
    let mut input = prove(&w, &amara, 1, 90 * USD, &payout());
    input.min_tier = 2;
    file(&mut w, input);
}

#[test]
#[should_panic(expected = "Unknown or stale")]
fn a_made_up_root_is_refused() {
    let (mut w, amara) = world_with_members();
    let mut input = prove(&w, &amara, 2, 50 * USD, &payout());
    input.root = "22".repeat(32);
    file(&mut w, input);
}

#[test]
#[should_panic(expected = "paid up to last period")]
fn lapsed_members_cannot_claim() {
    let (mut w, amara) = world_with_members();
    let input = prove(&w, &amara, 2, 50 * USD, &payout());
    w.now += PERIOD * 2;
    file(&mut w, input);
}

#[test]
#[should_panic(expected = "not a canonical")]
fn a_non_canonical_nullifier_is_refused() {
    let (mut w, amara) = world_with_members();
    let mut input = prove(&w, &amara, 2, 50 * USD, &payout());
    input.nullifier = "ff".repeat(32);
    file(&mut w, input);
}

#[test]
#[should_panic(expected = "paused")]
fn a_paused_fund_takes_no_claims() {
    let (mut w, amara) = world_with_members();
    w.at(guardian());
    w.c.pause();
    let input = prove(&w, &amara, 2, 50 * USD, &payout());
    file(&mut w, input);
}

#[test]
#[should_panic(expected = "DAO cannot be the payout")]
fn the_dao_cannot_be_the_payout_address() {
    let (mut w, amara) = world_with_members();
    let input = prove(&w, &amara, 2, 50 * USD, &dao());
    file(&mut w, input);
}

// ---------- The size of the crowd ----------

fn world_needing_a_group(min_group: u32, members: u64) -> (World, Vec<Person>) {
    let mut r = rules();
    r.min_group = min_group;
    let mut w = World::with_rules(r);
    let people: Vec<Person> = (0..members)
        .map(|i| person(&format!("member{i}"), i + 1))
        .collect();
    for p in &people {
        w.join(p, 7);
        w.pay(p);
    }
    (w, people)
}

#[test]
#[should_panic(expected = "Too few members")]
fn a_claim_cannot_hide_in_a_crowd_of_one() {
    let (mut w, people) = world_needing_a_group(3, 2);
    let input = prove(&w, &people[0], 2, 50 * USD, &payout());
    file(&mut w, input);
}

#[test]
fn a_big_enough_crowd_is_accepted() {
    let (mut w, people) = world_needing_a_group(3, 3);
    let input = prove(&w, &people[0], 2, 50 * USD, &payout());
    file(&mut w, input);
    assert_eq!(w.c.get_group_size(0, 2), 3);
}

#[test]
#[should_panic(expected = "Too few members")]
fn the_crowd_is_counted_at_the_claimed_tier_or_above() {
    let (mut w, people) = world_needing_a_group(3, 3);
    let junior = person("junior", 90);
    w.join(&junior, 2);
    w.pay(&junior);
    assert_eq!(w.c.get_group_size(0, 1), 4);
    let senior = person("senior", 91);
    w.join(&senior, 20);
    w.pay(&senior);
    assert_eq!(w.c.get_group_size(0, 3), 1);
    let input = prove(&w, &senior, 3, 500 * USD, &payout());
    drop(people);
    file(&mut w, input);
}

// ---------- The clerk's card ----------

#[test]
fn a_supported_small_claim_goes_to_the_veto_window() {
    let (w, id) = reviewed(90 * USD, "supported", false);
    let c = w.c.get_claim(id).unwrap();
    assert_eq!(
        (c.status, c.route),
        (ClaimStatus::VetoWindow, Some(Route::Auto))
    );
    assert_eq!(c.card.unwrap().category, "medical");
}

#[test]
fn a_supported_mid_claim_goes_to_a_panel_of_three() {
    let (w, id) = reviewed(250 * USD, "supported", false);
    let c = w.c.get_claim(id).unwrap();
    assert_eq!(
        (c.status, c.route),
        (ClaimStatus::PanelVoting, Some(Route::Panel))
    );
    assert_eq!(c.panel.len(), 3);
    let mut unique = c.panel.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), 3);
}

#[test]
fn an_unclear_small_claim_goes_to_a_panel_not_the_fast_path() {
    let (w, id) = reviewed(90 * USD, "unclear", false);
    assert_eq!(w.c.get_claim(id).unwrap().route, Some(Route::Panel));
}

#[test]
fn a_prompt_injection_loses_the_fast_path_even_if_the_ai_says_supported() {
    let (w, id) = reviewed(90 * USD, "supported", true);
    assert_eq!(w.c.get_claim(id).unwrap().route, Some(Route::Panel));
}

#[test]
fn large_amounts_always_reach_the_council_whatever_the_card_says() {
    let r = rules();
    let c = card("supported", false);
    assert_eq!(route_for(&r, 401 * USD, Some(&c), 0), Route::Council);
    assert_eq!(route_for(&r, 400 * USD, Some(&c), 0), Route::Panel);
    assert_eq!(route_for(&r, 100 * USD, Some(&c), 0), Route::Auto);
    assert_eq!(route_for(&r, 100 * USD, None, 0), Route::Panel);
    assert_eq!(
        route_for(&r, 100 * USD, Some(&c), 1),
        Route::Panel,
        "a second claim always reaches people"
    );
}

#[test]
#[should_panic(expected = "bad clerk signature")]
fn a_forged_card_is_refused() {
    let (mut w, _, id) = filed_claim(90 * USD);
    pin_clerk(&mut w);
    let c = card("supported", false);
    let forger = SigningKey::from_bytes(&[1u8; 32]);
    let signature = sign(&w, id, &c, &forger);
    post(&mut w, id, c, signature);
}

#[test]
#[should_panic(expected = "bad clerk signature")]
fn a_forged_card_is_refused_as_a_forgery_even_on_a_finished_claim() {
    let (mut w, id) = reviewed(90 * USD, "supported", false);
    let c = card("supported", false);
    let forger = SigningKey::from_bytes(&[1u8; 32]);
    let signature = sign(&w, id, &c, &forger);
    post(&mut w, id, c, signature);
}

#[test]
#[should_panic(expected = "bad clerk signature")]
fn a_card_cannot_be_changed_after_signing() {
    let (mut w, _, id) = filed_claim(90 * USD);
    pin_clerk(&mut w);
    let signature = sign(&w, id, &card("unclear", false), &clerk_key());
    post(&mut w, id, card("supported", false), signature);
}

#[test]
#[should_panic(expected = "bad clerk signature")]
fn a_card_cannot_move_to_another_claim() {
    // A member copies a good card from someone else's claim onto their own.
    let (mut w, amara, first) = filed_claim(90 * USD);
    pin_clerk(&mut w);
    let c = card("supported", false);
    let signature = sign(&w, first, &c, &clerk_key());
    for _ in 0..3 {
        w.now += PERIOD + 1;
        w.pay(&amara);
    }
    let input = prove(&w, &amara, 1, 90 * USD, &payout());
    let second = file(&mut w, input);
    post(&mut w, second, c, signature);
}

#[test]
#[should_panic(expected = "bad clerk signature")]
fn a_card_for_one_payout_does_not_fit_another() {
    let (mut w, amara) = world_with_members();
    pin_clerk(&mut w);
    let input = prove(&w, &amara, 2, 90 * USD, &payout());
    let id = file(&mut w, input);
    let claim = w.c.get_claim(id).unwrap();
    let c = card("supported", false);
    let message = review::card_message(
        fund().as_str(),
        id.0,
        &claim.nonce,
        &claim.evidence_sha256,
        claim.amount.0,
        "someone-else.testnet",
        &c,
    );
    let signature = hex::encode(clerk_key().sign(message.as_bytes()).to_bytes());
    post(&mut w, id, c, signature);
}

#[test]
#[should_panic(expected = "outside its closed set")]
fn free_text_cannot_reach_the_chain_even_from_a_broken_clerk() {
    let (mut w, _, id) = filed_claim(90 * USD);
    pin_clerk(&mut w);
    let mut c = card("supported", false);
    c.category = "Amara's son has leukaemia".to_string();
    let signature = sign(&w, id, &c, &clerk_key());
    post(&mut w, id, c, signature);
}

#[test]
#[should_panic(expected = "not waiting for a review")]
fn a_card_cannot_be_posted_twice() {
    let (mut w, id) = reviewed(90 * USD, "supported", false);
    let c = card("unclear", false);
    let signature = sign(&w, id, &c, &clerk_key());
    post(&mut w, id, c, signature);
}

#[test]
fn the_signed_text_is_exactly_what_the_clerk_builds() {
    set_ctx(acc("relay.testnet"), T0);
    assert_eq!(
        review::card_message(
            "harbor.tideover.testnet",
            7,
            "abcd",
            "ef01",
            90_000_000,
            "a1b2c3.testnet",
            &card("supported", false),
        ),
        "tideover/card/v1\nharbor.tideover.testnet\n7\nabcd\nef01\n90000000\na1b2c3.testnet\nmedical\nbill\ntrue\nyes\nfalse\nsupported"
    );
}

#[test]
fn if_the_reader_is_down_the_claim_still_reaches_people() {
    let (mut w, _, id) = filed_claim(90 * USD);
    w.now += 301;
    w.at(acc("anyone.testnet"));
    assert!(w.c.advance(id).is_none());
    assert_eq!(status(&w, id), ClaimStatus::PanelVoting);
}

#[test]
#[should_panic(expected = "review window is still open")]
fn the_review_window_cannot_be_skipped() {
    let (mut w, _, id) = filed_claim(90 * USD);
    w.at(acc("anyone.testnet"));
    w.c.advance(id);
}

// ---------- The veto window ----------

#[test]
#[should_panic(expected = "veto window is still open")]
fn nothing_pays_before_the_veto_window_ends() {
    let (mut w, id) = reviewed(90 * USD, "supported", false);
    w.at(acc("anyone.testnet"));
    w.c.advance(id);
}

#[test]
fn after_the_veto_window_anyone_can_release_the_payment() {
    let (mut w, id) = reviewed(90 * USD, "supported", false);
    w.now += 601;
    w.at(acc("anyone.testnet"));
    assert!(w.c.advance(id).is_some());
    assert_eq!(status(&w, id), ClaimStatus::Paying);
}

#[test]
fn a_guardian_can_send_a_claim_to_the_council() {
    let (mut w, id) = reviewed(90 * USD, "supported", false);
    w.at(guardian());
    w.c.veto(id);
    assert_eq!(status(&w, id), ClaimStatus::NeedsCouncil);
}

#[test]
#[should_panic(expected = "Only a guardian")]
fn only_guardians_can_veto() {
    let (mut w, id) = reviewed(90 * USD, "supported", false);
    w.at(acc("anyone.testnet"));
    w.c.veto(id);
}

// ---------- The panel ----------

fn panel_of(w: &World, id: U64) -> Vec<AccountId> {
    w.c.get_claim(id).unwrap().panel
}

#[test]
fn two_of_three_approve_and_panelists_earn_service_points() {
    let (mut w, id) = reviewed(250 * USD, "supported", false);
    let panel = panel_of(&w, id);
    let before = w.c.get_member(panel[0].clone()).unwrap().score;
    w.at(panel[0].clone());
    w.c.panel_vote(id, true);
    assert_eq!(status(&w, id), ClaimStatus::PanelVoting);
    w.at(panel[1].clone());
    w.c.panel_vote(id, true);
    assert_eq!(status(&w, id), ClaimStatus::Approved);
    assert_eq!(w.c.get_member(panel[0].clone()).unwrap().score, before + 1);
}

#[test]
fn two_of_three_decline_and_the_budget_is_released() {
    let (mut w, id) = reviewed(250 * USD, "unclear", false);
    let panel = panel_of(&w, id);
    assert_eq!(w.c.get_fund().cycle_committed.0, 250 * USD);
    w.at(panel[0].clone());
    w.c.panel_vote(id, false);
    w.at(panel[1].clone());
    w.c.panel_vote(id, false);
    assert_eq!(status(&w, id), ClaimStatus::Rejected);
    assert_eq!(w.c.get_fund().cycle_committed.0, 0);
}

#[test]
#[should_panic(expected = "not on this panel")]
fn outsiders_cannot_vote() {
    let (mut w, id) = reviewed(250 * USD, "supported", false);
    w.at(acc("mallory.testnet"));
    w.c.panel_vote(id, true);
}

#[test]
#[should_panic(expected = "already voted")]
fn nobody_votes_twice() {
    let (mut w, id) = reviewed(250 * USD, "supported", false);
    let panel = panel_of(&w, id);
    w.at(panel[0].clone());
    w.c.panel_vote(id, true);
    w.at(panel[0].clone());
    w.c.panel_vote(id, true);
}

#[test]
fn a_silent_panel_hands_over_to_the_council() {
    let (mut w, id) = reviewed(250 * USD, "supported", false);
    w.now += 3601;
    w.at(acc("anyone.testnet"));
    w.c.advance(id);
    assert_eq!(status(&w, id), ClaimStatus::NeedsCouncil);
}

#[test]
fn a_fund_too_small_for_a_panel_uses_the_council() {
    let mut w = World::new();
    let a = person("amara", 1);
    w.join(&a, 7);
    w.pay(&a);
    let input = prove(&w, &a, 2, 250 * USD, &payout());
    let id = file(&mut w, input);
    pin_clerk(&mut w);
    let c = card("supported", false);
    let signature = sign(&w, id, &c, &clerk_key());
    post(&mut w, id, c, signature);
    let c = w.c.get_claim(id).unwrap();
    assert_eq!(
        (c.status, c.route),
        (ClaimStatus::NeedsCouncil, Some(Route::Council))
    );
}

// ---------- Paying through the DAO ----------

fn dao_says(status: &str) -> PromiseResult {
    PromiseResult::Successful(format!("{{\"status\":\"{status}\"}}").into_bytes())
}

/// A panel-approved claim whose proposal has been filed and voted for.
fn paying_claim() -> (World, U64) {
    let (mut w, id) = reviewed(250 * USD, "supported", false);
    let panel = panel_of(&w, id);
    for voter in &panel[..2] {
        w.at(voter.clone());
        w.c.panel_vote(id, true);
    }
    w.at(acc("anyone.testnet"));
    w.c.advance(id);
    assert_eq!(status(&w, id), ClaimStatus::Paying);
    (w, id)
}

fn voted_claim() -> (World, U64) {
    let (mut w, id) = paying_claim();
    set_callback(w.now, PromiseResult::Successful(b"12".to_vec()));
    assert!(w.c.on_proposal_added(id, true, Ok(12)).is_some());
    assert_eq!(w.c.get_claim(id).unwrap().proposal_id, Some(12));
    (w, id)
}

fn read(w: &mut World, id: U64, answer: &str) -> Option<Promise> {
    set_callback(w.now, dao_says(answer));
    let value = near_sdk::serde_json::from_str(&format!("{{\"status\":\"{answer}\"}}")).unwrap();
    w.c.on_proposal_read(id, Ok(value))
}

#[test]
fn approved_is_not_paid_until_the_transfer_has_had_time_to_fail() {
    let (mut w, id) = voted_claim();
    assert!(read(&mut w, id, "Approved").is_none());
    assert_eq!(status(&w, id), ClaimStatus::Settling);
    assert_eq!(
        w.c.get_fund().paid_out.0,
        0,
        "nothing has been confirmed yet"
    );
}

#[test]
#[should_panic(expected = "still settling")]
fn a_payment_cannot_be_confirmed_early() {
    let (mut w, id) = voted_claim();
    read(&mut w, id, "Approved");
    w.at(acc("anyone.testnet"));
    w.c.advance(id);
}

#[test]
fn a_second_read_cannot_confirm_a_payment_early() {
    // Two `advance` calls around the deciding council vote both read the proposal.
    // The first read starts the wait, and the second must not end it.
    let (mut w, id) = council_claim();
    read(&mut w, id, "Approved");
    read(&mut w, id, "Approved");
    assert_eq!(status(&w, id), ClaimStatus::Settling);
    assert_eq!(w.c.get_fund().paid_out.0, 0);
}

fn time_out_the_filing(w: &mut World, id: U64) {
    w.now += IN_FLIGHT_SECS + 1;
    w.at(acc("anyone.testnet"));
    w.c.advance(id);
    assert_eq!(status(w, id), ClaimStatus::Approved);
}

#[test]
fn a_delayed_answer_cannot_put_a_second_approved_proposal_on_a_claim() {
    let (mut w, id) = paying_claim();
    time_out_the_filing(&mut w, id);
    w.at(acc("anyone.testnet"));
    w.c.advance(id);
    assert_eq!(status(&w, id), ClaimStatus::Paying);

    // Both filings now answer. Only one proposal gets the fund's vote.
    set_callback(w.now, PromiseResult::Successful(b"12".to_vec()));
    assert!(w.c.on_proposal_added(id, true, Ok(12)).is_some());
    set_callback(w.now, PromiseResult::Successful(b"13".to_vec()));
    assert!(w.c.on_proposal_added(id, true, Ok(13)).is_none());
    assert_eq!(w.c.get_claim(id).unwrap().proposal_id, Some(12));
}

#[test]
fn a_delayed_answer_is_ignored_once_the_claim_has_moved_on() {
    let (mut w, id) = paying_claim();
    time_out_the_filing(&mut w, id);
    set_callback(w.now, PromiseResult::Successful(b"12".to_vec()));
    assert!(w.c.on_proposal_added(id, true, Ok(12)).is_none());
    assert_eq!(status(&w, id), ClaimStatus::Approved);
    assert_eq!(w.c.get_claim(id).unwrap().proposal_id, None);
}

#[test]
fn a_payment_counts_once_the_dao_still_says_approved_later() {
    let (mut w, id) = voted_claim();
    read(&mut w, id, "Approved");
    w.now += SETTLE_SECS + 1;
    w.at(acc("anyone.testnet"));
    assert!(w.c.advance(id).is_some());
    read(&mut w, id, "Approved");
    assert_eq!(status(&w, id), ClaimStatus::Paid);
    assert_eq!(w.c.get_fund().paid_out.0, 250 * USD);
}

#[test]
fn a_failed_transfer_retries_the_same_proposal_and_marks_nothing_paid() {
    let (mut w, id) = voted_claim();
    read(&mut w, id, "Approved");
    w.now += SETTLE_SECS + 1;
    assert!(
        read(&mut w, id, "Failed").is_some(),
        "a Finalize retry should follow"
    );
    let c = w.c.get_claim(id).unwrap();
    assert_eq!((c.status, c.proposal_id), (ClaimStatus::Settling, Some(12)));
    assert_eq!(w.c.get_fund().paid_out.0, 0);
    assert_eq!(
        w.c.get_fund().cycle_committed.0,
        250 * USD,
        "the allowance stays spent while money can still move"
    );
}

#[test]
fn a_retry_that_works_ends_as_paid() {
    let (mut w, id) = voted_claim();
    read(&mut w, id, "Failed");
    w.now += SETTLE_SECS + 1;
    read(&mut w, id, "Approved");
    assert_eq!(status(&w, id), ClaimStatus::Paid);
}

#[test]
fn a_pause_stops_the_retry() {
    let (mut w, id) = voted_claim();
    w.at(guardian());
    w.c.pause();
    assert!(read(&mut w, id, "Failed").is_none());
}

#[test]
fn a_vote_that_did_not_pass_waits_for_the_council() {
    let (mut w, id) = voted_claim();
    read(&mut w, id, "InProgress");
    assert_eq!(status(&w, id), ClaimStatus::CouncilVote);
}

#[test]
fn a_proposal_that_ends_badly_releases_the_budget() {
    for ending in ["Rejected", "Removed", "Expired", "Moved"] {
        // The mock chain is per thread, so each ending gets a clean one.
        std::thread::spawn(move || {
            let (mut w, id) = voted_claim();
            read(&mut w, id, ending);
            assert_eq!(status(&w, id), ClaimStatus::Rejected, "{ending}");
            assert_eq!(w.c.get_fund().cycle_committed.0, 0, "{ending}");
        })
        .join()
        .unwrap();
    }
}

#[test]
fn a_late_answer_cannot_undo_a_paid_claim() {
    let (mut w, id) = voted_claim();
    read(&mut w, id, "Approved");
    w.now += SETTLE_SECS + 1;
    read(&mut w, id, "Approved");
    read(&mut w, id, "Rejected");
    assert_eq!(status(&w, id), ClaimStatus::Paid);
}

fn council_claim() -> (World, U64) {
    let (mut w, id) = reviewed(90 * USD, "supported", false);
    w.at(guardian());
    w.c.veto(id);
    w.at(acc("anyone.testnet"));
    w.c.advance(id);
    assert_eq!(status(&w, id), ClaimStatus::Filing);
    set_callback(w.now, PromiseResult::Successful(b"12".to_vec()));
    assert!(w.c.on_proposal_added(id, false, Ok(12)).is_none());
    assert_eq!(status(&w, id), ClaimStatus::CouncilVote);
    (w, id)
}

#[test]
fn a_council_approval_settles_like_any_other_payment() {
    let (mut w, id) = council_claim();
    read(&mut w, id, "Approved");
    assert_eq!(status(&w, id), ClaimStatus::Settling);
    w.now += SETTLE_SECS + 1;
    read(&mut w, id, "Approved");
    assert_eq!(status(&w, id), ClaimStatus::Paid);
}

#[test]
fn a_silent_council_waits_until_its_window_ends() {
    let (mut w, id) = council_claim();
    assert!(read(&mut w, id, "InProgress").is_none());
    assert_eq!(status(&w, id), ClaimStatus::CouncilVote);
}

#[test]
fn a_silent_council_is_finalised_after_its_window() {
    let (mut w, id) = council_claim();
    w.now += COUNCIL_WINDOW + 1;
    assert!(
        read(&mut w, id, "InProgress").is_some(),
        "a Finalize should follow"
    );
    read(&mut w, id, "Expired");
    assert_eq!(status(&w, id), ClaimStatus::Rejected);
    assert_eq!(w.c.get_fund().cycle_committed.0, 0);
}

#[test]
fn a_filing_that_never_came_back_can_be_retried() {
    let (mut w, id) = reviewed(250 * USD, "supported", false);
    let panel = panel_of(&w, id);
    for voter in &panel[..2] {
        w.at(voter.clone());
        w.c.panel_vote(id, true);
    }
    w.at(acc("anyone.testnet"));
    w.c.advance(id);
    w.now += IN_FLIGHT_SECS + 1;
    w.at(acc("anyone.testnet"));
    assert!(w.c.advance(id).is_none());
    assert_eq!(status(&w, id), ClaimStatus::Approved);
}

#[test]
fn a_vetoed_filing_that_never_came_back_stays_with_the_council() {
    let (mut w, id) = reviewed(90 * USD, "supported", false);
    w.at(guardian());
    w.c.veto(id);
    w.at(acc("anyone.testnet"));
    w.c.advance(id);
    w.now += IN_FLIGHT_SECS + 1;
    w.at(acc("anyone.testnet"));
    w.c.advance(id);
    assert_eq!(
        status(&w, id),
        ClaimStatus::NeedsCouncil,
        "a veto must not turn into an approval"
    );
}

#[test]
#[should_panic(expected = "still in flight")]
fn a_filing_is_left_alone_while_it_may_still_return() {
    let (mut w, id) = reviewed(250 * USD, "supported", false);
    let panel = panel_of(&w, id);
    for voter in &panel[..2] {
        w.at(voter.clone());
        w.c.panel_vote(id, true);
    }
    w.at(acc("anyone.testnet"));
    w.c.advance(id);
    w.c.advance(id);
}

#[test]
#[should_panic(expected = "nothing left to do")]
fn a_finished_claim_cannot_advance() {
    let (mut w, id) = voted_claim();
    read(&mut w, id, "Rejected");
    w.at(acc("anyone.testnet"));
    w.c.advance(id);
}

// ---------- Governance ----------

#[test]
#[should_panic(expected = "Only the DAO")]
fn only_the_dao_pins_the_clerk() {
    let (mut w, _, _) = filed_claim(90 * USD);
    w.at(acc("mallory.testnet"));
    w.c.set_reviewer(
        "00".repeat(32),
        "00".repeat(32),
        "x".to_string(),
        "00".repeat(32),
    );
}

#[test]
#[should_panic(expected = "Only the DAO or its registrar")]
fn strangers_cannot_admit_members() {
    let mut w = World::new();
    w.at(acc("mallory.testnet"));
    w.c.admit(acc("mallory.testnet"), 100, None);
}

#[test]
#[should_panic(expected = "Only the DAO")]
fn a_guardian_can_pause_but_not_resume() {
    let mut w = World::new();
    w.at(guardian());
    w.c.pause();
    w.c.resume();
}

#[test]
#[should_panic(expected = "fixed once a fund starts")]
fn a_period_length_cannot_be_changed_later() {
    let mut w = World::new();
    w.at(dao());
    let mut r = rules();
    r.period_secs = 60;
    w.c.set_rules(r);
}

#[test]
#[should_panic(expected = "Tier 0 is the waiting period")]
fn tier_zero_never_has_cover() {
    let mut r = rules();
    r.tiers[0].cap = U128(USD);
    set_ctx(dao(), T0);
    Contract::new(dao(), token(), r, vec![], None);
}

#[test]
#[should_panic(expected = "yearly limit cannot be below")]
fn a_yearly_limit_must_cover_at_least_one_claim() {
    let mut r = rules();
    r.tiers[2].year_cap = U128(USD);
    set_ctx(dao(), T0);
    Contract::new(dao(), token(), r, vec![], None);
}

// ---------- A golden fixture from the browser's own code ----------
// Written by web/scripts/make-fixtures.mjs. If either side changes, this fails.

#[test]
fn a_proof_from_the_browser_prover_passes_the_contract() {
    let g: Value = near_sdk::serde_json::from_str(include_str!("golden.json")).unwrap();
    let c = &g["claim"];
    let text = |k: &str| c[k].as_str().unwrap().to_string();
    let mut w = World::new();
    let account = acc("rosa.testnet");
    w.at(dao());
    w.c.admit(account.clone(), 7, Some(text("commitment")));
    w.at(token());
    let _ =
        w.c.ft_on_transfer(account, U128(10 * USD), "dues".to_string());
    assert_eq!(
        w.c.get_fund().root,
        text("root"),
        "the browser and the contract disagree on the tree"
    );
    w.at(acc("relay.testnet"));
    let id = w.c.file_claim(
        text("proof"),
        text("root"),
        c["period"].as_u64().unwrap(),
        c["min_tier"].as_u64().unwrap() as u8,
        text("nullifier"),
        U128(text("amount").parse().unwrap()),
        acc(&text("payout")),
        text("evidence_sha256"),
    );
    assert_eq!(id.0, 0);
}

// ---------- Display helpers ----------

#[test]
fn amounts_read_as_money_in_the_case_file() {
    assert_eq!(review::display_amount(300 * USD, 6), "300.00");
    assert_eq!(review::display_amount(12_345_000, 6), "12.34");
    // 2026-11-07T12:00:00Z
    let ns = 1_794_052_800 * NS_PER_SEC;
    assert_eq!(
        review::case_file(4, 300 * USD, 6, ns, "abcd"),
        "{\"claim\":\"4\",\"amount\":\"300.00\",\"date\":\"2026-11-07\",\"nonce\":\"abcd\"}"
    );
}

#[test]
fn dates_land_on_the_right_day() {
    assert_eq!(review::date_string(0), "1970-01-01");
    assert_eq!(review::date_string(951_782_400 * NS_PER_SEC), "2000-02-29");
    assert_eq!(
        review::date_string(1_767_225_600 * NS_PER_SEC),
        "2026-01-01"
    );
    assert_eq!(
        review::date_string(1_798_761_599 * NS_PER_SEC),
        "2026-12-31"
    );
}
