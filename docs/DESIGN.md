# Design

## The tension

A hardship fund has to be auditable, because it holds other people's money. The people it helps must not be exposed, because the reason for a payment is often the most private fact of their year. A public DAO gives you the first and destroys the second. A private spreadsheet does the reverse.

Tideover splits the record in two. **Whether the rules were followed** is public and checkable. **Who claimed and why** never reaches the chain in readable form.

## Parts

| Part | Where | Trusted for |
|---|---|---|
| Sputnik DAO | Existing contract | Custody, council votes |
| Fund contract | `contracts/fund` | Every rule. It has no access keys after creation. |
| Factory | `contracts/factory` | Creating a keyless fund for a DAO |
| Membership proof | `crates/tideover-zk` | Hiding which member claimed |
| Sealed clerk | `clerk/`, in an OutLayer enclave | Holding the key that opens documents, and answering only in closed fields |
| Model | NEAR AI private inference | Reading the document the clerk passes it |
| Relay | `web/src/app/api` | Nothing except liveness. It sees ciphertext and proofs. |

## A claim, step by step

1. **Dues.** `ft_transfer_call` reaches `ft_on_transfer`, which forwards the money to the DAO and appends `leaf = H(commitment, period, tier)` to a Poseidon Merkle tree of depth 16.
2. **Seal.** The browser encrypts `{fund, amount, payout, document}` to the clerk's X25519 key, which the DAO pinned, and hashes the ciphertext.
3. **Prove.** The browser proves it knows the secret behind a leaf for this or last period, at `tier >= min_tier`. Public inputs are `root, period, min_tier, scope, nullifier, signal`.
   - `signal` hashes the fund, cycle, amount, payout and evidence hash, so a relay cannot change them, and a proof cannot be replayed into a later cycle.
   - `nullifier = H(secret, scope)` with `scope = H(fund, window)`. It is the member's anonymous tag for the year.
   - The browser proves the lowest tier that covers the amount, and last month's finished group unless this month's is already bigger. Both hide the member among more people.
4. **File.** Any account can submit `file_claim`, because the proof authorises it. The contract refuses a group smaller than `min_group`, verifies the proof through the NEP-488 host functions, and only then reads the tag's history and the cycle budget.
5. **Read.** The relay hands the clerk a claim number and the envelope, and nothing else. The clerk reads the claim from the fund contract, checks it is waiting for review and that the envelope matches its evidence hash, opens the envelope, checks the sealed amount and payout match the claim, and sends the contract's case file and the document to the model.
6. **Post.** Anyone can call `post_card`, because the clerk's signature covers the fund, claim, nonce, evidence hash, amount, payout and every field of the card. The contract rebuilds that text itself.
7. **Route.** `route_for` picks a path from the amount, the card and the tag's history.
8. **Pay.** The contract registers the payout address on the token, files a `Transfer` proposal, approves it through its role, and reads the proposal back. Sputnik says `Approved` before its transfer runs, in a separate receipt that can still fail, so the claim waits in `Settling` and the fund reads the proposal again before it marks anything `Paid`. If the transfer failed, `Finalize` retries the same proposal. One proposal carries a claim from start to finish, so a retry can never pay twice.

## The clerk

The obvious design encrypts a document straight to the model's attested key. It does not work on a shared model. The model decrypts whatever it is sent, for anyone holding an API key, and answers whatever that person asks. A ciphertext addressed to it would be readable by the whole world as soon as it was public.

So documents are encrypted to a clerk, 400 lines of Rust running in an OutLayer enclave:

- **Nobody knows its key.** `PROTECTED_CLERK_SEED` is generated inside the enclave and stored against the build's sha256. Only that exact code can read it, and the people who deployed it cannot.
- **Its prompt is compiled in.** The prompt's hash is part of the build, so changing it changes the build's hash, and that takes a DAO vote.
- **The caller chooses nothing but which claim to read.** Everything else comes from the fund contract. A caller who could write the case file could ask the model questions about someone's document, one closed answer at a time, and read the answers back.
- **One claim, one review.** The clerk refuses a claim that is not `AwaitingReview`, so a sealed document cannot be probed at a time of someone's choosing, and asking twice gets the same card.
- **It can reach two hosts.** The manifest allows NEAR AI and one NEAR RPC, it sits in the build, and OutLayer's worker enforces it.
- **It keeps nothing.** Each run reads one document, signs one card and ends.

The DAO pins the clerk's public keys and build hash with `set_reviewer`. OutLayer's public attestation for the run that printed those keys is the record of which build made them, and the Trust page compares the two.

