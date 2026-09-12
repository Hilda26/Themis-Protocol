# Themis - response to review

## v3 - the consistency validation was still incomplete

> *"The requested consistency validation is still incomplete: the current parser normalizes some
> verdict payout totals instead of rejecting them, and it still accepts contradictory appeal
> status/change combinations such as appeal_granted with no verdict change."*

Both were real, and both were in the exact two places the review named.

**Contract (v3):** [`0xa5a26A7CE72B4D0817D0E09FC5e29B39DFD8118E`](https://explorer-studio.genlayer.com/address/0xa5a26A7CE72B4D0817D0E09FC5e29B39DFD8118E)
**Live app:** https://themis-protocol.vercel.app

### The parser normalized bad totals instead of rejecting them

`_parse_and_normalize_verdict` and `_parse_and_normalize_appeal` each had a line that looked like
validation but was actually repair:

```python
if complainant_bps + respondent_bps != 10000:
    respondent_bps = 10000 - complainant_bps
```

A validator returning `complainant_bps=6000, respondent_bps=6000` (summing to 12000, not 10000 -
an internally inconsistent output) was silently rewritten to `6000/4000` and accepted as a normal
verdict. The `respondent_bps` half was discarded and recomputed from `complainant_bps` alone,
which means only one of the model's two numbers was ever real; the contract had no way to know
whether `complainant_bps` or `respondent_bps` was the one to trust, and picked one arbitrarily.
This is the same class of problem v2 fixed for cross-field contradictions (a verdict saying
`complainant_wins` with `winner: respondent`), just left open for the payout math itself.

Fixed by rejecting outright: any split whose two halves do not sum to exactly 10000 bps now falls
back to `manual_review_required` with `reason_code = "settlement_split_does_not_sum_to_total"`,
on both the verdict path and the appeal path. Nothing is repaired or guessed.

`test_verdict_split_not_summing_to_total_is_rejected_not_normalized`,
`test_verdict_split_summing_to_less_than_total_is_rejected`, and
`test_appeal_new_split_not_summing_to_total_is_rejected_not_normalized` pin all three directions
(over, under, and on the appeal's new split).

### `appeal_granted` with no verdict change was never actually checked

v2 added a coherence check for `appeal_rejected` paired with `final_verdict_changed=True` - a
rejected appeal that also claims to have changed the verdict. That check only covered one
direction. The mirror case, `appeal_granted` paired with `final_verdict_changed=False` - an
appeal that succeeded but altered nothing - was never checked at all, despite a comment in the
code claiming it was ("a granted one that changes nothing while claiming to"). The comment
described the intended behaviour; the code next to it did not implement it.

Fixed with the missing check, symmetric to the one already there:

```python
if appeal_verdict == "appeal_granted" and not final_verdict_changed:
    return _fallback_appeal("granted_appeal_changed_nothing", ...)
```

`test_granted_appeal_that_changes_nothing_is_rejected` pins the fix, and
`test_granted_appeal_that_does_change_the_verdict_is_accepted` confirms it is not over-broad - a
coherent granted-and-changed appeal still succeeds.

### Verified

- Lint clean (33 methods), source pure ASCII, **58/58** direct tests (5 new, added for exactly
  these two gaps).
- Deployed contract fetched with `genlayer code` and diffed **byte-for-byte** against
  `contracts/Themis.py` - exact match, not "close enough".
- The full appeal-and-settlement suite re-run against v3 on real StudioNet consensus: escrow
  funded, verdict `respondent_wins` reached on the first attempt, a real appeal filed and
  reviewed (`appeal_rejected`, correctly coherent), settlement `ACCEPTED`, a second claim
  correctly rejected on-chain.

---

# v2 - response to review

The review raised four items. All four were real, all four are fixed, and each one is pinned by
a test. Nothing here is a wording change: three of the four could move or strand money, and the
fourth let the interface tell a user a write had landed when it had not.

**Contract (v2):** [`0x8AbA3e98F8219671A87682A43428d0E06825441a`](https://explorer-studio.genlayer.com/address/0x8AbA3e98F8219671A87682A43428d0E06825441a)
**Live app:** https://themis-protocol.vercel.app

---

## 1. A bounded resolution / cancellation / refund path for `insufficient_evidence`

> *"Please add a bounded resolution, cancellation, or refund path for insufficient_evidence."*

**The defect was worse than a missing convenience: it stranded escrow permanently.** A
non-decisive verdict set the case status to `insufficient_evidence`, and *no method in the
contract accepted that status*. `request_verdict` required `evidence_closed`;
`resolve_manual_review` and `resolve_stale_manual_review` required `manual_review_required`;
`claim_settlement` required `finalized`. The case could never move again and the escrowed GEN
could never leave. Verified by grepping every status guard in the contract before changing
anything.

**The fix has three parts, and both gates are required so neither liveness nor abuse wins.**

- **Retry is now permitted.** `request_verdict` accepts `insufficient_evidence` and
  `unverifiable` as well as `evidence_closed`. Evidence that was unreachable or ambiguous at one
  moment may resolve later, so the honest first move is to let the panel look again.
- **Retry is bounded.** Only rounds that actually ran and failed to decide are counted
  (`verdict_attempts`), capped at `MAX_VERDICT_ATTEMPTS = 3`. A fourth attempt is refused, so a
  case cannot spin forever.
- **Then it refunds.** `resolve_undecidable_case` is permissionless and terminal. It requires the
  attempts to be spent AND `UNDECIDABLE_REFUND_GRACE_SECONDS` (3 days) to have passed since the
  last one, so a temporarily dead source still gets time to come back.

**Why a refund rather than a split.** Nothing was adjudicated, so neither party earned anything
and the escrow returns in full to the complainant who put it up: the case ends exactly where it
began. Splitting undecided money would pay the respondent for the record being unreadable, which
is a standing incentive to make it unreadable. (This is deliberately different from
`resolve_stale_manual_review`, which splits evenly — there a panel *did* reach a decision and the
app owner simply never acted on it.)

State flips terminal before the transfer, same checks-effects-interactions ordering as
`claim_settlement`.

**Proven on real StudioNet** (`tests/integration/test_undecidable_refund_studionet.py`): a real
case was driven into a genuine non-decisive verdict — the panel's own words were *"The only
recorded evidence is an irrelevant article about photosynthesis and does not establish whether
parcel PX-4471 was delivered intact, damaged, or empty"* — then the refund was refused while
attempts remained, retries ran 1 → 2 → 3, and a fourth attempt was refused on-chain. Direct
tests cover the refund itself and the grace gate.

---

## 2. The client reports success only after an ACCEPTED receipt and committed state

> *"Make the client report success only after an ACCEPTED receipt and committed state."*

Correct, and there were **three** independent ways the old client could claim success over a
transaction that changed nothing:

1. A failed receipt fetch was swallowed with `console.warn`, leaving `receipt` undefined and the
   function returning normally.
2. It inspected only the **leader** receipt's `execution_result`. That says the leader ran fine
   even when validators disagreed and the round committed nothing — status 6 `UNDETERMINED`.
3. A `NONDET_METHODS` allow-list exempted the four consensus methods from even that check.

This is the same failure mode this project already documented finding on the *test* side; the
client had it too, and I had not fixed it there.

`writeAndWait` now:

- **throws** if no receipt is returned, rather than swallowing it;
- **normalises and checks the consensus status** (numeric `5/6/7` or enum string), rejecting
  `UNDETERMINED` with a message saying plainly that nothing was committed and the action is safe
  to retry;
- applies the leader rollback check to **every** method — the exemption only ever hid real
  failures, since a non-decisive verdict is a *successful execution returning a non-decisive
  result*, not a rollback;
- **verifies committed state** before reporting success. Every write passes a `verify` callback
  that reads the case back and confirms the intended status change is visible on-chain, polled
  because reads can briefly trail an accepted round.

---

## 3. Inconsistent verdict and appeal fields are rejected

> *"Also reject inconsistent verdict and appeal fields."*

Each field was individually well-formed, which is not the same as the verdict cohering. A
response saying `complainant_wins` with `winner: respondent`, or a decisive verdict paired with
an even split, is internally contradictory — two different settlement paths could read it and
reach two different answers about who is owed what. Such a verdict is now rejected outright
rather than silently normalised toward one of its halves, because there is no way to know which
half the model meant.

Rejected combinations, each with its own `reason_code` and test:

| Rejected | Why |
|---|---|
| `complainant_wins`/`respondent_wins` whose winner or split disagrees | `incoherent_decisive_verdict` |
| A non-decisive verdict that names a winner or an uneven split | `non_decisive_verdict_awarded_a_winner` |
| `split_settlement`/`partial_refund` allocating 100% to one side | `split_verdict_without_a_split` |
| A decisive verdict with no winner named | `decisive_verdict_without_a_winner` |
| An appeal rejected that also changes the verdict | `rejected_appeal_changed_the_verdict` |
| An appeal claiming a change with no replacement verdict | `verdict_changed_without_a_new_verdict` |
| A new verdict whose split contradicts it | `incoherent_new_verdict_split` |

**One deliberate non-rejection, found by a real round.** My first version also rejected an appeal
that reported *no change* while still echoing the standing verdict into `new_verdict`. A real
StudioNet appeal did exactly that and was pushed into `manual_review_required` — a legitimate
appeal denied on a technicality. That pattern is redundant, not contradictory: the settlement
path only reads `new_verdict` when `final_verdict_changed` is true. The echo is now cleared
rather than the appeal rejected. This is the same over-strictness that once made verdict
consensus unreachable in this project, and it was again only visible against real validators.

---

## 4. Appeal evidence is stored without delimiter-based corruption

> *"Store appeal evidence without delimiter-based corruption so every settlement path remains
> coherent."*

Appeal exhibits were packed into three parallel `|`-joined strings (urls, excerpts, digests). The
delimiter is ordinary text on real web pages, so **any excerpt containing a `|` split into extra
entries and threw the three lists out of alignment** — an exhibit could be displayed and judged
against a different exhibit's digest, which is exactly the incoherent settlement input the review
warns about.

Escaping around it would have been the shallow fix. Instead the failure mode is removed: appeal
exhibits are now a real storage record (`AppealEvidenceItem`, held in a `DynArray` and filtered
by `case_id`), each carrying its own url, true source host, excerpt, digest and fetch status.
Nothing is ever joined or split, so no correspondence can desynchronise.

`test_appeal_evidence_with_delimiters_in_page_text_stays_aligned` files an appeal over
delimiter-heavy page text and asserts each URL still carries its own excerpt and its own digest.

---

## Verification

- `genvm-lint` clean — **33 methods** (14 view / 19 write), source verified pure ASCII
- **53 / 53 direct tests** passing, including 11 new ones covering the four items above
- **Four real StudioNet integration suites**, all asserting on the *consensus status* rather than
  the leader receipt:
  - full lifecycle to a verdict
  - appeal round and a real escrow payout, with the double-claim refused on-chain
  - the bounded undecidable path (this review's item 1)
  - a live walkthrough populating the browsable demo case

Two of the fixes above were shaped by what real validators actually did, not by what the code
looked like — the undecidable path was proven by driving a genuine refusal on-chain, and the
appeal-coherence rule was corrected after a real round showed it rejecting a legitimate appeal.
