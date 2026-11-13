# On NEAR testnet

Everything here ran for real on 8 November 2026. All accounts and transactions can be checked on [NearBlocks](https://testnet.nearblocks.io).

## What is live

| What | Account |
|---|---|
| DAO, a real Sputnik DAO that holds the money | [`harbor-mutual.sputnikv2.testnet`](https://testnet.nearblocks.io/address/harbor-mutual.sputnikv2.testnet) |
| Fund contract, with no access keys | [`harbor.funds.tideover-hq.testnet`](https://testnet.nearblocks.io/address/harbor.funds.tideover-hq.testnet) |
| Test dollars | [`usd.tideover-hq.testnet`](https://testnet.nearblocks.io/address/usd.tideover-hq.testnet) |
| Factory, which creates a fund for any DAO | [`funds.tideover-hq.testnet`](https://testnet.nearblocks.io/address/funds.tideover-hq.testnet) |

The demo community cost about 11.6 test NEAR, nearly all of it locked as contract storage. The factory locks another 4.9.

## Claims paid through the DAO

| Claim | Amount | Path | Result |
|---|---|---|---|
| #0 | $85 | Automatic, after a veto window | Paid by DAO proposal #2 |
| #1 | $250 | Three random members, two approved | Paid by DAO proposal #3 |
| #3 | $600 | Normal DAO proposal, council vote | Paid by DAO proposal #4 |
| #4 | $85 | Automatic, filed through the real app, read by the real model, with the clerk on the demo's server | Paid by DAO proposal #5 |
| #5 | $85 | The same, with the clerk in OutLayer's enclave | Paid by DAO proposal #7 |
| #6 | $280 | Three random members, two approved, with the clerk in the enclave. Filmed for the demo video | Paid by DAO proposal #8 |

Each payout's token balance was checked after payment. The drop in the DAO's balance was also checked for #0, #3 and #5. Claim #2 ($50) is the honest claim from the attack run below, and it never got a card.

Claim #4 is the full path: a new member joined from the browser with no wallet, paid dues with no gas, proved membership in the browser in 2.8 seconds, and filed through the relay. The real model then read the sealed document, and the contract checked the clerk's signature on the card. The page's own re-check then confirmed the proof and the signature in the browser.

Claims #0 and #1 used a fixed test card, signed with the demo clerk's key, to avoid spending AI credits. Claim #3 had no card, on purpose, to show the fallback to people.

| Transaction | Hash |
|---|---|
| Claim #0 filed | [`4J8cnFd3…`](https://testnet.nearblocks.io/txns/4J8cnFd3KCq4sH4ciosn9A7owdx93XPbcoFCqCzoejbp) |
| Claim #0 card posted | [`6zarRjoY…`](https://testnet.nearblocks.io/txns/6zarRjoYmUKnYkkSsAUk3sCPqDeVyec4nPxyo49A2xeB) |
| Claim #1 filed | [`7zXE4FSA…`](https://testnet.nearblocks.io/txns/7zXE4FSALLDH4xtdUS3bPZyUVY2J6qMxzvaT47utDkr3) |
| Claim #1 card posted | [`FLY2SPrZ…`](https://testnet.nearblocks.io/txns/FLY2SPrZK433e7k3LAF8LF8VgivZXAGnzBKaRCALxpXx) |
| Claim #1 confirmed paid | [`9iXQ7KYw…`](https://testnet.nearblocks.io/txns/9iXQ7KYwetY8rwuy726n1Hw9oC5TydM5QKB4yEFYhh5V) |

## The clerk in an enclave

The DAO voted to pin the clerk's enclave build (proposal #6), and the demo's server no longer holds a clerk key.

Claim #5 then took the same path as claim #4. A new member joined in the browser, proved membership in 2.4 seconds and filed a sealed hospital bill. The clerk opened it inside [OutLayer](https://outlayer.ai)'s enclave, read it with the NEAR AI model and signed the card. The contract accepted that signature, and the page's own re-check confirmed it in the browser. The enclave run took about 10 seconds and cost 0.002 NEAR.

| What | Value |
|---|---|
| Build, sha256 | `410b38192e64034b45291cc204eaa3188d11ee525f02db528d9884713919fe2d` |
| Enclave run that printed the clerk's keys | [`7759njmD…`](https://testnet.nearblocks.io/txns/7759njmDNzD3wCiDitgLXjrms5NEiqGBi5UujogBrro6) |
| Claim #5 filed | [`BvJ31i4o…`](https://testnet.nearblocks.io/txns/BvJ31i4orS7K5fQ8z5RkyWtV3khwokSUeVWav43S4YXn) |
| Enclave run that read claim #5 | [`A9ZYpuEb…`](https://testnet.nearblocks.io/txns/A9ZYpuEbX2M16xKi1q6M4HZ4BZwGMd2VpCuDEW6gSXdg) |
| Claim #5 card posted | [`9BSekkmZ…`](https://testnet.nearblocks.io/txns/9BSekkmZpj3VEJaFsMKavRsCTBxRrjQmUsp6jvGKMTdM) |
| Claim #5 confirmed paid | [`JDvGhW47…`](https://testnet.nearblocks.io/txns/JDvGhW47sYXVuhzkWHg2bWM1EGYq5JyUyraCfKfhznCQ) |

OutLayer's public record names that build for both runs. The Trust page compares it with what the DAO pinned, and shows **In an enclave, attested**.

## Attacks the live contract refused

Ten attacks were refused, and the honest version of the same claim was accepted. All 11 checks are in [e2e-testnet-attacks.json](e2e-testnet-attacks.json). The attacks were: raising the amount past the cover, changing it within the cover, redirecting the payout, paying the DAO itself, a made-up member list, claiming twice in a cycle, a stranger voting on a panel, a forged card, pinning a clerk without the DAO, and the relay voting on the DAO's proposals.

## The factory

The factory is deployed ([`65WoVRij…`](https://testnet.nearblocks.io/txns/65WoVRij4udtzqGNcSyWJEmSKyGXuFcb2unq4dJp2m7r)) and holds the fund code ([`9pLsAoNf…`](https://testnet.nearblocks.io/txns/9pLsAoNfs6BrsM6CmF7qRNhsPT1FLLygja9Wg1NWin6W)). That code has the same sha256 as the live demo fund, `4EBc1Gf3mX5LjVKb5wojMh7c1ikBA92AowQpMa2JrNJY`.

It refused a caller creating a fund for someone else's DAO, and a deposit below the 4.74 NEAR a new fund needs. The Install page reads that price from it.

## Gas

| Action | Gas |
|---|---|
| Filing a claim, including the proof check | 24.4 Tgas |
| Posting a card | 2.9 to 3.8 Tgas |
| Paying dues, through the relay | 45.8 Tgas |

At testnet's gas price, 1 Tgas costs 0.0001 NEAR.

## What has not been done on chain

- **Checking the enclave's Intel quote directly.** The Trust page reads OutLayer's public record of each run. `outlayer-verify tx <hash>` checks the quote behind it, and it has not been run.
- **A fund created through the factory.** That locks 4.74 test NEAR, so the demo fund was created directly instead: same account name, same code, no keys, and the same 30 Tgas for its setup.
- **Trezu.** The demo DAO has not been opened in Trezu.
