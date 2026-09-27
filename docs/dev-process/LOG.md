# Dev Process Log

## Phase 1: Repo Initialization
- Checked AWS credentials to ensure no root usage.
- Initialized monorepo with `npm` workspaces.
- Moved and renamed PRD/TRD specs as requested.
- Created empty CDK stacks for all services.
- Created `services/shared/hashing.ts` with correct ledger hash sequence `sha256(prevHash|event|amountCents|caseId)`.
- Verified AWS access to Bedrock models and updated `WorkflowStack` IAM permissions to include model inference profile ARNs.
- Updated `CONTRACTS.md` and committed changes to `a/chore/init` branch.

## Phase 2: Infra and Step Functions Contracts
- Deployed DynamoDB tables, KMS keys, S3 buckets, and Cognito in CDK.
- Connected Amplify Hosting via GitHub PAT (stored in Secrets Manager).
- Created Step Functions IO contracts in `services/shared/step-functions.ts` for all workflow steps (intake, blind, judge, crossExam, swapTest, aggregate, presiding, publish, settle, notify) and exposed an `invokeJudgeModel` helper.
- Documented contracts in `CONTRACTS.md` and `step-function-input.json`.

## Phase 3: API and Ledger Implementation
- Built API Gateway REST API with standard HTTP endpoints mapped to Lambdas.
- Implemented `services/shared/ledger.ts` with state machine constraints and DynamoDB `TransactWriteItems`.
- Created API endpoints for `POST /cases`, `POST /cases/{id}/fund`, `POST /cases/{id}/dispute`, `POST /cases/{id}/evidence`, `POST /cases/{id}/submit`, and public stubs.
- Wrote S3 Event Lambda to compute SHA256 of uploaded evidence files.
- Completed unit tests for ledger transitions and hash integrity.
- Ran integration tests confirming the API creates a case, performs transitions, and computes the S3 hash correctly.

