# Themis

**A reusable, hardened AI-consensus dispute and attestation protocol on GenLayer.**

**Live app:** (added after deploy)
**Contract (StudioNet):** [`0xCd5ae93Dfd6FCFEbE12D06871c3018fB38484ca9`](https://explorer-studio.genlayer.com/address/0xCd5ae93Dfd6FCFEbE12D06871c3018fB38484ca9)
**Source:** this repo (`contracts/Themis.py`)

## What it is

Themis is infrastructure other apps integrate with, not a closed product. Any app registers,
defines a dispute template (plain-English rules, the verdicts a panel may return, how settlement
works), and opens cases against it. GenLayer validator consensus reads the case and issues a
verdict, and if the template allows it either party may contest that verdict once.

The same protocol serves a marketplace's buyer/seller disputes, a DAO's grant milestone claims,
a game's moderation appeals, or a pure attestation - "did X happen, per this evidence" - with no
money involved at all (`settlement_mode="non_monetary_verdict"`).

## The two things that make it different

Themis is a hardened rebuild of an existing reference design in this space. Two concrete gaps in
that design are what this project exists to close.

### 1. Evidence is recorded once, at submission - never re-fetched at judgment time

The reference design fetches every evidence URL live at `request_verdict`, and fetches it live
**again** at `request_appeal_review`. That is a real tamper window: a party can submit a URL, wait
for the first verdict, edit the page, and have the same URL re-read differently by the appeal
panel.

In Themis, `submit_evidence` and `file_appeal` each fetch, reduce to readable text, defang and
SHA-256 hash their URLs immediately, storing the excerpt and digest alongside the submission.
`request_verdict` and `request_appeal_review` never touch the web - they read only what was
recorded. Nobody can edit a page after the other side has answered it.

### 2. No party-authored string can impersonate the record

The reference design concatenates `case_summary`, `respondent_response`, evidence
`statement`/`title` and appeal `statement` straight into the judging prompt with no
sanitisation - so a party can type a fabricated "recorded evidence" block, or an
instruction-shaped string, into their own statement and the model cannot tell it from genuine
fetched content.

In Themis every party-authored string and every fetched excerpt is defanged of the exact fence
sequence used to delimit trusted content, using ASCII-only substitutes. A forged block can only
ever arrive visibly defused, and the prompt tells the panel that fenced text is untrusted quoted
content, never an instruction.

## Verdicts

| Verdict | Meaning |
|---|---|
| complainant_wins / respondent_wins | The record decides for one side |
| split_settlement / partial_refund | Partial merit either way |
| redo_required / no_fault | Non-monetary dispositions |
| insufficient_evidence | The canonical "cannot be decided on this record" outcome |

Settlement splits are snapped to a fixed band **inside the consensus block**, so the value
validators agree on is exactly the value the payout later reads - two raw splits straddling a
payout boundary can never slip through as "materially the same".

## Lessons carried in from this author's prior GenLayer projects

Applied from the first submission rather than after a review asked:

- **Checks-effects-interactions.** `claim_settlement` flips `payout_claimed` and `status` to
  terminal *before* any transfer, with a dedicated test that makes `_pay` itself observe the
  case state mid-call.
- **Failure never settles.** A malformed verdict, an unreadable page or an undecidable case
  falls back to `insufficient_evidence` and pays nobody. No case can be claimed twice.
- **Exact-value discipline** on settlement bands; a protocol fee capped at 10% and settable only
  by the deploying admin.
- **Prompt-injection defence** with ASCII-only substitutes - Unicode lookalikes crashed a
  schema-compilation client in this author's Aura project even though the contract itself ran.
- **Liveness exits.** `cancel_unfunded_case` closes out a case that was never funded;
  `resolve_stale_manual_review` lets anyone resolve a case whose app owner vanished, after a
  grace period, as an even unadjudicated split. Escrow can never be stranded by an absent owner.

## Two bugs only a real deployment could surface

Both were found by deploying to StudioNet and reading what actually came back, not by any
mocked test. They are documented in full in `CONTRACT_STATUS.md`.

1. **Consensus could never finalize.** An early revision compared seven independently-generated
   fields for strict equality between validators, including free-text `reason_code`. Against real
   validators that bar is unreachable: rounds returned `UNDETERMINED` (status 6), committing no
   state, while `tx_execution_succeeded()` still reported success because it inspects only the
   *leader* receipt. Cases sat at `evidence_closed` forever. Fixed by judging on the decision
   alone - disposition, winner, settlement band - with all three "cannot decide" categories
   treated as one outcome.
2. **The record captured no readable content.** Evidence was stored as the first 1500 bytes of
   the raw HTTP body, which for any real page is `<head>` boilerplate. Every panel correctly but
   uselessly ruled `insufficient_evidence`. Fixed by rendering to readable text, stripping
   markup, and raising the caps to hold real article text.

## Stack

Next.js (App Router), TypeScript strict, Tailwind, wagmi + viem, `genlayer-js` 1.1.8 targeting
GenLayer StudioNet. The interface uses an editorial document treatment - parchment ground,
Playfair Display, gold rules - because the artefact it presents is a case record.

## Quality gates

```bash
PYTHONIOENCODING=utf-8 genvm-lint check contracts/Themis.py --json
pytest tests/direct/ -v
gltest tests/integration/ -v -s --network studionet
```

## Getting started

```bash
python -m pytest tests/direct -q

cp .env.example .env.local
npm install
npm run dev
```
