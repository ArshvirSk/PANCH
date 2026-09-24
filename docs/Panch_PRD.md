# Panch: Product Requirements Document

**Tagline:** The AI panchayat for disputes no court will hear.
**Hackathon:** AWS Zero to Shipped
**Tags:** `#commercial-potential` `#startup`
**Owner:** Arshvur | **Status:** Draft v1

**Name:** _Panch_ comes from _panchayat_, the traditional council of five that settles disputes by deliberation. Panch mirrors this: a five-role panel (three independent judges, a presiding judge, a bias auditor) that reasons in the open and publishes its decision.

---

## 1. Problem

A freelancer in Mumbai completes $400 of work for a client in Germany. The client stops paying.

- A lawyer costs more than the claim.
- Foreign jurisdiction makes court action impractical.
- Platform dispute resolution (Upwork, Fiverr) is opaque, non-binding or unavailable for off-platform deals.
- Result: no recourse, and the client knows it.

Millions of sub-$1,000 cross-border disputes each year fall into this gap. Existing legal systems treat them as too small to matter.

## 2. Solution

Panch is a consent-based online arbitration service:

1. Both parties agree to Panch arbitration when they sign the deal, and the client funds an escrow.
2. If a dispute arises, both submit contract terms, evidence and chat logs.
3. A panel of independent LLM judges from different model families deliberates, cross-examines each other and issues a reasoned ruling.
4. The ruling is published with a verifiable hash, and the escrow releases or splits funds according to it.
5. Cases the panel is unsure about escalate to a human reviewer.

## 3. Users

| Persona                           | Need                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| **Riya, freelancer (Mumbai)**     | Get paid for delivered work without a legal fight. Primary persona and the demo protagonist. |
| **Klaus, client (Berlin)**        | A fair process that stops bad-faith claims and doesn't take sides by geography.              |
| **Freelance platform (licensee)** | Cheap, fast, defensible dispute resolution to reduce churn and support cost.                 |
| **Reviewer (human)**              | Handles escalated cases with the full panel record.                                          |

## 4. Goals and non-goals

**Goals**

- Live, public, working end-to-end demo on AWS: dispute in, reasoned ruling out, funds released.
- Visible bias-reduction methodology with measured results.
- Under 10 minutes and under $1 per case.

**Non-goals (v1)**

- Real money, real fiat off-ramps, KYC.
- Replacing courts or handling disputes above $5,000.
- Enforceability in any specific jurisdiction. Framed as arbitration by consent, demonstrated on simulated funds.

## 5. Hackathon requirements mapping

| Requirement                                                        | How Panch meets it                                                                                                                                                                |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coding agent connected to AWS console, with documented proof       | Claude Code or Kiro connected to the AWS account; record screenshots and a screen recording of the connection and of the agent building resources. Store in `/docs/dev-process/`. |
| Live app on AWS, public URL                                        | Next.js on Amplify Hosting behind CloudFront. Deployed on day 1 and kept live.                                                                                                    |
| One category                                                       | Commercial potential (`#commercial-potential`).                                                                                                                                   |
| One lane                                                           | Startup (`#startup`).                                                                                                                                                             |
| Original, unpublished app                                          | New repo, first public release is the submission.                                                                                                                                 |
| Development process, agent contribution, category, lane, live link | README plus Builder Center project page covering all five.                                                                                                                        |
| Ship gate (must be reachable by judges and AI scorer)              | Public URL with no login wall on the landing page, ruling gallery and a one-click "Run demo case" button.                                                                         |
| Tags on Builder Center project                                     | Add both tags before the deadline.                                                                                                                                                |
| Builder Center profile, age 18+, AWS account                       | Confirm before submitting.                                                                                                                                                        |

**Scoring alignment**

