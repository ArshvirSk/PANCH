# Builder Center project page: Panch

Copy each section into the matching Builder Center field. Every number here comes from the live stack and is recorded in `docs/dev-process/LOG.md`; the phase is given beside it. Don't add figures that aren't in that log or in `bench/RESULTS.md`.

**Tags:** `#commercial-potential` `#startup`

---

## One-paragraph pitch

A freelancer in Mumbai finishes $400 of work for a client in Berlin, and the client stops paying. A lawyer costs more than the claim, a foreign court won't hear it, and off-platform deals have no dispute desk. Panch is consent-based arbitration for these small cross-border disputes:
- **Escrow:** both sides agree to it up front, and the client funds a simulated escrow.
- **Panel:** if they fall out, three AI judges from three model families (Amazon Nova, Mistral and Llama on Amazon Bedrock) rule independently on a record with names and countries removed, then cross-examine each other.
- **Bias check:** a swap test checks that no judge favours whoever is labelled the claimant.
- **Ruling:** a presiding judge publishes a reasoned ruling, with every finding citing evidence and its hash verifiable by anyone.
- **Human review:** when the judges disagree, the case goes to a person instead of a guess.

It costs about three cents of AWS and Bedrock per case. Freelance platforms can license it per case.

## 150-word summary

Panch is AI arbitration for sub-$1,000 cross-border freelance disputes that courts and lawyers can't economically serve. Parties agree to Panch when they make the deal and fund a simulated escrow. In a dispute, three judges from different Bedrock model families rule independently on a blinded record, cross-examine each other, and face a swap test that mirrors the parties to catch label bias. Agreement produces a published ruling: findings that cite evidence, the clauses relied on, and a payout split, with a SHA-256 hash and a hash-chained ledger that anyone can verify. Disagreement escalates to a human review queue that shows every judge's reasoning side by side. Everything runs on AWS: Step Functions, Lambda, Bedrock with Guardrails, DynamoDB, S3 with CloudFront, Cognito and Amplify. Measured cost is about $0.03 per case. All demo and benchmark data is synthetic. Panch is arbitration by consent on simulated funds, not legal advice.

---

## 1. Development process

- **Specs first:** a PRD and TRD (`docs/Panch_PRD.md`, `docs/Panch_TRD.md`), then a team plan with frozen contracts between three lanes:
  - infrastructure and API (Arshvir);
  - tribunal and benchmark (Rutu);
  - frontend and docs (Piyush).
- **Shared contracts:** these live in `services/shared` and change only through a reviewed PR.
- **Pull requests:** all work lands through PRs from the repo template, with:
  - unit tests (480 across the workspaces at the time of writing);
  - `cdk synth`;
  - a dev-log entry per session.
- **Deploys** go through a lock script, so two people can't deploy to the shared account at once.
- **The dev log** (`docs/dev-process/LOG.md`) records each phase:
  - what was built and what the agent did;
  - the checks run;
  - the bugs found live and how they were fixed;
  - what was deliberately left open.

## 2. Coding-agent contribution

- **Who:** coding agents (Claude Code, plus Codebuff for some tribunal work), connected to the AWS account through the team's SSO profile.
- **Infrastructure:** they built and deployed the CDK stacks.
- **Code:** they wrote the API, tribunal and frontend code and tests.
- **Live testing:** they found and fixed bugs that only showed against the deployed stack. Examples:
  - a ledger that allowed double settlement;
  - a swap-test prompt that made unanimous panels look inconsistent;
  - an IAM grant on the wrong ARN;
  - a frontend that showed a cached fallback as if it were a ruling.
- **Process:** each LOG.md phase says what the agent did and what was verified, including results that didn't match expectations.
- **Proof** of the agent connected to AWS goes in `docs/dev-process/proof/`. Today it holds one screenshot of the SSO identity check. **Before submitting:** add screenshots of the agent session connected to AWS and building resources, plus the screen recording PRD section 5 requires, then update this line.

## 3. Category

Commercial potential (`#commercial-potential`).

## 4. Lane

Startup (`#startup`).

## 5. Live link

https://main.d1hm3x5hny8fjb.amplifyapp.com

No login is needed for the landing page, **Run demo case** (with its live timeline) or the public ruling pages with **Verify ruling**. A sample ruling: https://main.d1hm3x5hny8fjb.amplifyapp.com/ruling/?id=demo-ba-a-354484

---

## Bias and accuracy results, reported honestly

**Final validation: unmeasured, and reported that way.** `bench/RESULTS.md` (LOG.md phase 23) marks every PRD section 9 metric as **UNMEASURED**: agreement with gold, escalation on ambiguous cases, swap-test flip rate, cost and end-to-end time.
- **Why:** since 2026-09-29, every Bedrock call on the account returns "Error 002: Access to Bedrock models is not allowed for this account". This is an account-level block, not a code or IAM issue.
- **What was confirmed live:** the failure path. A failed run publishes the labelled cached fallback (byte-identical to the seed, served through CloudFront) and writes no ledger entries, so the escrow is untouched.
- **If access is restored before submission:** rerun the protocol in `bench/RESULTS.md`, then replace this paragraph with its numbers, misses included. Don't fill it from estimates.

**Last measured live (2026-09-28, before the block):** the three hand-written demo cases, against gold labels fixed before any model saw them (LOG.md phase 16):

| Case | Gold | Live result | Verdict |
|---|---|---|---|
| A: non-payment after confirmed delivery | 100% to claimant | Settled at 100%, unanimous, spread 0, swap test consistent, verified | Hit |
| B: no delivery, invoice for sketches | 0% to claimant | Panel unanimous at 0%, but the run **escalated twice** because the swap-test prompt was ambiguous. After the prompt fix it settled at 0% (`demo-ba-bfix-45a736`) | Hit after a fix. The miss is recorded, not hidden |
| C: genuine split (late, partial delivery) | 50%, escalation expected | Escalated; judges 50%, 70% and 0.8%, panel median 50% | Correct routing |

**Known weaknesses** (LOG.md phases 10 and 11; also on the site's Limitations page):
- **Run-to-run variance:** the same case can land differently on different runs, mostly from the Nova judge. About 40% of demo runs have escalated rather than published.
- **Median-blind swap test:** the panel-level swap check compares medians, so one judge contradicting itself can be absorbed. The review queue shows each judge's swap result for this reason.
- **Positional bias:** telling a model the roles are reversed pushed one judge toward a more literal reading of the same facts.

**Cost per case,** from the Rulings records (LOG.md phase 21):

| Rulings measured | Median | Mean | Range |
|---|---|---|---|
| 13 | $0.0261 | $0.0294 | $0.0245 to $0.0419 |

Each case uses about 12 Bedrock calls and 9,000 to 15,000 tokens.

**Data statement:** every contract, chat log, invoice, party and benchmark case is synthetic, written for testing. No real people or disputes are used.
