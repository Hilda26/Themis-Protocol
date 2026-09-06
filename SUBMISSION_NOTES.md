Themis is reusable GenLayer infrastructure for AI-consensus dispute resolution and attestation.
Any app registers, writes its dispute rules in plain English, defines which verdicts a panel may
return and how settlement works, and opens cases against that template. Validator consensus reads
the case and issues a verdict; either party may contest it once. The same protocol serves a
marketplace's buyer/seller disputes, a DAO's grant milestone claims, a game's moderation appeals,
or a pure attestation with no money at stake at all.

It is a deliberately hardened rebuild of an existing reference design in this space, and it
exists to close two gaps in that design that are how an adversarial party actually wins a dispute
it should lose. First, the reference fetches every evidence URL live at verdict time and live
AGAIN at appeal time - so a party can pin an innocuous page, let the other side answer it, then
edit it before the appeal re-reads it. Themis fetches, renders to text, defangs and SHA-256
hashes each URL once, in the submitting transaction, and both judging paths read only that
record. Second, the reference concatenates party-authored statements straight into the judging
prompt, so a party can type a counterfeit "recorded evidence" block into their own statement.
Themis defangs the fence sequence out of every party string and every fetched excerpt using
ASCII-only substitutes, and tells the panel that fenced text is untrusted quoted content.

Three further bugs were found and fixed that no mocked test could have surfaced, and both are
documented rather than quietly patched. Consensus could never finalize: an early revision
compared seven independently-generated fields for strict equality, including free-text reason
codes, so rounds returned UNDETERMINED (status 6) and committed nothing - while the standard
test helper still reported success, because it inspects only the leader receipt. And the record
captured no readable content: evidence was stored as the first 1500 bytes of the raw HTTP body,
which for any real page is head boilerplate, so every panel correctly but uselessly ruled
insufficient_evidence. That one was caught by reading a real verdict's own words - it said the
snapshot was "a truncated Wikipedia HTML page with no readable licence text". And the judging
model could veto a party's right to appeal: appeal availability was ANDed with the model's own
opinion, so on confident verdicts the losing side lost its recourse precisely when it most wanted
it, and the appeal path was unreachable in practice. Recourse now follows the app's policy and
the contract's structural bounds, never the model's view.

Every lesson from this author's prior GenLayer review cycles is applied from the first
submission: checks-effects-interactions (state flips terminal before any transfer, proven by a
test that makes the payout function itself observe case state mid-call), failure never settles,
settlement bands snapped inside the consensus block so validators agree on exactly the number the
payout reads, and liveness exits for every way this shape can stall - including a permissionless
escape hatch for a case whose app owner vanished, resolving conservatively as an even
unadjudicated split so escrow can never be stranded.

Measured results: lint clean (32 methods, 14 view / 18 write), source verified pure ASCII.
38/38 direct tests passing, including three adversarial tests that actually attack the injection
defence. Three real StudioNet integration suites, all reaching consensus on the first attempt and
all asserting on the consensus status rather than the leader receipt - including one that runs
the full lifecycle through appeal and a real escrow payout on-chain (1000 wei escrowed, appeal
filed and reviewed, settlement ACCEPTED, second claim rejected).
Together they prove both halves of the guarantee: against irrelevant evidence the panel refused
to invent a winner ("Both submitted evidence snapshots are irrelevant Wikipedia pages... so the
case cannot be decided on the record"), and against evidence that genuinely substantiates the
question it decided correctly - respondent_wins, 0/10000, confidence 88, reasoning that "CC BY-SA
does not include the NonCommercial restriction... commercial reuse is permitted when attribution
is given and the derivative is released under the same terms, both of which respondent
satisfied."

How to use it: connect a wallet, register an app, define a template with your own rules, then
open a case naming a respondent. Fund it to open the evidence window, submit evidence (each URL
is fetched and hashed on the spot), close evidence, and trigger the panel - a real multi-minute
consensus round against the recorded dossier.

Live app: https://themis-protocol.vercel.app
Source: https://github.com/Hilda26/Themis-Protocol
Contract (StudioNet): 0xC8b0dfc458731b84a671A051B8E5fF1972702153
Full design rationale: DECISION_RECORD.md
Contract test/deploy detail: CONTRACT_STATUS.md