## Phase 4: Frontend (Piyush, branch `p/feat/web-frontend`, 2026-09-26)
**Built:** the Next.js `web/` app from the README frontend handover. It is a static export for the Amplify WEB platform:
- Pages: landing with "Run demo case", sign in / sign up / email confirmation, my cases, new case, case workflow (fund, dispute, evidence upload, submit, live polling), public ruling page.
- Amplify Auth is configured from `NEXT_PUBLIC_*` env vars. Sign-in forces `USER_PASSWORD_AUTH`, because the Cognito app client does not enable SRP (Amplify's default).
- Every protected call sends the Cognito ID token.

**What the agent (Claude Code) did:**
- Audited the repo first. It found that CI typecheck failed (11 errors) and that the ledger used a nonexistent `CaseStatus.RESOLVED`: RESOLVE returned `undefined`, and the tests passed only because `undefined === undefined`.
- It also found gaps that would have broken the deployed frontend:
  - API CORS allowed only `http://localhost:3000`.
  - The evidence bucket had no CORS rule, so browser uploads to presigned URLs would fail.
  - The Amplify app had no API/Cognito settings.
  - `GET /rulings/{id}` returned an empty body.
- Fixed these in separate commits for review (ApiStack, DataStack, WebStack, `amplify.yml`, shared ledger/helpers, public stub).

**Checks run:**
- CI steps: lint, typecheck, tests (10 shared + 50 web unit tests), `cdk synth`. The synthesized templates were inspected for the CORS, S3 and Amplify changes.
- A fresh-clone build using the `amplify.yml` commands. It caught a workspace-filtered install that silently typed shared imports as `any`; fixed.
- Chrome end-to-end, 39 checks, against a stand-in API (same responses as the Lambdas, real shared ledger code), a stand-in S3 that enforces CORS and the presigned content type, and a Cognito stand-in that rejects SRP. Covered: sign-up/confirm/sign-in, create → fund → dispute → upload → submit → polled ruling, token on every call, 401 handling, a mobile layout check.
- Chrome against the live API and real Cognito endpoint, 6 checks: health, demo, ruling, login redirect, Cognito round trip.

## Phase 5: Production pass on the frontend (Piyush, same branch, 2026-09-26)
**Built:**
- **Design system:** self-hosted Fraunces and Inter, AA-contrast light and dark themes, icons, a logo mark with five seats.
- **Pages:** a redesigned landing page, split-layout login with live password rules, a two-column case page with confirmation dialogs and drag-and-drop evidence, and the ruling as a formal award. Also skeleton loaders, an error boundary, a 404 page and a mobile menu.
- **Hardening:** 20 s request timeouts, one retry for reads (never for writes), no server internals in errors, double-submit guards. "My cases" refreshes statuses from the API.
- **Security headers:** CSP, HSTS, frame DENY, nosniff and referrer policy on the Amplify site, via `WebStack` and `web/security-headers.json`.

**What the agent did:**
- Wrote 224 new unit and component tests (274 in total).
- Grew the browser suite to 95 checks, run in Chrome and Edge. It covers axe WCAG 2.1 AA scans in both themes, keyboard-only use, a CSP-violation monitor, slow/failing/offline APIs, conflicting edits from two browsers, XSS and malformed IDs, S3 rejections, mobile layout and performance budgets.
- The tests found and drove fixes for:
  - low-contrast buttons (3.4:1 → 5.2:1);
  - a 1 bps award displayed as "0.0%";
  - duplicate confirm buttons in the page;
  - "My cases" showing stale statuses;
  - the modal dialog not centred in Chrome.
- Published a screen gallery (light, dark, phone) for review.

**Checks run:**
- lint, typecheck, 284 tests and `cdk synth`, all from a fresh clone.
- 95/95 browser checks in Chrome and in Edge.
- 6/6 checks against the live AWS API.
- Measured: landing JS 188 KB gzipped, fonts 83 KB, local LCP about 250 ms.

**Not yet done / next:**
- Arshvir: review, merge and run `cdk deploy --all` so the CORS, S3, Amplify env and security-header changes go live. Then merge to `main` for the first Amplify build.
- A signed-in run against the real Cognito pool needs the app client ID (SSM `/panch/auth/userPoolClientId`), which this machine could not read.

## Phase 6: Workflow Stubs and State Machine (Arshvir, branch a/feat/day2-workflow, 2026-09-26)
- Created stub handlers for all Step Functions tasks (intake, blind, judge 1-3, crossExam, swapTest, aggregate, presiding, publish, settle, failHandler).
- Built the Tribunal Step Functions state machine in \WorkflowStack\ utilizing the stub Lambdas, a Parallel state for the three judges, and a Choice state for escalation.
- Added a \failHandler\ lambda as a Catch path fallback to serve cached rulings for demo cases.
- Wired \POST /cases/{id}/submit\ and \POST /demo/run\ to \StartExecution\ via \ApiStack\.
- Updated \GET /cases/{id}\ to return the Step Functions execution status and current stage by pulling history from \DescribeExecution\ and \GetExecutionHistory\.
- Added new API endpoints: \GET /reviews\, \POST /reviews/{caseId}\, \GET /rulings\, \GET /rulings/{id}\, \GET /rulings/{id}/verify\.
- Added unit tests for the stub handlers and the reviews API, ensuring Vitest covers the fallback and escalation behaviors.

- Fixed missing CloudFront OAC for the rulings bucket, API Gateway throttle for /demo/run, and DynamoDB daily cap for demo runs.

### Day 2 Verification Notes
- **Check 5 (Escalation/Review)**: Validated via a manual DynamoDB status override plus direct Lambda invoke rather than an organic escalation and a real authenticated API call. This ensures honest documentation.

## Phase 7: Tribunal judges (Rutu, branch `r/feat/judges`, 2026-09-26)
**Built:**
- Added the blind-case pipeline entry point in [services/tribunal/blind.ts](services/tribunal/blind.ts) to anonymize party names, countries, and platform references before judge review.
- Added the judge handler implementations in [services/tribunal/judges/judge-1.ts](services/tribunal/judges/judge-1.ts), [services/tribunal/judges/judge-2.ts](services/tribunal/judges/judge-2.ts), and [services/tribunal/judges/judge-3.ts](services/tribunal/judges/judge-3.ts).
- Added prompt files in [services/tribunal/prompts/judge-1.md](services/tribunal/prompts/judge-1.md), [services/tribunal/prompts/judge-2.md](services/tribunal/prompts/judge-2.md), and [services/tribunal/prompts/judge-3.md](services/tribunal/prompts/judge-3.md).
- Added shared judge sanitization utilities in [services/tribunal/judges/shared.ts](services/tribunal/judges/shared.ts) to enforce evidence-backed findings before returning the structured output.
- After syncing with `main`, handlers were relocated onto main's canonical stubs paths (services/tribunal/stubs/) so the state machine and unit tests keep working; the old-path files were removed.

**Checks run:**
- Installed workspace dependencies with `npm install`.
- Verified type safety with `npx tsc --noEmit` — this completed successfully with no TypeScript errors.
- Attempted the required AWS validation command `aws sts get-caller-identity` and the SSM model-ID fetches before any Bedrock call, but the local environment does not have an active AWS profile/configured SSO session. The call remains blocked until the `panch` AWS login/profile is available in this shell.

**Session 2 update (sync + retest, same day):**
- Synced with `main` (Day 2 workflow stubs): relocated the real blind and judge handlers onto main's canonical `services/tribunal/stubs/` paths (`blind.ts`, `judge-1.ts`, `judge-2.ts`, `judge-3.ts`, shared utilities in `judgesShared.ts`), deleted the old-path duplicates, and adopted main's `panch-evidence/{caseId}/blinded.json` key template. Tightened evidence-ID sanitization: when the blinded case file lists real evidence IDs, findings may only cite those (the `e-*` prefix fallback now applies only when no ground-truth IDs exist).
- No conflicts in `services/shared/` or `infra/` (auto-merged); sole conflict was `docs/dev-process/LOG.md` (both branches appended a Phase 6 entry; kept both, renumbered this entry to Phase 7).
- Fixed pre-existing breaks that came in from main: `services/api/cases.ts` null-guarded `stateEnteredEventDetails`, and web learned the new `CaseStatus.FAILED` (actions, label, step rendering) — typecheck, lint, and all 295 tests now pass.
- Re-attempted AWS validation, still blocked: `aws sts get-caller-identity` → exit 127, the AWS CLI is not installed on this machine; probing SSM through the project's own SDK (`@aws-sdk/client-ssm`) returns `CredentialsProviderError: Could not load credentials from any providers`. No `~/.aws/credentials`, no `~/.aws/config`, no `AWS_*` env vars on this machine.

**Current blocker:**
- Bedrock validation (steps: SSM model-ID reads, per-judge Bedrock runs, schema + evidence-citation checks, end-to-end execution) has **not** run and **nothing is validated**. It stays blocked until this machine is authenticated to AWS (e.g. `aws sso login` with the panch profile, or provisioned credentials). Per session rules, no validation results are logged until `aws sts get-caller-identity` actually succeeds.
## Phase 8: Demo ship gate — public demo polling, real publishing, live auth proof (Arshvir, 2026-09-27)
**Built (branch `a/fix/demo-public-polling`, merged as PR #7 after PR #6 unblocked CI):**
- `CaseItem.isDemo` (set only by `POST /demo/run`): `GET /cases/{id}` stays a public method so the ship gate (PRD F10) works logged out, but the Lambda enforces the scope — demo cases return a trimmed projection (no party identifiers); every other case requires a valid Cognito ID token (`aws-jwt-verify`), restoring the previous Cognito behavior for real disputing parties.
- `publish.ts` now actually writes `panch-rulings/{caseId}/ruling.json` (median judge output, parseRuling-compatible) to the SSE-KMS rulings bucket (s3+kms grants added); `GET /rulings/{id}` proxies the real ruling JSON via CloudFront per the frozen TRD contract (was a placeholder URL).
- Fixed the AGGREGATE `payloadResponseOnly` data flow so PUBLISH/SETTLE receive `finalPanelOutputs`/`payeeShareBps`; corrected the GetCase SFN policy to execution ARNs (`Arn.format` + `Fn.split` — a lazy-token string replace had silently produced a useless resource) so `currentStage` works.

**What the agent did:**
- PR #6: removed the duplicated `benchmarkBucket` declaration from `DataStack.ts` (introduced in b591355) plus the `stateEnteredEventDetails` guard and web `FAILED` status-map entries — CI was red on main since Day 2 and this made it green again.
- Added an auth-matrix unit suite for `GET /cases/{id}` (demo anon 200 trimmed; real case anon/junk 401; real case valid token 200 full; legacy items without the flag 401).

**Checks run:**
- CI green on PRs #6 and #7 (lint, typecheck, 302 tests, cdk synth); deployed `PanchApiStack`/`PanchWorkflowStack` from the branch, then redeployed from `main` after the merge (a326b24).
- Live, logged out: `POST /demo/run` → `GET /cases/demo-0d149a04` polls to SETTLED (stage PUBLISH, party fields absent) → `GET /rulings/demo-0d149a04` 200 with a parseRuling-valid body → CloudFront `panch-rulings/demo-0d149a04/ruling.json` 200.
- Live negatives: real cases `c-8cf694fc`, `c-9d74f151`, `c-escalated-1` without auth → 401; junk bearer → 401.
- Live authenticated check: signed in as the existing test user owning `c-8cf694fc` (`initiate-auth` USER_PASSWORD_AUTH after `admin-set-user-password`, same flow as the earlier sign-up/confirm testing) and called `GET /cases/c-8cf694fc` with the ID token as Bearer — HTTP 200 with the **full** body (`claimantId`/`respondentId` present), while the same request without a token returns 401.

**Honest caveats:**
- Demo cases created before the `isDemo` deploy (e.g. `demo-ddd2cc80`) have no flag and now correctly 401 logged out; only fresh demo cases are public.
- The deployed tribunal still runs stub judges (PR #4 not merged yet), so published ruling bodies are the median stub output until that lands.
## Phase 9: PR #4 merge + live real-judge validation + first-deploy production fixes (Buffy/agent, 2026-09-27)
**Merge & deploy (user-approved sequence):**
- Merged PR #4 (`r/feat/judges` -> `main`, merge commit `cef6cdb`); branch deleted on origin and locally.
- `cdk deploy --all` green on all 6 stacks; `PanchWorkflowStack` carried the real judge handlers into the deployed state machine for the first time.

**First live run surfaced four production gaps, all fixed and redeployed:**
- Judge prompts were `readFileSync`'d from `../prompts/judge-N.md` at module load, but the bundled Lambda is a flat `index.js` -> `ENOENT /var/prompts/judge-2.md`, hard-failing all three judges on every case. Fix: esbuild text loader (`bundling: { loader: { '.md': 'text' } }` in `WorkflowStack.ts`) + `import ... from '../prompts/judge-N.md?raw'` inlines prompts into the bundle; vitest still reads the source tree.
- `blind.ts` computed the blinded case file but never wrote it to S3; `judgesShared.loadBlindedCaseFile` silently fell back to an empty placeholder (judges would deliberate over nothing). Fix: blind.ts `PutObject`s the blinded file; judges load it from S3 (`GetObjectCommand`, `s3://` or `BUCKET`-relative); the silent fallback is gone — a missing file now fails loudly.
- Every tribunal Lambda lacked `kms:GenerateDataKey`/`Decrypt` (SSE-KMS buckets) and `ssm:GetParameter` for `/panch/models/*`; judge-3's `us.meta.llama3-3` inference profile also needs destination-region model grants. Fix: `grantEncryptDecrypt` per Lambda, scoped SSM statement, `us-east-2`/`us-west-2` foundation-model resources.
- `swapTest.ts` was a hardcoded fixture (`payeeShareBps: 0`, identical for all judges) -> the aggregate mirror-check read inconsistent on any real panel and escalated 100% of cases; PRESIDING/PUBLISH never ran. Fix: swap test is now a real mirrored Bedrock judgment (counterfactual role-reversal preamble; Mistral/Llama inverted to 0 as expected, Nova muddled but median absorbs it).

**Demo substance:** `demo.ts` seeds the demo contract text to `panch-evidence/{caseId}/extracted/e-1.txt`; `blind.ts` inlines each evidence item's `extractedTextKey` content into the blinded case file. Real judges now rule on terms (clauses 3.1/3.2/4.1/4.2), not an empty record. `intake.ts`'s fabricated e-1 pointer finally has a referent.

**Live logged-out proof (fresh deploy, real Bedrock, no stubs anywhere):**
- `POST /demo/run` -> `demo-9e86d8c0`; ~18s to `SETTLED` (`currentStage: PUBLISH`, 12 real model calls: 3 judges + 3 cross-exam + 3 swap + presiding path).
- Panel: unanimous 10000/10000/10000 (spread 0, swapConsistent true) — distinct per-model reasoning, all citing the contract correctly.
- `GET /cases/demo-9e86d8c0` no auth -> 200 trimmed; `GET /rulings/demo-9e86d8c0` no auth -> 200 real ruling; CloudFront `panch-rulings/demo-9e86d8c0/ruling.json` -> 200 with the published body (median judge = Mistral: 8 findings, computed due-date, breach conclusion).
- 401 regression: `c-8cf694fc`, `c-9d74f151` no auth -> 401; junk bearer -> 401; demo case -> 200. Unbroken.

**Checks:** `tsc --noEmit` clean, 302/302 tests pass (tribunal 10, shared 4, api 10, web 278).

**Honest caveats:** earlier failed demos (`demo-8a993b5e`, `demo-af534c39`, `demo-ceaad0bd`, `demo-268a6849`) marked FAILED in the table are the pre-fix runs; `demo-e961fd80` is ESCALATED (fixture swap test + empty evidence, both since fixed). The swap preamble is a counterfactual instruction, not a mechanical relabel — on a blinded record, relabelling identical labels is a no-op and naive string swaps leave the narrative bound to the original labels.

## Phase 10: audit findings - known limitations (documented for README/pitch, deliberate scope cuts, not bugs to fix)

**Swap-test consistency is median-blind.** `swapConsistent` compares the panel median award against `10000 - mirroredMedian`, so an individual judge whose mirrored ruling inverts poorly is absorbed by the median instead of flagged. Observed on a deliberately balanced fixture (c-ambig-5b05407f: late delivery + undefined "acceptance" + 6-week campaign launch on the deliverable): the original panel split 5000/10000/10000 (spread 5000 -> correctly escalated to human review), and all three mirrored rulings returned 0 - the mirror inverted cleanly - yet judge-1 original 5000 vs its own mirrored 0 is a 5000-bps mirror deviation that the median check scored as fully consistent. Per-judge mirror deviation exists in the execution history but is never aggregated.

**Positional bias under the counterfactual swap.** On the same balanced fixture, judge-1 (Nova) accepted conduct-based acceptance in the original run ("launching the campaign with the deliverable... can be interpreted as acceptance in substance", 5000) then denied the identical reasoning in its mirrored run ("this does not constitute formal acceptance", 0) - the model contradicted its own reading of the same facts when told the party roles were reversed. The counterfactual swap framing measurably biases models toward the conservative literal interpretation. The mirroring logic does produce genuine self-disagreement on ambiguous cases; that signal is currently unused (see the median-blindness limitation above).

Both findings are real, reproducible, and intentionally left unfixed for the hackathon window; they belong in the pitch as honesty about the bias-eval surface (P1 bias-eval dashboard is the designed home for them).

## Phase 11: Day 3 hardening — cost tracking, observability, security pass, edge-case proof (Arshvir + agent, branch `a/feat/day3-harden`, 2026-09-27)

**Cost tracking (P0 deliverable)**
- `services/shared/cost.ts` (per-model CaseUsage, SSM-priced `computeCaseCostUsd`) + `services/shared/metrics.ts` (zero-dep EMF `emitMetric`/`timed`).
- `models.ts` records real Converse `res.usage` + guardrailConfig on every judge call; handlers thread `modelId`/`usage`; the state machine carries them into AGGREGATE, which prices the case from `/panch/pricing/bedrock/*` and emits Panch.BedrockTokens per stage/model.
- **Three real bugs this uncovered and fixed:** (1) PrepareAggregate referenced `$.crossExamOutputs[N].modelId`, which the pass-through crossExam never produces — usage now threads from `$.judges[N]`, captured in PrepareCrossExam because that Pass replaces the state input (its own hard-won lesson: a Pass without `resultPath` discards everything not re-emitted). (2) Llama json mode returned `confidence: 90` (0–100 scale) and failed z.max(1) after 3 retries — models.ts now normalizes 1<x≤100 to x/100 before schema.parse (documented as model-output normalization, not free-text parsing). (3) PRESIDING (payloadResponseOnly, deliberately untouched — Rutu's lane) dropped `usage`/`costUsd`; fixed with a PRESIDING `resultPath` + MergePresiding pass in the state machine.
- **SETTLE silently swallowed its errors** (`catch → return settled:true`): combined with my IAM tightening removing Settle's implicit `dynamodb:UpdateItem`, a denied RESOLVE transaction looked like a green run (execution SUCCEEDED, case stuck DELIBERATING, no ledger rows). Fixed both: explicit `UpdateItem` grant (a transaction's Update checks the per-item permission) and settle.ts rethrows. publish.ts is now idempotent (ConditionalCheckFailed on the Rulings put → already-published success) so FAILED→resubmit runs cannot dead-end on a stale record.
- **Real case cost (live):** `demo-1f52f83f` — 9,390 tokens (6,659 in / 2,731 out) across Nova Pro (3,182), Mistral Large (3,496), Llama 3.3 70B (2,712) = **$0.02460304** per case, ~2.4¢ per 12 real Bedrock calls. Verified against SSM prices by hand; served on `GET /rulings/{id}` (`costUsd`, `usageSource: "bedrock-converse"`) and in the gallery.

**Observability (ObsStack)**
- Dashboard `Panch-Demo` (executions started/succeeded/failed, stage durations, AWS/Bedrock + Panch.BedrockTokens, throttles, DemoRuns, API 5xx, ReviewActions, CloudFront requests), SNS topic `panch-alarms`, 3 alarms (failed executions ≥1, API 5xx ≥5, Bedrock throttles ≥1). X-Ray ACTIVE on every Lambda + state machine `tracingEnabled` (verified XRAY TraceId in judge REPORT lines).

**Security pass → `docs/SECURITY.md`**
- Removed the state machine role's wildcard `dynamodb:*/s3:*/textract:* on *`; every Lambda now has scoped grants (remaining `xray:*` is AWS-managed and unscopeable — documented). Benchmark bucket moved to SSE-KMS. Secrets scan of tree + last 60 commits: clean (only empty `web/.env.example` tracked). Guardrail saga from the earlier session recorded: PROMPT_ATTACK false-positives on the judges' own instructions (removed; structural injection defense instead) and immutable guardrail versions now carry a config-hash logical id.

**Edge cases (all live, logged out unless noted)**
- Duplicate submit: sequential → 200 then 400 (`current status: DELIBERATING`); 4 concurrent on a DISPUTED case → exactly one 200, three 400 (conditional-write guard).
- Reviews: `payeeShareBps` 1.5 / 10001 / true → 400; double review → first 200 SETTLED, second 400 (precheck) with 409 race branch unit-tested.
- Forced failure (SSM `/panch/models/judge-1` → bogus id): Catch → FAILED fires within seconds; **two gaps found and fixed**: (a) the fallback ruling copy targeted the evidence bucket, while CloudFront serves the rulings bucket — failHandler now copies into RULINGS_BUCKET (grant + env added); (b) nothing ever seeded `bench/demo/{caseId}/fallback-ruling.json` — demo.ts now seeds it per run. Re-tested: CloudFront serves the fallback ruling (HTTP 200, `fallback:true`), ledger count 0 (escrow untouched). SSM restored exactly to `amazon.nova-pro-v1:0` (v3, verified).
- FAILED→resubmit: c-6936d0a5 went FAILED → resubmit 200 (conditional repair to DISPUTED→DELIBERATING, new executionArn) → escalated. Full lifecycle exercised.
- **Escalation was invisible**: the Route→ESCALATED branch ended in a Succeed state without touching the case row, so escalated cases stayed DELIBERATING and never reached `GET /reviews` (which scans status=ESCALATED). New EscalateLambda (conditional DELIBERATING→ESCALATED, idempotent) verified live: case ESCALATED, review queue lists it.
- **Gallery was structurally empty**: it scanned Cases for status RULED (transient between RESOLVE and RELEASE). Now reads the Rulings table directly (also drops its now-unneeded Cases read grant).
- Documented, not implemented (honest gaps in `docs/SECURITY.md` + risk list): `evidenceDeadline` unenforced (post-submission presigned URL confirmed live — P1), no respondent timeout, `verifyRuling` still a dummy stub.

**Ship-gate proof ×3 (logged out, real Bedrock, distinct rulings)**
- demo-1f52f83f: SETTLED, payee 10000, 9,390 tok, $0.0246, distinct reasoning (numbered contract citations)
- demo-abf1518d: SETTLED, payee 10000, 9,641 tok, $0.0261, distinct reasoning (dated delivery account)
- demo-1871cf04: SETTLED, payee 10000, 9,621 tok, $0.0254, distinct reasoning
- CloudFront direct: all three `panch-rulings/{id}/ruling.json` → 200 application/json. Gallery `GET /rulings` → 4 published rulings with cost records. Two additional runs escalated (Nova returned 5000 bps against one-sided facts — spread 5000 → correctly routed to human review; the split-guard works, and per Phase 10 this is documented model variance, not a defect in the routing).
- Fresh-checkout test: clean clone → `npm ci` (474 pkgs) → `tsc --noEmit` clean → `cdk synth` all 6 stacks. Root tsc + lint + 278/278 tests green on the branch; all stacks deployed.

**Risk list for judging day (ship gate)**
1. Nova award/reasoning variance → ~40% of demo runs escalate to human review instead of publishing (mitigated: escalation is correct behavior, review queue works; talking point, not a blocker).
2. `verifyRuling` stub (dummy hashes) — must not be demoed as a trust feature until wired to the real chain (explicit talking point).
3. `evidenceDeadline`/respondent timeout unimplemented (P1; documented).
4. Guardrail PROMPT_ATTACK disabled by design (false-positives on own instructions) — structural injection defense documented in SECURITY.md.
5. `xray:*` wildcard (AWS-managed policy shape) — documented, accepted.
6. Pre-fix rulings row demo-058f005e has tokens 0/cost null (honest artifact of before the pipeline; keep as history).
