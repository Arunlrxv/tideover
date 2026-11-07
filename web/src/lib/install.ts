// Builds the two ordinary proposals that install a fund on an existing Sputnik DAO.
import { D } from "./config";

const USD = 1_000_000n;
const usd = (n: bigint) => String(n * USD);

/** Sensible starting rules for a real community, with days rather than the demo's seconds. */
export function defaultRules(duesDollars: number, proposalBond: string, proposalPeriodNs: string) {
  const day = 24 * 3600;
  const proposalSecs = Number(BigInt(proposalPeriodNs) / 1_000_000_000n);
  return {
    dues: usd(BigInt(duesDollars)),
    period_secs: 30 * day,
    periods_per_cycle: 3,
    window_cycles: 4,
    min_group: 5,
    tiers: [
      { min_score: 0, cap: "0", year_cap: "0" },
      { min_score: 3, cap: usd(100n), year_cap: usd(200n) },
      { min_score: 6, cap: usd(300n), year_cap: usd(450n) },
      { min_score: 12, cap: usd(800n), year_cap: usd(800n) },
    ],
    auto_limit: usd(100n),
    panel_limit: usd(400n),
    cycle_budget: usd(1500n),
    panel_size: 3,
    panel_quorum: 2,
    review_window_secs: 3600,
    veto_window_secs: day,
    panel_window_secs: 3 * day,
    // A day past the DAO's own voting period, so the proposal has expired by then.
    council_window_secs: proposalSecs + day,
    proposal_bond: proposalBond,
    token_decimals: 6,
  };
}

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));

export type InstallInput = {
  dao: string;
  name: string;
  guardian: string;
  duesDollars: number;
  bond: string;
  proposalPeriod: string;
  deposit: string;
};

export const fundAccount = (name: string) => `${name}.${D.factory}`;

export function createFundProposal(i: InstallInput) {
  const args = {
    name: i.name,
    dao: i.dao,
    token: D.token,
    rules: defaultRules(i.duesDollars, i.bond, i.proposalPeriod),
    guardians: i.guardian ? [i.guardian] : [],
    registrar: null,
  };
  return {
    proposal: {
      description: "Install Tideover: create our fund, with its rules",
      kind: {
        FunctionCall: {
          receiver_id: D.factory,
          actions: [{ method_name: "create_fund", args: b64(JSON.stringify(args)), deposit: i.deposit, gas: "220000000000000" }],
        },
      },
    },
  };
}

export function roleProposal(name: string) {
  return {
    proposal: {
      description: "Install Tideover: give the fund a role limited to transfers",
      kind: {
        ChangePolicyAddOrUpdateRole: {
          role: {
            name: "tideover",
            kind: { Group: [fundAccount(name)] },
            permissions: ["transfer:AddProposal", "transfer:VoteApprove", "transfer:Finalize"],
            vote_policy: { transfer: { weight_kind: "RoleWeight", quorum: "0", threshold: [1, 1] } },
          },
        },
      },
    },
  };
}

/** A near-cli command that files a proposal. The caller signs it with their own key. */
export function cliCommand(dao: string, proposal: unknown, bond: string, signer: string) {
  const near = Number(BigInt(bond) / 10n ** 21n) / 1000;
  return `near contract call-function as-transaction ${dao} add_proposal json-args '${JSON.stringify(proposal)}' prepaid-gas '100 Tgas' attached-deposit '${near} NEAR' sign-as ${signer || "your-account.testnet"} network-config testnet`;
}
