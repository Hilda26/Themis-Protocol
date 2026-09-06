# Themis demo video script

Target length: ~3 minutes. Screen-record the live app.

---

## 1. Cold open (0:00-0:20)

Load the landing page.

**Say:**
> "This is Themis. It's not a dispute app - it's dispute infrastructure other apps plug into.
> And its whole argument is in the headline: disputes are settled from the record, not from the
> live web."

---

## 2. The case register (0:20-0:45)

Go to the Case Register, open case 0001.

**Say:**
> "Here's a real case, decided on-chain a few minutes ago. A licence dispute: someone reused a
> CC BY-SA article commercially, the author says that's infringement, the reuser says the licence
> allows it."

---

## 3. The recorded evidence - the core idea (0:45-1:30)

Scroll to the Recorded evidence block. Point at the sha256 line.

**Say:**
> "This is the part that matters. That evidence URL was fetched, reduced to readable text, and
> SHA-256 hashed at the moment it was submitted - in the same transaction. When the panel judged
> this case, it read that recording. If it goes to appeal, the appeal panel reads the same
> recording.
>
> The design I rebuilt this from fetches the page live at verdict time, and live again at appeal
> time. That's a real attack: pin an innocuous page, let the other side answer it, then edit the
> page before the appeal re-reads it. Here you can't - the record was frozen and hashed before
> anyone answered it."

---

## 4. The verdict (1:30-2:00)

Scroll to the Verdict block.

**Say:**
> "Validators independently judged that record and agreed: respondent wins, hundred percent, with
> the reasoning that CC BY-SA has no NonCommercial clause, so commercial reuse is permitted when
> you attribute and share alike - which the respondent did. That's real consensus over a real
> snapshot, not one model's opinion."

---

## 5. What happens when the record can't decide (2:00-2:30)

**Say:**
> "The other half matters just as much. In the integration suite I pinned evidence that was
> genuinely irrelevant to the dispute, and the panel refused to pick a winner - it returned
> 'insufficient evidence' and said so: these snapshots aren't proof of anything about the parcel.
> Failure never settles. Nobody gets paid because the model felt like guessing."

---

## 6. Two bugs the deployment caught (2:30-2:55)

**Say:**
> "Two things in this contract were only findable by deploying it. Consensus originally compared
> seven independently-generated fields for exact equality - including free-text reason codes - so
> rounds silently returned UNDETERMINED and committed nothing, while the standard test helper
> still said success because it only reads the leader's receipt. And evidence was stored as the
> first 1500 bytes of raw HTML, which is just head boilerplate, so every panel ruled insufficient
> evidence no matter what the page said. Both are written up in the repo rather than quietly
> patched."

---

## 7. Close (2:55-3:05)

**Say:**
> "Thirty-two methods, lint clean, thirty-three direct tests, two real StudioNet suites that both
> assert on consensus status rather than the leader receipt. Source and contract address are in
> the README."

---

## Notes for recording

- A real `request_verdict` round takes minutes. Narrate over the already-decided case rather
  than waiting on camera, or cut to the result.
- Contract: `0xf60ED1100DcCb7A61fbB42B2aeb05d96aD865959`
- Explorer: https://explorer-studio.genlayer.com/address/0xf60ED1100DcCb7A61fbB42B2aeb05d96aD865959
