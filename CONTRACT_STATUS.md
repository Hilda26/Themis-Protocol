# Themis - Contract Status

## v1 - initial submission

Themis is a hardened rebuild of an existing reference design for AI-consensus dispute
resolution. It closes two concrete gaps in that design, applies every lesson this author's prior
GenLayer review cycles taught, and fixes two further bugs that only a real deployment could
surface.

## The two gaps in the reference design that this project closes

1. **Evidence was re-fetched live at judgment time - twice.** The reference design fetches every
   evidence URL live at `request_verdict`, then live *again* at `request_appeal_review`. A party
   can pin a URL, wait out the first verdict, edit the page, and have the appeal panel read
   something different. Themis fetches, reduces to text, defangs and SHA-256 hashes each URL
   **once, in the submitting transaction** (`submit_evidence`, `file_appeal`), and both judging
   paths read only that stored record. This is the chain-of-custody discipline this author's
   CoverPool and Sigil review cycles established.
2. **Party-authored text reached the prompt unsanitised.** `case_summary`,
   `respondent_response`, evidence `statement`/`title` and appeal `statement` were concatenated
   directly into the judging prompt, so a party could type a counterfeit "recorded evidence"
   block into their own statement. Themis defangs the fence sequence (`<<<` / `>>>`) out of every
   party-authored string and every fetched excerpt before it is hashed, stored or assembled,
   using **ASCII-only** substitutes (`(((` / `)))`), and the prompt states that fenced text is
   untrusted quoted content and never an instruction.

## Two bugs only a real deployed run could surface

Both are recorded here deliberately, because each is evidence that the pipeline deploys and
exercises against real infrastructure before any status document is written.

### Consensus could never finalize (rounds silently returned UNDETERMINED)

An early revision compared seven independently-generated fields for strict equality between the
leader and each validator - including free-text `reason_code`, plus `confidence`,
`evidence_alignment`, `rule_fit` and `appeal_allowed`. Two honest validators running the same
prompt legitimately differ on all of those even when they agree completely on the decision, so
the round could essentially never reach agreement.

The symptom was subtle and nearly invisible:

- `request_verdict` returned transaction status **6 = UNDETERMINED**, not 5 = ACCEPTED.
- Nothing committed: the case stayed at `evidence_closed` and no verdict was recorded.
- `gltest.assertions.tx_execution_succeeded()` **still returned True**, because it inspects only
  the *leader* receipt's `execution_result` and never looks at the consensus status. A suite
  asserting on it alone reports a passing test over a round that decided nothing.

Fixed by judging on the decision alone. The equivalence principle now requires only: the same
disposition, the same `winner`, and - for decisive outcomes - an identical settlement band
(snapped inside the consensus block). `confidence`, `evidence_alignment`, `rule_fit`,
`appeal_allowed`, `reason_code` and `short_reason` are explicitly commentary and may never cause
disagreement on their own.

A second contributor was fixed alongside it: three semantically identical "cannot decide"
categories (`insufficient_evidence`, `unverifiable`, `manual_review_required`) let honest
validators scatter across synonyms on exactly the ambiguous cases where a clean fallback matters
most. The prompt now names `insufficient_evidence` as the single canonical non-decisive outcome,
and the equivalence principle treats all three as the same disposition.

The integration suite now asserts on the consensus status itself, and proves that an
UNDETERMINED round is safely retryable - it commits no state, leaves the case at
`evidence_closed`, and `request_verdict` is permissionless.

### The record captured no readable content

Evidence was stored as the first 1500 bytes of the raw HTTP body. For any real web page that is
doctype, meta and script tags - no readable content whatsoever. Every panel therefore ruled
`insufficient_evidence`, correctly but uselessly: a protocol that judges from the record is only
as good as what the record captures.

This was caught by reading a real verdict's own reasoning, which said the snapshot was
*"a truncated Wikipedia HTML page with no readable licence text"*. No mocked test could have
shown it, because mocks return tidy fixture strings rather than 400KB of real page boilerplate.

Fixed by fetching through `gl.nondet.web.render()` (readable page text rather than the raw byte
body), stripping any residual markup - script/style bodies dropped entirely, tags removed,
entities decoded, whitespace collapsed - and raising the caps to hold real article text
(8000 chars per URL, 30000 total). `test_recorded_evidence_strips_markup_and_keeps_readable_text`
is the regression guard.

