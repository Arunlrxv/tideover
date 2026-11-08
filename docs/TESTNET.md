# On NEAR testnet

Everything here ran for real on 8 November 2026. All accounts and transactions can be checked on [NearBlocks](https://testnet.nearblocks.io).

## What is live

| What | Account |
|---|---|
| DAO, a real Sputnik DAO that holds the money | [`harbor-mutual.sputnikv2.testnet`](https://testnet.nearblocks.io/address/harbor-mutual.sputnikv2.testnet) |
| Fund contract, with no access keys | [`harbor.funds.tideover-hq.testnet`](https://testnet.nearblocks.io/address/harbor.funds.tideover-hq.testnet) |
| Test dollars | [`usd.tideover-hq.testnet`](https://testnet.nearblocks.io/address/usd.tideover-hq.testnet) |

The whole deployment cost about 11.6 test NEAR, nearly all of it locked as contract storage.

## Claims paid through the DAO

| Claim | Amount | Path | Result |
|---|---|---|---|
| #0 | $85 | Automatic, after a veto window | Paid by DAO proposal #2 |
| #1 | $250 | Three random members, two approved | Paid by DAO proposal #3 |
| #3 | $600 | Normal DAO proposal, council vote | Paid by DAO proposal #4 |
| #4 | $85 | Automatic, filed through the real app, read by the real model | Paid by DAO proposal #5 |

Each payout's token balance was checked after payment, and so was the DAO's for #0, #1 and #3. Claim #2 ($50) is the honest claim from the attack run below, and it never got a card.

Claim #4 is the full path: a new member joined from the browser with no wallet, paid dues with no gas, proved membership in the browser in 2.8 seconds, and filed through the relay. The real model then read the sealed document, and the contract checked the clerk's signature on the card. The page's own re-check then confirmed the proof and the signature in the browser.

Claims #0 and #1 used a fixed test card, signed with the demo clerk's key, to avoid spending AI credits. Claim #3 had no card, on purpose, to show the fallback to people.

| Transaction | Hash |
|---|---|
| Claim #0 filed | [`4J8cnFd3…`](https://testnet.nearblocks.io/txns/4J8cnFd3KCq4sH4ciosn9A7owdx93XPbcoFCqCzoejbp) |
| Claim #0 card posted | [`6zarRjoY…`](https://testnet.nearblocks.io/txns/6zarRjoYmUKnYkkSsAUk3sCPqDeVyec4nPxyo49A2xeB) |
| Claim #1 filed | [`7zXE4FSA…`](https://testnet.nearblocks.io/txns/7zXE4FSALLDH4xtdUS3bPZyUVY2J6qMxzvaT47utDkr3) |
| Claim #1 card posted | [`FLY2SPrZ…`](https://testnet.nearblocks.io/txns/FLY2SPrZK433e7k3LAF8LF8VgivZXAGnzBKaRCALxpXx) |
| Claim #1 confirmed paid | [`9iXQ7KYw…`](https://testnet.nearblocks.io/txns/9iXQ7KYwetY8rwuy726n1Hw9oC5TydM5QKB4yEFYhh5V) |

## Attacks the live contract refused

All 11 are in [e2e-testnet-attacks.json](e2e-testnet-attacks.json): raising the amount past the cover, changing it within the cover, redirecting the payout, paying the DAO itself, a made-up member list, claiming twice in a cycle, a stranger voting on a panel, a forged card, pinning a clerk without the DAO, and the relay voting on the DAO's proposals. The eleventh check is that the honest version of the same claim is accepted.

## Gas

| Action | Gas |
|---|---|
| Filing a claim, including the proof check | 24.4 Tgas |
| Posting a card | 2.9 to 3.8 Tgas |
| Paying dues, through the relay | 45.8 Tgas |

At testnet's gas price, 1 Tgas costs 0.0001 NEAR.

## What has not been done on chain

- **The enclave clerk.** The clerk that read claim #4 ran on the demo's server, and the Trust page says so.
- **The factory.** The demo fund was created directly, to save test NEAR, the way the factory does it. The factory's tests pass, but it isn't deployed, so the Install page can't run its proposals yet.
- **Trezu.** The demo DAO has not been opened in Trezu.
