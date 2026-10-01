# Panch demo video script (3:00)

Follows PRD section 10, with one addition: an escalated case resolved through the human review queue.

- **Live site:** https://main.d1hm3x5hny8fjb.amplifyapp.com
- **All names, amounts, contracts and chats are synthetic.** Say so on screen once, in the opening caption.

## Before recording

> **Blocker as of 2026-10-01:** Bedrock model access is blocked at the account level ("Error 002", see `bench/RESULTS.md`, LOG.md phase 23). Both live `/demo/run` runs tried today failed about 60 seconds in, during the judges stage (`demo-7b7088b0`, `demo-ef35bc31`; LOG.md phase 24). Until the three judge models are re-enabled and a fresh demo run settles:
> - don't record the 0:52 segment;
> - don't record the bias-eval segment at 1:50: `bench/RESULTS.md` has no measured numbers yet;
> - use the backup plan below.

**Accounts.** Prepare two signed-in browser windows, side by side:
- Window A: "Riya", the claimant.
- Window B: "Klaus", the respondent, signed up with the email Riya will name.

Both are test accounts.

**Evidence file.** Have a small PDF or `.txt` ready to upload, for example the Case A contract in `bench/demo/case-a/contract.txt`.

**A settled case to show, in its own tab:**
- Case A, `/ruling/?id=demo-ba-a-354484`.
- It's a real live run: 100% to the claimant, matching its gold label, and **Verify ruling** returns *Verified*.

**An escalated case to resolve, in its own tab:**
- Case C, `demo-ba-c-d3ec86`, which is in `/reviews/` by design. Its judges awarded 50%, 70% and 0.8%.
- Check it is still in the queue before recording. Resolving it on camera takes it out of the queue.

**A fresh demo run, as backup:**
- Press **Run demo case** on the landing page about 5 minutes before recording.
- If it settles, keep its ruling tab open as a second settled case.
- The cap is 30 demo runs per day (UTC).

**What the UI does and doesn't show:**
- The live timeline shows stage progress (intake → judges → cross-exam → swap test → aggregate → presiding → publish → settle). It doesn't show the judges' cross-exam critiques. To show a judge catching a misread clause, cut to the Step Functions console: the run's `CROSS_EXAM` state output has each critique. This also shows the AWS console on camera.
- A case created by hand in the UI goes through fund, dispute and upload for real. But today the tribunal judges only the seeded evidence: `intake.ts` is a stub and doesn't read uploaded files. So the **deliberation** shown in the video must be a demo or bench case. Don't say the judges read the file uploaded on camera.

## Script

| Time | On screen | Voice-over |
|---|---|---|
| **0:00** | Landing page hero. Caption: "All data in this video is synthetic." | "Riya is a freelance designer in Mumbai. She delivered a $400 landing page to a client in Berlin, who stopped answering. A lawyer costs more than the claim and a foreign court won't hear it. That's the gap Panch fills: consent-based arbitration for small cross-border disputes." |
| **0:20** | Window A: **New case** → respondent email, $400 → **Create case**. Copy the case ID. | "Riya opens a case and names her client. Both sides agree to Panch arbitration up front." |
| **0:30** | Window B: open the case → **Fund escrow** → confirm. Then **Open dispute** → confirm. | "The client funds a simulated escrow, then disputes: 'work not as specified'. Every step is written to a hash-chained ledger." |
| **0:42** | Window A: drag the evidence file onto the dropzone → upload → **Submit for deliberation**. | "Both sides upload evidence. Names and countries are removed before any judge sees the case." |
| **0:52** | Landing page: **Run demo case**. The live timeline moves through intake, blinding and independent rulings. | "Here's the tribunal on a pre-seeded case. Three judges from three model families, Amazon Nova, Mistral and Llama, rule independently on the blinded record." |
| **1:15** | Step Functions console: the run's `CROSS_EXAM` output, with one critique highlighted. Back to the timeline. | "Then they cross-examine each other. Here one judge flags another's reading of the payment clause, and the panel revises." |
| **1:35** | Timeline at **Swap test**. Then `/reviews/` with the swap lines on a case. | "The swap test reruns every judge with the parties mirrored. An impartial judge's award should invert. Panch checks each judge, not just the average." |
| **1:50** | The bias-eval figures from `bench/RESULTS.md`. **Don't record this segment until that file exists.** | "On our synthetic benchmark: [flip rate], [agreement with gold labels], [escalation rate on ambiguous cases], misses included." Read the real numbers, and say what the panel got wrong. |
| **2:05** | `/reviews/`, Case C: three judges side by side, spread 69.2 pts. Type 50, add a note, **Resolve case** → confirm. | "When judges disagree too much, or the swap test changes the result, Panch doesn't guess. It escalates to a human, who sees the full panel record. Here the panel split, so a reviewer settles it at 50/50 with a written reason." |
| **2:25** | Case A ruling: the award, the reasoning with cited evidence, then **Verify ruling** → *Verified*, with the hash and the ledger RESOLVE → RELEASE. | "Every ruling is published with its reasoning and evidence citations. Anyone can verify it: Panch recomputes the hash of the published ruling and every ledger entry, and the escrow releases on those terms." |
| **2:45** | Landing page, the "How it works" section. | "We measured about three cents of AWS and Bedrock per case, against a one-dollar target. Platforms license Panch per case, or a small capped fee comes out of escrow. Freelance marketplaces are the beachhead, with B2B service contracts next." |
| **3:00** | Logo and URL. | "Panch. A panchayat for disputes no court will hear." |

**Cost figure:** "about three cents" comes from the Rulings table, measured in LOG.md phase 21: n=13, median $0.0261, mean $0.0294, range $0.0245 to $0.0419.

## Backup plan

**If Bedrock is slow or a run fails while recording:**
1. **Don't wait on camera.** Cut to the settled Case A ruling (`demo-ba-a-354484`) and the pre-recorded run made before the session. Say "here is a run from earlier today", which is true.
2. **If a run fails, show it.** The landing page says "The tribunal could not finish this run", and the ruling page shows the labelled cached fallback: no award, escrow untouched. This is the honest-failure story, worth ten seconds. A recent example is `demo-7b7088b0`, a real failure on 2026-10-01.
3. **If the review queue is empty** (Case C was already resolved), use any other case in `/reviews/`. If there are none, skip 2:05–2:25 and say escalated cases go to a human queue, showing a screenshot of the queue.
4. **If Verify reports "Not verified"**, don't hide it. Read the reason it gives. Use Case A or `demo-9bfae5c6`, which verify cleanly; cases funded and disputed through the full UI currently fail the ledger check because of a known bug (see LOG.md phase 24).

**Pre-record these, from the live site, before the session:**
- the full timeline of one successful demo run, start to settled;
- Case A's ruling with **Verify ruling** pressed.
