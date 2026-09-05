# Themis - Decision Record

## Why rebuild an existing design instead of inventing a new domain

Dispute-resolution-as-a-service is already occupied on GenLayer, and the existing reference
design is genuinely competent: banded settlements, a manual-review fallback, app-scoped roles, a
capped protocol fee. Competing with it on features would produce a derivative project.

What it does *not* have is a defensible evidence model. It fetches every evidence URL live at
verdict time and live again at appeal time, and it feeds unsanitised party text straight into the
judging prompt. Those are not cosmetic gaps: they are the two ways an adversarial party actually
wins a dispute they should lose. Themis exists to close them, and the differentiator is
therefore adversarial robustness rather than surface area.

## Why evidence is snapshotted at submission rather than judged live

The intuitive design fetches at judgment time so the panel sees "the truth right now". Rejected:
it means the page a panel reads is whatever the pinning party has most recently made it say. The
attack is trivial - pin an innocuous URL, let the other side answer it, then change the page
before the appeal re-reads it. Because the reference design fetches at *both* rounds, the appeal
is precisely where the swap pays off.

Fetching once, in the pinning transaction, and hashing the stored bytes makes the record
tamper-evident and gives every later round the same view. The cost is that a snapshot can go
stale relative to the live page - which is the correct trade: a dispute is judged on what the
parties actually put in front of each other, not on what the world looks like afterwards.

## Why readable text is stored rather than the raw response body

Storing the raw HTTP body seemed neutral - it is the most faithful record of what was served.
In practice it was the difference between a working protocol and a useless one: 1500 bytes of a
real page is `<head>` boilerplate, so every panel ruled `insufficient_evidence` no matter what
the page said. Rendering to text and stripping residual markup means the digest binds the
*substance* a panel will actually read. The digest still binds exactly the bytes that are stored
and shown, so tamper-evidence is unchanged.

This was only discoverable by deploying and reading a real verdict's reasoning. It is the single
strongest argument in this project for treating "the tests pass" as insufficient evidence that a
system works.

## Why the equivalence principle compares only the decision

The first revision compared seven fields for strict equality, reasoning that a stricter bar
meant a stronger guarantee. It is the opposite: independently-generated commentary
(`reason_code`, `confidence`, `evidence_alignment`) will differ between honest validators, so a
bar that includes it rejects agreement that genuinely exists. The round returns UNDETERMINED,
nothing commits, and - because `tx_execution_succeeded()` reads only the leader receipt - the
failure is invisible to a naive test.

The correct bar is exactly the fields that move money or determine the outcome: disposition,
winner, settlement band. Everything else is recorded from the leader as commentary. A consensus
rule should be as strict as the decision requires and no stricter, because unreachable consensus
is itself a liveness failure.

## Why three "cannot decide" categories collapse to one

`insufficient_evidence`, `unverifiable` and `manual_review_required` mean the same thing to a
reader but are three different strings to a comparator. On ambiguous cases - the ones where a
clean fallback matters most - honest validators split across synonyms and the round fails. The
prompt now names one canonical bucket and the principle treats all three as one disposition. The
categories remain valid for parsing, so nothing breaks if a model returns another.

## Why an UNDETERMINED round is left retryable rather than handled

A failed consensus round commits no state: the case stays at `evidence_closed`, and
`request_verdict` is permissionless. That means retry is already the correct and available
remedy, and adding explicit failure bookkeeping would only create state that could itself get
stuck. The integration suite proves the retry path rather than the contract encoding it.

## Why the stale-manual-review exit resolves as an even split

`manual_review_required` depends entirely on the app owner acting. If they never do, the case and
its escrow are stuck forever. The exit resolves conservatively - no winner, 5000/5000 - rather
than picking a side, because nobody adjudicated it: a party should never gain from the app
owner's absence. The 14-day grace period means an owner who is merely slow still resolves it
properly first.

## Why appeals are capped at one per case

Sigil's design re-arms a window for the newly-losing party when an appeal flips a verdict,
bounding the path at two rounds. Themis keeps the reference design's stricter single appeal.
This is a deliberate choice, not an oversight: each appeal spends a real consensus round on the
same frozen record, and a second round over identical evidence mostly buys delay. The record
cannot change between rounds here - that is the whole point of snapshotting - so re-litigating
it has less to offer than in a design where evidence is still moving.

## Self-review

Every claim in `CONTRACT_STATUS.md` was verified against a real deployment before being written.
Two of the four defects this project fixed were invisible to a passing 33-test suite and a clean
lint, and were found only by deploying to StudioNet and reading what actually came back - one
from a transaction status code, one from a verdict's own prose. The habit that matters here is
not writing more tests; it is refusing to describe a system as working until it has been watched
working.
