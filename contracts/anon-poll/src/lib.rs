//! A secret ballot for any NEAR group.
//!
//! Sputnik DAO votes are public, which invites herd voting and pressure. This is
//! the smallest useful thing `tideover-zk` can do besides a hardship fund: an owner
//! (usually a DAO) registers its members, and each member can vote once in a poll
//! without anyone seeing how they voted. Counts are public, and so is the fact that
//! every vote came from a member.
//!
//! It reuses the fund's circuit and keys unchanged:
//! - `scope` is the poll, so one member gets one nullifier per poll;
//! - `signal` is the choice, so nobody relaying a vote can change it;
//! - `period` and `tier` are fixed at 0, as polls have no use for them.
//!
//! This is an example, and its tests are its documentation. A fund's tags work the
//! same way, with a longer window.

use near_sdk::json_types::U64;
use near_sdk::store::{LookupSet, Vector};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};
use tideover_zk::{
    encoding::{bytes_to_fr, fr_from_bytes, fr_to_bytes},
    identity,
    tree::Frontier,
    Fr,
};

// The same on-chain verifier as the fund.
#[path = "../../fund/src/groth16.rs"]
mod groth16;

const MEMBERSHIP_VK: &[u8] = include_bytes!("../../../keys/membership.vk.near");
const MAX_CHOICES: usize = 8;

#[derive(BorshStorageKey)]
#[near(serializers = [borsh])]
enum StorageKey {
    Polls,
    Spent,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Poll {
    pub question: String,
    pub choices: Vec<String>,
    pub tally: Vec<u32>,
    pub closes_at: U64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct AnonPoll {
    owner: AccountId,
    tree: Frontier,
    polls: Vector<Poll>,
    spent: LookupSet<[u8; 32]>,
}

#[near]
impl AnonPoll {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            owner,
            tree: Frontier::new(),
            polls: Vector::new(StorageKey::Polls),
            spent: LookupSet::new(StorageKey::Spent),
        }
    }

    /// Adds a member's public commitment. Their account is not stored.
    pub fn add_member(&mut self, commitment: String) -> u64 {
        self.only_owner();
        let commitment = field(&commitment, "commitment");
        self.tree.insert(identity::leaf(commitment, 0, 0))
    }

    pub fn open_poll(&mut self, question: String, choices: Vec<String>, seconds: u64) -> u32 {
        self.only_owner();
        require!(
            choices.len() >= 2 && choices.len() <= MAX_CHOICES,
            "A poll needs between 2 and 8 choices"
        );
        let tally = vec![0; choices.len()];
        self.polls.push(Poll {
            question,
            choices,
            tally,
            closes_at: U64(env::block_timestamp() + seconds * 1_000_000_000),
        });
        self.polls.len() - 1
    }

    /// Anyone can submit a ballot, so a member need not reveal who they are by
    /// paying for gas: the proof is what authorises it.
    pub fn vote(&mut self, poll_id: u32, choice: u32, proof: String, nullifier: String) {
        let mut poll = self.poll_of(poll_id);
        require!(
            env::block_timestamp() < poll.closes_at.0,
            "This poll has closed"
        );
        require!((choice as usize) < poll.choices.len(), "Unknown choice");

        // Strict decoding: a non-canonical value could otherwise vote twice.
        let nullifier = fr_to_bytes(&field(&nullifier, "nullifier"));
        require!(
            !self.spent.contains(&nullifier),
            "This member has already voted"
        );

        let inputs = [
            self.tree.root,
            fr_to_bytes(&Fr::from(0u64)),
            fr_to_bytes(&Fr::from(0u64)),
            fr_to_bytes(&poll_scope(poll_id)),
            nullifier,
            fr_to_bytes(&ballot_signal(poll_id, choice)),
        ];
        let proof = hex::decode(&proof).unwrap_or_else(|_| env::panic_str("proof is not hex"));
        match groth16::verify(MEMBERSHIP_VK, &proof, &inputs) {
            Some(true) => {}
            _ => env::panic_str("The ballot proof does not verify"),
        }
        self.spent.insert(nullifier);
        poll.tally[choice as usize] += 1;
        self.polls.set(poll_id, poll);
    }

    pub fn get_poll(&self, poll_id: u32) -> Option<Poll> {
        self.polls.get(poll_id).cloned()
    }

    pub fn get_root(&self) -> String {
        hex::encode(self.tree.root)
    }

    fn only_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner,
            "Only the owner can do this"
        );
    }

    fn poll_of(&self, poll_id: u32) -> Poll {
        self.polls
            .get(poll_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Unknown poll"))
    }
}

fn poll_scope(poll_id: u32) -> Fr {
    identity::scope(env::current_account_id().as_str(), poll_id as u64)
}

fn ballot_signal(poll_id: u32, choice: u32) -> Fr {
    let msg = format!("tideover/poll/v1\0{poll_id}\0{choice}");
    bytes_to_fr(msg.as_bytes())
}

