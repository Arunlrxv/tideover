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
| Sealed reader | NEAR AI model in an enclave | Reading a document without leaking it |
| Relay | `web/src/app/api` | Nothing except liveness. It sees ciphertext and proofs. |

## A claim, step by step

1. **Dues.** `ft_transfer_call` reaches `ft_on_transfer`, which forwards the money to the DAO and appends `leaf = H(commitment, period, tier)` to a Poseidon Merkle tree of depth 16.
2. **Seal.** The browser encrypts the document to the enclave key the DAO pinned, and hashes the ciphertext.
3. **Prove.** The browser proves it knows the secret behind a leaf for this or last period, at `tier >= min_tier`. Public inputs are `root, period, min_tier, scope, nullifier, signal`.
   - `signal` hashes the fund, amount, payout and evidence hash, so a relay cannot change them.
   - `nullifier = H(secret, scope)` with `scope = H(fund, window)`. It is the member's anonymous tag for the year.
   - The browser proves the lowest tier that covers the amount, which hides the member among more people.
4. **File.** Any account can submit `file_claim`, because the proof authorises it. The contract checks the tier's limits, the tag's history and the cycle budget, then verifies the proof through the NEP-488 host functions.
5. **Read.** The browser builds the request and the relay forwards it with the API key. The response is encrypted to a key made in the browser.
6. **Post.** Anyone can call `post_review`, because `review.rs` needs no trust in the caller. It checks:
   - the enclave key the DAO pinned signed `MODEL:sha256(request):sha256(response)`;
   - the request bytes rebuild exactly from the system message and the committed evidence;
   - the system message, opened with a key the contract derives itself, is the registered prompt plus this claim's case file;
   - the verdict is for this claim and nonce, and every field is in a closed set.
7. **Route.** `route_for` picks a path from the amount, the card and the tag's history.
8. **Pay.** The contract registers the payout address on the token, files a `Transfer` proposal, approves it through its role, reads the proposal back, and records the outcome from the DAO's own account of it.

## Why each check exists

- **The contract derives the system message's key itself.** XChaCha20-Poly1305 is not key-committing, so a crafted ciphertext could show the contract one prompt under a supplied key and the model another under the real one.
- **The verdict has closed fields.** Free text would be a channel out of the sealed document. A test passes a diagnosis in the category field and checks it is refused.
- **Evidence must be lowercase hex.** Otherwise it could break out of the JSON string the contract rebuilds, and carry a different prompt.
- **Nullifiers are decoded strictly.** A non-canonical encoding would otherwise count as a different member.
- **The reader can be down.** After the review window, `advance` routes the claim to people, so an outage cannot strand someone.
- **`advance` is permissionless.** No keeper is trusted, and any account can move a claim along once it is due.

## The yearly tag

The first version burned a nullifier per quarter. Simulating it showed one persistent cheat could take about 30% of a 40-member fund's dues: an anonymous claimant loses nothing, so they could claim the top limit every quarter.

Widening the nullifier's scope to a year fixes this without changing the circuit. One member's claims in a year now share a tag, so the contract can enforce a yearly limit, and a second claim in a year always reaches people. Panels see "this anonymous member already claimed $85 this year". The cost is that claims within a year can be linked to each other, though not to the member. The tag changes each year, so years do not link.

## Trust boundaries

| If this fails | Then |
|---|---|
| The relay is malicious | It can drop claims. It cannot read, change or fake them. |
| The model is fooled | The path changes, within the tier, yearly and auto limits. |
| The enclave is broken | Documents can be read, including old ciphertext on chain. Money rules still hold. |
| Someone holds the setup's toxic waste | They can forge membership proofs. This is why real funds need a ceremony. |
| A guardian is malicious | They can pause the fund or send claims to the council, and nothing more. |
| The DAO is malicious | It holds the treasury anyway. It cannot see who claimed. |

## Economics

The fund pays NEAR for proposal bonds, which return on approval, and for token registration and records. Anyone can top this up with `fund_bonds`. Dues never sit in the contract, and if a forward fails, `sweep` retries it.

## What is left out on purpose

- **Confidential treasuries.** Trezu and NEAR Business offer them, and a private balance would hide more. They run on a private shard and have no public integration surface yet, so this version uses a plain Sputnik DAO.
- **Removing a claimant from their own panel.** Nobody knows who they are, so the quorum is the defence.
- **Unmasking a fraudster.** Identity escrow would need threshold decryption in the circuit. It is the obvious next step if real funds need it.