Before a fund pins an enclave build, the same steps can run on a plain server, from `web/src/lib/clerk.mjs`. That server could read a document, so the fund records `server-demo` where the build hash would go, and the Trust page says so in red. Both clerks use the same keys, envelope and signed text, so one DAO vote moves a fund from one to the other.

## Why each check exists

- **The amount and payout are sealed with the document.** Otherwise anyone could copy a good document's ciphertext onto a claim paying themselves.
- **The card has closed fields.** Free text would be a channel out of the sealed document. A test passes a diagnosis in the category field and checks it is refused, on both the clerk and the contract.
- **A group has a minimum size.** A claim's period and tier are public, so proving a nearly empty group would name its member.
- **The proof comes before the history.** An invalid proof learns nothing about anyone's record.
- **The DAO cannot be the payout.** A transfer to itself always fails, and a failed proposal keeps its bond.
- **Only a DAO can create its own fund.** Otherwise anyone could read a name from a pending proposal, create that fund first with rules of their own, and receive the DAO's role. The Install page also checks the new fund belongs to the DAO before it shows proposal two.
- **Nullifiers are decoded strictly.** A non-canonical encoding would otherwise count as a different member.
- **The evidence hash is stored in canonical form.** Otherwise a relay's choice of letter case would stop the clerk's hash matching later.
- **The clerk can be down.** After the review window, `advance` routes the claim to people, so an outage cannot strand someone. Panelists are told that a missing card proves nothing, because a relay could also hold one back.
- **A council vote can't hang.** After the council window, the fund finalises an expired proposal and the claim ends.
- **`advance` is permissionless.** No keeper is trusted, and any account can move a claim along once it is due.

## The yearly tag

The first version burned a nullifier per quarter. Simulating it showed one persistent cheat could take about 30% of a 40-member fund's dues: an anonymous claimant loses nothing, so they could claim the top limit every quarter.

Widening the nullifier's scope to a year fixes this without changing the circuit. One member's claims in a year now share a tag, so the contract can enforce a yearly limit, and a second claim in a year always reaches people. Panels see "this anonymous member already claimed $85 this year". The cost is that claims within a year can be linked to each other, though not to the member. The tag changes each year, so years do not link.

## What a review changed

An independent review of the first version found no way to forge a proof or a signature, and nine other problems. All nine are fixed, each with a regression test.

| Severity | Finding | Fix |
|---|---|---|
| Critical | Anyone could create a DAO's fund first and receive its role | Only the DAO can call `create_fund` |
| High | A ciphertext addressed to a shared model is readable by anyone with an API key | The sealed clerk |
| High | `period` and `root` could shrink a member's crowd to almost nothing | `min_group`, and proving last month's group |
| High | A claim could be marked Paid when no money moved | `Settling`, `Finalize`, and no DAO payouts |
| Medium | A proof could be replayed into the next cycle | The cycle is in the signal |
| Medium | A claim could hang forever at the council | A council window that ends in `Finalize` |
| Low to medium | A claim could stick in `Paying` | A NEAR margin on filing, and timeouts on in-flight stages |
| Low | Letter case could break the evidence hash | Canonical storage |
| Low | A withheld verdict looked like a bad claim | Panels are told it proves nothing |

## Trust boundaries

| If this fails | Then |
|---|---|
| The relay is malicious | It can drop a claim or hold back a card, and the claim then goes to people. It cannot read, change or fake them. |
| The model is fooled | The path changes, within the tier, yearly and auto limits. |
| The clerk's enclave is broken | Documents can be read, including old ciphertext in public transactions. Money rules still hold. |
| NEAR AI's enclave or gateway is broken | Documents passing through can be read. The clerk reaches it over TLS and does not yet check its attestation itself. |
| The RPC the clerk reads lies | It could show the clerk a false case file. A card still fits only the real claim, but a false case file could put a question to the model. A light client would remove this. |
| Someone holds the setup's toxic waste | They can forge membership proofs. This is why real funds need a ceremony. |
| A guardian is malicious | They can pause the fund or send claims to the council, and nothing more. |
| The DAO is malicious | It holds the treasury anyway. It cannot see who claimed. |

## Economics

The fund pays NEAR for proposal bonds, which return on approval, and for token registration and records. Anyone can top this up with `fund_bonds`. Dues never sit in the contract, and if a forward fails, `sweep` retries it.

## What is left out on purpose

- **Confidential treasuries.** Trezu and NEAR Business offer them, and a private balance would hide more. They run on a private shard and have no public integration surface yet, so this version uses a plain Sputnik DAO.
- **Removing a claimant from their own panel.** Nobody knows who they are, so the quorum is the defence.
- **Unmasking a fraudster.** Identity escrow would need threshold decryption in the circuit. It is the obvious next step if real funds need it.