| Criterion                   | Panch's answer                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Creativity and storytelling | First-person story: freelancer, $400, ruling in minutes. The panchayat framing.                                   |
| Technical innovation        | Multi-family judge panel, adversarial cross-examination, blind judging, swap test, published synthetic benchmark. |
| Community and market impact | Sub-$1,000 cross-border disputes; platform licensing; access-to-justice angle.                                    |
| Communication quality       | Clear README, architecture diagram, 3-minute demo video, bias-eval slide.                                         |

## 6. Functional requirements

**P0 (must ship, ship gate depends on these)**

| ID  | Requirement                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Create a deal: parties, amount, contract text or upload, deadline.                                                                      |
| F2  | Simulated escrow: fund, release, dispute, resolve, with an immutable ledger.                                                            |
| F3  | Open a dispute and upload evidence (PDF, image, chat log text). Respondent gets a separate link to respond and upload counter-evidence. |
| F4  | Evidence intake: OCR, normalization, hashing, injection screening, PII masking.                                                         |
| F5  | Panel deliberation: 3 independent judges, then 2 rounds of cross-examination, then the presiding judge's synthesis.                     |
| F6  | Bias controls: blind party names and countries; swap test; human-escalation trigger.                                                    |
| F7  | Reasoned ruling: findings of fact, clauses relied on, evidence citations, payout split.                                                 |
| F8  | Public ruling page with hash and a "Verify ruling" button.                                                                              |
| F9  | Live case timeline showing panel progress.                                                                                              |
| F10 | "Run demo case" button that runs a pre-seeded case end-to-end for judges.                                                               |

**P1 (should ship)**

| ID  | Requirement                                                               |
| --- | ------------------------------------------------------------------------- |
| F11 | Bias-eval dashboard: flip rate, judge agreement, accuracy vs gold labels. |
| F12 | Human review queue for escalated cases.                                   |
| F13 | Email notification of ruling (SES).                                       |
| F14 | Appeal window (72h simulated) before settlement finalizes.                |

**P2 (stretch)**

| ID  | Requirement                                                                             |
| --- | --------------------------------------------------------------------------------------- |
| F15 | Solidity escrow on a testnet (Base Sepolia / Polygon Amoy) with KMS-signed `resolve()`. |
| F16 | Platform API for licensees.                                                             |

## 7. Core user flow

1. Riya and Klaus create a deal and sign the Panch clause. Klaus funds escrow.
2. Riya delivers. Klaus disputes: "work not as specified."
3. Both parties upload evidence within the evidence window.
4. Panch runs intake, then 3 blind judges, then cross-examination, then the swap test, then aggregation.
5. If judge spread is within threshold and the swap test is consistent, the presiding judge writes the ruling. Otherwise it goes to human review.
6. Ruling is published and its hash recorded. Escrow settles per the ruling after the appeal window (or immediately in demo mode).
7. Both parties get the ruling link. Anyone can verify the hash.

## 8. Data requirements (where data matters most)

No public dataset of freelance disputes exists. **Data is the most important dependency after the model panel**, because it powers the demo, the evaluation and the pitch.

