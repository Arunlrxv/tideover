//! Creates a fund for any Sputnik DAO.
//!
//! A DAO calls `create_fund` through an ordinary FunctionCall proposal and gets
//! `name.<factory>`, a named account running the fund contract. The new account
//! has no access keys, so nobody, the factory included, can change its code. The
//! DAO then adds that account to a role with a second ordinary proposal. That is
//! the whole install, and one proposal removing the role undoes it.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{json, Value};
use near_sdk::store::Vector;
use near_sdk::{
    env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    PromiseOrValue,
};

const CODE_KEY: &[u8] = b"code";
const GAS_INIT: Gas = Gas::from_tgas(30);
const GAS_CALLBACK: Gas = Gas::from_tgas(15);
const GAS_FAIL: Gas = Gas::from_tgas(3);
/// Kept in the fund on top of its code storage, for bonds and records.
const MIN_WORKING_NEAR: u128 = NearToken::from_near(1).as_yoctonear();

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct FundRecord {
    pub account: AccountId,
    pub dao: AccountId,
    pub created_by: AccountId,
    pub created_at: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    owner: AccountId,
    funds: Vector<FundRecord>,
}

#[near]
impl Factory {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            owner,
            funds: Vector::new(b"f"),
        }
    }

    /// Stores the fund contract. The raw wasm is the call's input.
    pub fn set_code(&mut self) {
        require!(
            env::predecessor_account_id() == self.owner,
            "Only the owner can set the code"
        );
        let code = env::input().unwrap_or_else(|| env::panic_str("No code in the input"));
        env::storage_write(CODE_KEY, &code);
        env::log_str(&format!(
            "fund code set: {} bytes, sha256 {}",
            code.len(),
            near_sdk::bs58::encode(env::sha256(&code)).into_string()
        ));
    }

    /// The NEAR a new fund needs: its code storage plus a working balance.
    pub fn required_deposit(&self) -> U128 {
        let code = env::storage_read(CODE_KEY).unwrap_or_default();
        U128(fund_cost(code.len()))
    }

    pub fn list_funds(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<FundRecord> {
        self.funds
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(200) as usize)
            .cloned()
            .collect()
    }

    /// Only the DAO can create its own fund. Otherwise anyone could read the name out
    /// of a pending proposal and create that fund first, with rules of their own, and
    /// the DAO would then grant its role to the attacker's fund.
    ///
    /// `rules` is passed to the fund as given; the fund validates it on init, and a
    /// bad value refunds the deposit and fails the proposal.
    #[payable]
    pub fn create_fund(
        &mut self,
        name: String,
        dao: AccountId,
        token: AccountId,
        rules: Value,
        guardians: Vec<AccountId>,
        registrar: Option<AccountId>,
    ) -> Promise {
        require!(
            env::predecessor_account_id() == dao,
            "Only the DAO can create its own fund"
        );
        require!(
            !name.is_empty() && !name.contains('.'),
            "A fund name is a single account label"
        );
        let account: AccountId = format!("{name}.{}", env::current_account_id())
            .parse()
            .unwrap_or_else(|_| env::panic_str("Not a valid account name"));
        let code =
            env::storage_read(CODE_KEY).unwrap_or_else(|| env::panic_str("No fund code yet"));
        let deposit = env::attached_deposit();
        require!(
            deposit.as_yoctonear() >= fund_cost(code.len()),
            format!("Attach at least {} yoctoNEAR", fund_cost(code.len()))
        );
        let args = json!({
            "dao": dao,
            "token": token,
            "rules": rules,
            "guardians": guardians,
            "registrar": registrar,
        });
        let creator = env::predecessor_account_id();
        Promise::new(account.clone())
            .create_account()
            .transfer(deposit)
            .deploy_contract(code)
            .function_call(
                "new".to_string(),
                args.to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_INIT,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_fund_created(account, dao, creator, U128(deposit.as_yoctonear())),
            )
    }

    /// On failure NEAR refunds the deposit to this contract, which passes it back,
    /// and the call then fails, so a DAO's proposal does not read as a success when
    /// no fund exists.
    #[private]
    pub fn on_fund_created(
        &mut self,
        account: AccountId,
        dao: AccountId,
        creator: AccountId,
        deposit: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> PromiseOrValue<AccountId> {
        if result.is_err() {
            env::log_str(&format!("could not create {account}; refunding {creator}"));
            return PromiseOrValue::Promise(
                Promise::new(creator)
                    .transfer(NearToken::from_yoctonear(deposit.0))
                    .then(
                        Self::ext(env::current_account_id())
                            .with_static_gas(GAS_FAIL)
                            .fail_creation(account),
                    ),
            );
        }
        self.funds.push(FundRecord {
            account: account.clone(),
            dao,
            created_by: creator,
            created_at: env::block_timestamp(),
        });
        env::log_str(&format!("fund created: {account}"));
        PromiseOrValue::Value(account)
    }

    #[private]
    pub fn fail_creation(&mut self, account: AccountId) {
        env::panic_str(&format!("{account} could not be created"));
    }
}

fn fund_cost(code_len: usize) -> u128 {
    // The account also stores state, so round the code size up by a tenth.
    let bytes = code_len as u128 * 11 / 10;
    env::storage_byte_cost().as_yoctonear() * bytes + MIN_WORKING_NEAR
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn ctx(who: &str, deposit: NearToken) {
        let mut b = VMContextBuilder::new();
        b.current_account_id("funds.testnet".parse().unwrap())
            .predecessor_account_id(who.parse().unwrap())
            .attached_deposit(deposit);
        testing_env!(b.build());
    }

    fn create_as(who: &str) {
        let mut f = Factory::new("owner.testnet".parse().unwrap());
        env::storage_write(CODE_KEY, &[0u8; 100]);
        ctx(who, NearToken::from_near(10));
        f.create_fund(
            "harbor".to_string(),
            "harbor.sputnikv2.testnet".parse().unwrap(),
            "usd.testnet".parse().unwrap(),
            json!({}),
            vec![],
            None,
        )
        .detach();
    }

    #[test]
    fn a_dao_can_create_its_own_fund() {
        ctx("owner.testnet", NearToken::from_near(0));
        create_as("harbor.sputnikv2.testnet");
    }

    #[test]
    #[should_panic(expected = "Only the DAO can create its own fund")]
    fn nobody_else_can_create_a_fund_for_a_dao() {
        ctx("owner.testnet", NearToken::from_near(0));
        create_as("attacker.testnet");
    }
}