fn field(value: &str, what: &str) -> Fr {
    hex::decode(value)
        .ok()
        .and_then(|b| <[u8; 32]>::try_from(b).ok())
        .and_then(|b| fr_from_bytes(&b))
        .unwrap_or_else(|| env::panic_str(&format!("{what} is not a field element")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ark_bls12_381::Bls12_381;
    use ark_groth16::ProvingKey;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;
    use std::sync::OnceLock;
    use tideover_zk::{circuit::MembershipCircuit, keys, near_encoding};

    fn pk() -> &'static ProvingKey<Bls12_381> {
        static K: OnceLock<ProvingKey<Bls12_381>> = OnceLock::new();
        K.get_or_init(|| {
            let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../keys/membership.pk");
            keys::pk_from_bytes(&std::fs::read(path).unwrap()).unwrap()
        })
    }

    fn ctx(who: &str) {
        let mut b = VMContextBuilder::new();
        b.current_account_id("poll.testnet".parse().unwrap())
            .predecessor_account_id(who.parse().unwrap())
            .block_timestamp(1_000_000_000);
        testing_env!(b.build());
    }

    struct Ballot {
        proof: String,
        nullifier: String,
    }

    fn cast(secrets: &[Fr], who: usize, poll_id: u32, choice: u32) -> Ballot {
        let leaves: Vec<Fr> = secrets
            .iter()
            .map(|s| identity::leaf(identity::commitment(*s), 0, 0))
            .collect();
        let circuit = MembershipCircuit::from_leaves(
            secrets[who],
            0,
            0,
            0,
            poll_scope(poll_id),
            ballot_signal(poll_id, choice),
            &leaves,
            who as u64,
        );
        let nullifier = hex::encode(fr_to_bytes(&circuit.public.nullifier));
        let proof = keys::prove(pk(), circuit, [8u8; 32]);
        Ballot {
            proof: hex::encode(near_encoding::proof_bytes(&proof)),
            nullifier,
        }
    }

    fn poll_with_members() -> (AnonPoll, Vec<Fr>) {
        ctx("dao.testnet");
        let mut c = AnonPoll::new("dao.testnet".parse().unwrap());
        let secrets: Vec<Fr> = (1..=4u64).map(|i| Fr::from(i * 31 + 5)).collect();
        for s in &secrets {
            c.add_member(hex::encode(fr_to_bytes(&identity::commitment(*s))));
        }
        c.open_poll(
            "Fund the meetup?".to_string(),
            vec!["Yes".to_string(), "No".to_string()],
            3600,
        );
        (c, secrets)
    }

    #[test]
    fn members_vote_and_only_the_count_is_public() {
        let (mut c, secrets) = poll_with_members();
        for (who, choice) in [(0, 0), (1, 1), (2, 0)] {
            let b = cast(&secrets, who, 0, choice);
            ctx("any-relay.testnet");
            c.vote(0, choice, b.proof, b.nullifier);
        }
        assert_eq!(c.get_poll(0).unwrap().tally, vec![2, 1]);
    }

    #[test]
    #[should_panic(expected = "already voted")]
    fn one_member_one_vote() {
        let (mut c, secrets) = poll_with_members();
        let b = cast(&secrets, 1, 0, 0);
        let again = cast(&secrets, 1, 0, 1);
        ctx("any-relay.testnet");
        c.vote(0, 0, b.proof, b.nullifier);
        c.vote(0, 1, again.proof, again.nullifier);
    }

    #[test]
    #[should_panic(expected = "does not verify")]
    fn a_relay_cannot_flip_a_vote() {
        let (mut c, secrets) = poll_with_members();
        let b = cast(&secrets, 1, 0, 0);
        ctx("any-relay.testnet");
        c.vote(0, 1, b.proof, b.nullifier);
    }

    #[test]
    #[should_panic(expected = "does not verify")]
    fn outsiders_cannot_vote() {
        let (mut c, mut secrets) = poll_with_members();
        ctx("poll.testnet");
        secrets[2] = Fr::from(99u64);
        let b = cast(&secrets, 2, 0, 0);
        ctx("any-relay.testnet");
        c.vote(0, 0, b.proof, b.nullifier);
    }

    #[test]
    fn a_member_can_vote_in_each_poll() {
        let (mut c, secrets) = poll_with_members();
        ctx("dao.testnet");
        c.open_poll(
            "Second poll?".to_string(),
            vec!["A".to_string(), "B".to_string()],
            3600,
        );
        for poll in [0u32, 1] {
            let b = cast(&secrets, 3, poll, 0);
            ctx("any-relay.testnet");
            c.vote(poll, 0, b.proof, b.nullifier);
        }
        assert_eq!(c.get_poll(1).unwrap().tally, vec![1, 0]);
    }
}