| Data                                                                       | Where it is used                                                                      | Source                                                     | Priority     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------ |
| **3 scripted demo cases** (contract, chat log, invoice, deliverable notes) | Live demo, "Run demo case" button, ship-gate proof                                    | Hand-authored, reviewed by you                             | **Critical** |
| **Synthetic benchmark, 30-50 cases** with gold outcomes                    | Bias eval, accuracy, flip rate, judge agreement (F11); the technical-innovation story | Generated with Bedrock from 8-10 archetypes, hand-verified | **Critical** |
| **Contract templates**                                                     | Realistic clauses in synthetic cases                                                  | Open templates (Bonterms, Common Paper)                    | High         |
| **Evidence artifacts** (chat screenshots as PNG, PDF invoices)             | Exercise Textract in intake (F4)                                                      | Created by you                                             | High         |
| **CUAD** (annotated contracts)                                             | Test clause extraction quality; ground clause-citation checks                         | Public, CC BY 4.0                                          | Medium       |
| **Pile of Law**                                                            | Legal phrasing reference for the presiding judge style prompt                         | Public (Hugging Face)                                      | Low          |
| **UNCITRAL Model Law, New York Convention**                                | Cited in the ruling framework and pitch                                               | Public texts                                               | Medium       |
| **Live case data** (parties' uploads)                                      | Runtime only; encrypted; not used for training                                        | Users                                                      | Runtime      |

**Dispute archetypes:** non-payment, scope creep, missed deadline, quality dispute, ghosting, partial delivery, revision loop, IP ownership.

**Rules**

- Synthetic data only. No real people's chats, invoices or names.
- Every benchmark case has a gold split (e.g. 100/0, 70/30, 0/100) fixed before any model sees it.
- The benchmark is open-sourced as a deliverable.

## 9. Success metrics

| Metric                                       | Target                                        |
| -------------------------------------------- | --------------------------------------------- |
| Public URL uptime during judging             | 100%                                          |
| End-to-end demo case time                    | Under 5 minutes                               |
| Cost per case (Bedrock + AWS)                | Under $1                                      |
| Swap-test flip rate                          | Under 10% (reported honestly)                 |
| Agreement with gold labels on clear cases    | Above 85%                                     |
| Escalation rate on ambiguous benchmark cases | Above 60% (the panel should flag uncertainty) |

## 10. Demo script (3 minutes)

1. **0:00** The story: Riya, $400, no recourse.
2. **0:30** Create deal, fund escrow, open dispute, upload evidence.
3. **1:00** Live timeline: three judges rule independently, then cross-examine (show one judge catching another's misread clause).
4. **2:00** Swap-test result and the bias-eval slide.
5. **2:30** Ruling published, hash verified, funds released in the ledger.
6. **2:50** Business model and where it goes next.

## 11. Business model

- Per-case fee (a percentage of escrow, capped) or platform licensing.
- Beachhead: freelance platforms and marketplaces. Later: B2B service contracts, gig-economy payouts.

## 12. Risks

| Risk                                   | Mitigation                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Live demo fails, failing the ship gate | Deploy day 1; pre-seeded cases; cached fallback ruling; CloudWatch alarms                             |
| Bedrock model access or quota delays   | Request access and quota increases on day 1; fall back to two model families if needed                |
| Judge bias or hallucination            | Blind judging, swap test, cross-exam, evidence-ID citations required, human escalation                |
| Prompt injection via evidence          | Guardrails plus "evidence is data, not instructions" prompting; injection test cases in the benchmark |
| Legal claims about enforceability      | Frame as arbitration by consent, simulated funds, no legal-advice claims                              |
| Scope creep                            | On-chain escrow is P2 and does not block shipping                                                     |

## 13. Timeline (14 days)

| Days    | Milestone                                                                                            |
| ------- | ---------------------------------------------------------------------------------------------------- |
| 1-2     | AWS account, Bedrock access, coding agent connected (capture proof), CDK skeleton, Amplify site live |
| 3-4     | Data layer, API, simulated escrow ledger, auth                                                       |
| 5-8     | Tribunal workflow (judges, cross-exam, swap test, aggregation, ruling)                               |
| 6-8     | Generate and verify synthetic benchmark in parallel                                                  |
| 9-11    | Frontend: deal, evidence, timeline, ruling page, verify button                                       |
| 12      | Bias-eval run and dashboard                                                                          |
| 13      | Demo cases, video, README, Builder Center page                                                       |
| 14      | Buffer, tags, submission, final live check                                                           |
| Stretch | Solidity testnet escrow if time remains                                                              |

## 14. Submission checklist

- [ ] Coding agent connected to AWS, proof saved
- [ ] Public URL live and tested from a logged-out browser
- [ ] Category and lane tags on the Builder Center project
- [ ] README: process, agent contribution, architecture, cost per case
- [ ] 3-minute demo video
- [ ] Bias-eval results published
- [ ] Synthetic benchmark documented as synthetic