## Lessons carried in from this author's prior projects, applied from day one

1. **Checks-effects-interactions.** `claim_settlement` flips `payout_claimed` and `status` to
   terminal *before* any transfer. `test_claim_settlement_status_terminal_before_payout_call`
   proves it by making `_pay` itself read the case state mid-call - the exact ordering bug this
   author's GroundTruth audit caught elsewhere.
2. **Failure never settles.** A malformed verdict, an unreachable page, or an undecidable case
   falls back to a non-decisive category and pays nobody. Double claims are refused.
3. **Liveness exits for every way this shape can stall.** `cancel_unfunded_case` closes out a
   case that was never funded. `resolve_stale_manual_review` is a permissionless escape hatch for
   a case whose app owner never acted, gated on a 14-day grace period and resolving
   conservatively as an even, unadjudicated split - escrow can never be stranded by an absent
   owner. Same liveness-versus-abuse discipline as CoverPool's `abandon_unresolvable_claim`.
4. **Settlement bands snapped inside the consensus block**, so the value validators agree on is
   exactly the value the payout reads - two raw splits straddling a payout boundary can never
   pass as "materially the same".
5. **ASCII-only source.** A Unicode em-dash left in a comment crashed the schema-compilation
   client with a `UnicodeEncodeError` while `genvm-lint` and every direct test passed cleanly -
   the same class of failure this author's Aura project hit. The source is now verified pure
   ASCII as a build step.

## Lint

`PYTHONIOENCODING=utf-8 genvm-lint check contracts/Themis.py --json` -> clean pass, **32 methods**
(14 view, 18 write).

## Direct tests

`tests/direct/test_themis.py` + `tests/direct/conftest.py`.

**33 tests, 33 passed (100%).**

Coverage: app registration and validation; template creation (owner-only, verdict-category
validation); role grant/revoke; protocol fee administration (non-admin rejected, cap enforced);
the full case lifecycle (open, fund, respond, evidence, close, verdict); evidence snapshotting
proven to be read from the record rather than re-fetched (mutating what a live fetch *would*
return after submission changes nothing); markup stripping; malformed-verdict fallback to manual
review; owner-only manual resolution; the appeal path including a flip that changes the verdict
and an appeal that reads the recorded snapshot rather than a fresh fetch; second-appeal and
non-party rejection; finalization windows; settlement splits, double-claim rejection, protocol
fee deduction, and non-monetary settlement moving no funds; checks-effects-interactions ordering;
the stale-manual-review liveness exit before and after its grace period; and a structural
signature guard on `request_verdict`.

## Integration tests (real StudioNet)

Run via `PYTHONIOENCODING=utf-8 gltest tests/integration/ -v -s --network studionet`.

`tests/integration/test_themis_studionet.py` - full lifecycle against a freshly deployed
contract: app, template, case, funding, answer, two evidence submissions (both really fetched and
hashed on-chain), evidence closure, and a real consensus verdict round. It asserts on the
**consensus status**, not just the leader receipt.

Result: consensus **ACCEPTED on the first attempt**, and the panel returned
`insufficient_evidence` with the reasoning *"Both submitted evidence snapshots are irrelevant
Wikipedia pages, not proof of an empty box, damage, missing item, weight, or delivery condition,
so the case cannot be decided on the record."* - a correct refusal to invent a winner from
irrelevant evidence, agreed unanimously.

`tests/integration/test_live_walkthrough.py` - runs against the persistent deployment with
evidence that genuinely substantiates the question, and reaches a decisive verdict:
`respondent_wins`, 0/10000, confidence 88, evidence alignment strong, reasoning *"CC BY-SA does
not include the NonCommercial restriction. The recorded licence evidence confirms commercial
reuse is permitted when attribution is given and the derivative is released under the same terms,
both of which respondent satisfied."*

Together the two suites prove both halves of the guarantee: the protocol decides correctly when
the record supports a decision, and refuses to decide when it does not.

## Deployment

`0xCd5ae93Dfd6FCFEbE12D06871c3018fB38484ca9` on StudioNet, schema verified via
`genlayer schema <address>` to match source exactly.
