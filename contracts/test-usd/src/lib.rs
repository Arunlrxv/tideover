//! A worthless testnet dollar: standard NEP-141 with 6 decimals and an open faucet.
#![allow(deprecated)]

use near_contract_standards::{
    fungible_token::{
        metadata::{FungibleTokenMetadata, FT_METADATA_SPEC},
        FungibleToken,
    },
    storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement},
};
use near_sdk::{json_types::U128, near, AccountId, PanicOnDefault};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TestUsd {
    token: FungibleToken,
}

#[near]
impl TestUsd {
    #[init]
    pub fn new() -> Self {
        TestUsd {
            token: FungibleToken::new(b"t".to_vec()),
        }
    }

    /// Open faucet. This token has no value.
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        if !self.token.accounts.contains_key(&account_id) {
            self.token.internal_register_account(&account_id);
        }
        self.token.internal_deposit(&account_id, amount.0);
    }

    #[payable]
    pub fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }

    pub fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    pub fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Tideover test dollar".to_string(),
            symbol: "tUSD".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }
}

near_contract_standards::impl_fungible_token_core!(TestUsd, token);
