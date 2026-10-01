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

## Phase 12: real presiding arbitrator synthesis (Buffy/agent, branch `r/feat/presiding`, 2026-09-27)
**Built:**
- `presiding.ts` is no longer the median relay. It loads the blinded case file from S3, builds a full deliberation record (each judge's complete ruling in `<judge-ruling>` tags plus the `<evidence>` envelope; the aggregate median is deliberately withheld so the award is not anchored on it), and invokes Bedrock through the shared wrapper with role `presiding` (model + mode from `/panch/models/presiding[-mode]`; tool mode with a forced `submit_ruling` tool).
- Output is validated by the shared wrapper (schema.parse, retries on invalid output) and then re-sanitized with the judges' evidence-citation gate (`sanitizeJudgeOutput` reused, not rebuilt): findings citing evidenceIds absent from the case file are dropped before the ruling is returned.
- The synthesis is returned as `PresidingOutput.ruling` (new optional field in `step-functions.ts` — the only shared-contract change, submitted for review per the CONTRACTS.md rule) and as `payeeShareBps`: the award now comes from the presiding synthesis, not from `medianPayeeShareBps`.
- `publish.ts` publishes `event.ruling` when present (findings/clauses/reasoning/confidence/uncertainties, award taken from the ruling body so the published number matches the published reasoning); the median fallback remains for the Catch -> FAILED path.
- Prompt in `services/tribunal/prompts/presiding.md` (inlined via the `?raw` esbuild pattern): requires engaging with at least two judges by name, explicit resolution of disagreements, evidenceId-only citations, and an independent award.

**Checks run:**
- New tests: `presiding.test.ts` (wrapper called with role `presiding` and all three full judge rulings; median withheld from the prompt; synthesized award replaces the relay; fabricated evidenceIds dropped by the reused gate), `presiding.retry.test.ts` (the REAL shared wrapper over mocked AWS SDK: invalid output is retried and raw text can never pass through; 3 attempts then throw), `publish.test.ts` (synthesis preferred; median fallback intact).
- `npm run typecheck` clean; full suite **311/311** (shared 10, tribunal 13, api 10, web 278); `npm run synth` green (esbuild bundles the new prompt + handler).

**Blocked — live Bedrock validation not run (this session has no AWS credentials):**
- The restarted session has no AWS access: the `aws` CLI is absent (exit 127) and probing through the project's own SDK returns `CredentialsProviderError: Could not load credentials from any providers` for both SSM GetParameter and Bedrock Converse (us-east-1). No `AWS_*` env vars, no `~/.aws/credentials`.
- Therefore NOT done and NOT claimed: running presiding against a real case with real judge outputs, capturing the actual model call and raw response, quoting multi-judge reasoning sentences from a live synthesis, the `start-execution` end-to-end run to SETTLED, and confirming the published ruling is the synthesis. The unit tests use mocked AWS layers — they prove wiring and validation logic, not live model behavior.
- To finish once credentials are available: run the presiding validation against real SSM/Bedrock, then one `aws stepfunctions start-execution` on the deployed `TribunalStateMachine` and confirm SETTLED with the published body equal to the synthesis.
## Phase 13: Human review queue UI (Piyush, branch `p/feat/reviews-ui`, 2026-09-27)
**Built:** the `/reviews/` page from TEAM_PLAN section H, behind the normal sign-in:
- It lists ESCALATED cases, oldest first. Each shows the summary, amount and escalation reason; the panel median, spread and swap-test verdict; and the three judges side by side (award, confidence, reasoning, cited findings, clauses, uncertainties).
- The decision form takes the claimant's share (sent as `payeeShareBps`) and a required note. It offers quick-fill buttons (median, each judge, even split) and a live money split. A confirmation step comes before `POST /reviews/{caseId}`.
- There is a "Reviews" link in the header for signed-in users.
- Scope cut, shown on the page and in the README: any signed-in account can review. A reviewer who is a party to the case is warned. Party identities are never shown.

**What the agent (Claude Code) did:**
- Read the contracts first (`services/api/reviews.ts`, `step-functions.ts`, the escalated fixture). Because `GET /reviews` is still being built, it wrote a reader that accepts every shape the contracts allow and says plainly when a part is missing.
- Added a per-judge swap check: it maps each swap award back (`10000 − award`) and flags a judge whose winner changes sides. This surfaces the median-blind swap limitation from phase 10 to the reviewer, without changing the backend.
- Wrote 131 new tests (409 web tests in total):
  - every response shape, the swap maths, percentage parsing and money rounding;
  - the API client: auth, one retry for reads, never retrying the POST;
  - the page: validation, confirmation, double-submit, a case another reviewer already resolved, failed saves that keep the form, hostile text, and signed-out access.
- Checked with deliberate breakages that the conflict and double-submit tests fail when those guards are removed.
- Added a 65-check browser suite, run in Chrome and Edge against a stand-in API that settles through the real shared ledger rules. It covers the full lifecycle (create, fund, dispute, submit, escalate, review, SETTLED with RESOLVE and RELEASE in the ledger), two reviewers racing, 503/500/offline/401 handling, keyboard-only use, axe WCAG 2.1 AA in light and dark (0 issues), phone layout, XSS and CSP.
- The scan caught one real bug (captions inside a `<dl>` group that were not `<dt>`/`<dd>`), which was fixed. Screenshot review led to a spacing fix and a clearer swap-test label.

**Checks run:** lint, typecheck, all tests (409 web, plus shared and tribunal), `next build`, `cdk synth`; both browser suites (65/65 and 95/95) in Chrome and Edge. Live API: `GET /reviews` and `POST /reviews/{id}` are deployed behind the Cognito authorizer, answer a CORS-readable 401 without a token, and pass the POST preflight.

**Backend gaps found (Arshvir's area, not changed here):**
1. Nothing sets a case's status to `ESCALATED` or saves the panel record when the workflow escalates. `ESCALATED` is a `Succeed` state in `WorkflowStack`, so escalated runs never reach the queue.
2. `GET /reviews` returns placeholder panel data (`{ spreadBps: 5000, judges: [] }`). It needs the judges' outputs, swap runs, median, `swapConsistent`, `escalationReason` and a summary. The shapes the UI reads are listed in the README.
3. `POST /reviews/{caseId}` does not validate `payeeShareBps` (integer 0-10000) or the note. It does not write the `Rulings` entry with `humanReviewed: true` and the note, and it uses a hardcoded ledger `seq`/`prevHash`.
4. It returns `status: "SETTLED"`, while TEAM_PLAN says `"RESOLVED"`. The UI accepts either.

**Status of the backend gaps above, as of the merge with main (Arshvir):**
1. Escalated runs now reach the queue: PR #11 added the ESCALATE task (conditional DELIBERATING -> ESCALATED, idempotent) and it is verified live — see Phase 11.
3. Partially fixed in #11: `payeeShareBps` validation (400 on non-integer/out-of-range) and the double-review guard (409 via the ledger conditional) are live. Still open: note validation, the `Rulings` entry with `humanReviewed: true` + note, and the mock ledger `seq`/`prevHash`.
2 and 4 unchanged: `GET /reviews` still returns placeholder panel data (the UI's missing-data states will show until that lands), and the SETTLED/RESOLVED naming difference is accepted by the UI.

## Phase 14: full panel record on the review queue + real ruling verification (Arshvir/agent, branch `a/feat/panel-record-verify`, 2026-09-28)
This closes gap 2 from Phase 13 and risk 2 from the Phase 11 risk list. Both endpoints now serve recomputed, case-specific data; neither fabricates.

**Built — the review queue carries the real panel record (TRD section 8.7):**
- `aggregate.ts` now returns `swapOutputs`. The per-judge swap runs existed in the execution but were dropped before AGGREGATE's output, so the queue could never show them. `AggregateOutput.swapOutputs` added to the shared contract; `MergePresiding` forwards `'swapOutputs.$'` so the value survives the presiding merge.
- `escalate.ts` persists `panelRecord = { judges, swapOutputs, aggregate: { medianPayeeShareBps, spreadBps, swapConsistent }, escalationReason, escalatedAt }` onto the case row in the *same* conditional `DELIBERATING -> ESCALATED` update, so a row can never be ESCALATED without its panel record. Idempotent on retry, as before.
- `getReviews` serves that record as `panelOutputs` (internal `panelRecord`/`executionArn` stripped from the response). Rows escalated before this deploy have no record, so it recovers the panel from the execution's `AGGREGATE` `TaskStateExited` output via `GetExecutionHistory`, marks `recoveredFromHistory: true`, and best-effort backfills the row. When recovery is impossible the case still lists with empty panel data — no invented values.

**Built — `GET /rulings/{id}/verify` recomputes for real:**
- Content: SHA-256 of the exact bytes CloudFront serves vs the `rulingSha256` that `publish.ts` now records over the published JSON at publish time.
- Ledger: the case's entries are queried, ordered by `seq`, and every `entryHash` is recomputed from `sha256(prevHash|event|amountCents|caseId)` — the same formula the ledger library wrote them with — with each link checked against its predecessor. Both genesis conventions in the ledger are accepted (`GENESIS` from the fund/dispute path, 64 zeros from the demo settle path). A non-escalated chain must end at `RELEASE`.
- `match` means *fully verified* (content AND chain). A ruling published before hash signing existed reports `match: false` with `content.match: null` and a `reason` spelling out that the content cannot be compared while the ledger was still verified independently — never a stub `true`.
- Design truth confirmed here: an ESCALATED case has no `Rulings` row at all (PUBLISH never runs on the escalation path), so verify answers an honest 404 rather than pretending. Escrow-untouched for those cases is shown by the review queue, not by a ruling verification.

**Bugs found while live-testing (both would have shipped silently):**
1. `states:GetExecutionHistory` was granted on the *state machine* ARN. The action authorizes against the *execution* ARN, so every recovery call was AccessDenied and silently swallowed by the recovery `catch` — the queue looked fine but showed empty panels. The first fix used `.replace()` on `stateMachine.stateMachineArn`, which is a no-op at synth time (cross-stack ARN tokens can't be string-manipulated); reading the synthesized template showed the grant resource rendering as `<machineArn>:*` and caught it before it shipped again. Fixed with the `Fn.select(6, Fn.split(':', arn))` pattern already used for the `GET /cases/{id}` grant.
2. The original `match: true` for a legacy ruling whose content could not be verified read as a stub `true` to any reviewer. Tightened as described above.

**Live evidence (real responses, production API + deployed stacks):**
- `GET /reviews` (Cognito ID token) → 200, 5 ESCALATED cases. Fresh post-deploy escalation `demo-df4844b8` returns three judges with real `payeeShareBps`/`confidence`/`reasoning` (e.g. judge-2: 10000 bps, 0.98, 8 findings), findings each citing `e-1`, `aggregate: { medianPayeeShareBps: 10000, spreadBps: 5000, swapConsistent: true }`, `escalationReason`, `escalatedAt`, and per-judge `swapOutputs` (all three present — threaded by this change). Legacy rows `demo-8d321dbb`, `demo-4faa0da8`, `c-6936d0a5`, `c-c3ab6359` come back through execution-history recovery with `recoveredFromHistory: true`, real judges and aggregate, and no `swapOutputs` (their executions predate the threading — stated honestly, not faked).
- `GET /rulings/demo-9bfae5c6/verify` → `match: true`, `content.verified: true`, `computedHash === storedHash === 2cfc59c6…`, ledger `chainValid: true`, `terminalOk: true`, `lastEvent: RELEASE`, both entries `valid: true`.
- Independent cross-check (separate script, not the API): fetched the same ruling bytes from CloudFront, hashed them locally → identical `2cfc59c6…`; queried the Ledger table directly and recomputed both entry hashes from the raw items → both match the stored `entryHash`, and the API's entries agree. The API is not echoing its own stored values.
- `GET /rulings/demo-34c23f2d/verify` (legacy row, pre-hash) → `match: false`, `content.verified: false`, `content.match: null`, `storedHash: null`, with the ledger chain still genuinely verified — the honest state, not a fake pass.
- Frontend, signed in as the synthetic test reviewer: `https://main.d1hm3x5hny8fjb.amplifyapp.com/reviews/` renders 5 cases with the real panel — awards, confidences, reasoning text, findings/clauses/uncertainties counts, panel median, spread and swap verdict per judge. `demo-df4844b8` shows "Swap test: Shifted · mirrored 100%, off by 50 pts" for judge-1 and "Consistent" for judges 2 and 3; the legacy rows show "No swap-test run for this judge." (true). "5 cases waiting", no placeholder panel data anywhere.

**Honest limitation found, not a defect to fix:** the case model has no summary/description field (`create` stores caseId, status, parties, amount, currency, createdAt). So there is no written case summary to send; the queue returns the case metadata and the UI's "No written summary was sent with this case" state is accurate. Adding a real summary field is a product decision, not a bug.

**Checks run:** 452 tests green (api 5 files/20, tribunal 4/13, shared 3/10, web 11/409) — including 10 new tests: `reviews-panel.test.ts` (persisted record served with internals stripped; legacy recovery + backfill; failed recovery lists with no lie) and `rulings-verify.test.ts` (GENESIS and 64-zero origins, content tamper, ledger tamper, escalated 404, legacy no-hash honesty, unpublished 404). `tsc --noEmit` clean (root + infra), `eslint .` clean, `cdk synth PanchApiStack PanchWorkflowStack` 0 errors. `PanchWorkflowStack` and `PanchApiStack` deployed (`--require-approval never`); `/demo/run`, `/reviews/` and the API verified live after deploy. Ship-gate checks: `/reviews` without a token → 401; landing page → 200; `/reviews/` → 200.

**Risk-list updates:** Phase 11 risk 2 (`verifyRuling` stub) is now resolved — verify recomputes for real and says so when it cannot. Remaining: risk 1 (Nova variance → escalations, unchanged and now fully visible in the queue), 3 (`evidenceDeadline`), 4 (guardrail choice), 5 (`xray:*`), 6 (legacy `demo-058f005e` row without a stored hash — now surfaced honestly by verify rather than hidden).

## Phase 15: demo benchmark cases A/B/C — built, gold-labeled, fallbacks cached (Buffy/agent, branch `r/feat/demo-cases`, 2026-09-28)
**Context read before building:** TRD §8/§13 (the "Workflow: integration runs on 3 demo cases" row), Phase 12 (presiding synthesis), Phases 13–14 (review queue + real verify). The Catch-path S3 location was taken from Arshvir's code, not guessed: `failHandler.ts` copies `bench/demo/{caseId}/fallback-ruling.json` to `panch-rulings/{caseId}/ruling.json` (and `demo.ts` seeds exactly that key with that field shape — `fallback: true`, zeroed award, escrow-untouched disclosure), so the cached files mirror that shape and location.

**Inventory before this change:** `bench/` contained only `package.json` — `bench/demo/` did not exist; nothing was mid-flight. Built from scratch on `r/feat/demo-cases`.

### Case A — `bench/demo/case-a/` (clear claimant win: non-payment after confirmed delivery)
- Built: contract + chat log + invoice, combined into `extracted-e-1.txt`. The real `intake.ts` emits a single `e-1` contract artifact at `panch-evidence/{caseId}/extracted/e-1.txt` and `blind.ts` inlines that extracted text, so one combined artifact per case is the format the live pipeline actually consumes; no extra evidence IDs were invented (the citation gate would drop them anyway).
- Contract text is verbatim `services/api/demo.ts` `DEMO_CONTRACT_TEXT` (demo.ts checked first per instructions; it fits Case A), so Case A doubles as the shipped public demo.
- Gold label fixed before any panel run: `goldPayeeShareBps: 10000` — clause 4.1 allows withholding only for non-conformity plus failed cure after written notice; the record shows confirmed receipt, a cosmetic tweak explicitly framed as "no formal notice", an admission the non-payment "is not about the work", and 45 days of silence. Divergence rule pre-declared in `gold.json` (settled < 8000 bps, or an escalation driven by a sub-5000 judge award on one-sided facts, is a finding, not a goalpost move).
- Real execution: **not run** — this session has no AWS credentials (SSM/STS probe: `CredentialsProviderError`). Nothing claimed.

### Case B — `bench/demo/case-b/` (clear respondent win: no delivery, sketches invoiced as a full fee)
- Built: contract (payment strictly after BOTH final deliverables, sketches explicitly not delivery, no-fee-if-undelivered clause), chat log (repeated requests for final files, invoice sent anyway), invoice conceding a "substantially complete" basis; combined into `extracted-e-1.txt` as above.
- Gold label fixed before any panel run: `goldPayeeShareBps: 0` — clauses 2.1/2.2/2.3 foreclose any award. This case is the citation-discipline test: the correct ruling must quote the contract against the claimant's own record. Divergence rule pre-declared (settled > 2000 bps is a finding).
- Real execution: **not run** — same credential blocker.

### Case C — `bench/demo/case-c/` (genuine split: partial delivery, disputed scope, contested hold)
- Built: contract (two-part 300+300 payment, per-week 10-point lateness reduction, a shared-responsibility asset clause with a 2.3 line making a hold the claimant's duty to discharge), chat log (on-time posts, 3-days-late videos, a genuinely contested photo/shot-list stall where both sides have a point), invoice with the claimant's own delivery accounting; combined into `extracted-e-1.txt`.
- Gold label fixed before any panel run: `goldPayeeShareBps: 5000` with computation `(300·1.00 + 300·(2/3)·0.90)/600 = 4800` rounded to the defensible anchor 5000, acceptable band 4000–6000, and **escalation expected by design** — this is the escalation-path demo feeding the Phase 13/14 review queue; a spread above the 3000 bps threshold here is correct routing, not divergence.
- Real execution: **not run** — same credential blocker.

### Fallbacks (all three cases)
- `fallback-ruling.json` (+ `ruling.md` mirror) per case at the confirmed `bench/demo/{caseId}/fallback-ruling.json` layout, `caseId` placeholder `REPLACED_AT_SEED_TIME` to be filled at seed time (per-run, same as demo.ts seeds per generated caseId). Shape mirrors demo.ts's seeded fallback exactly so `failHandler.ts`'s copy and the ruling page both work unchanged.
- Reachability against the deployed stack **not confirmed** (no credentials). The exact seed + `start-execution` + verify runbook is in `bench/demo/README.md` for the credentialed session; `caseId`s must be `demo-*` for the Catch path to engage.

**Checks run:** fixture consistency pass (clause numbering unique, dates and amounts coherent across contract/chat/invoice/gold); no application code changed on this branch, so the suite was not expected to move — `tsc --noEmit` clean and 452/452 tests green at the base commit (`27b851f`) earlier this session.

**Explicitly not started (per instructions):** the 30–50 case benchmark and the bias-eval dashboard — cut-list/P1.

**To finish when AWS credentials are available:** per case — seed evidence + fallback keys per the README runbook, `start-execution`, record the settled award vs `gold.json` (report divergences as findings), confirm the fallback is reachable under `panch-rulings/{caseId}/ruling.json` if the run fails, and log each result here.

## Phase 16: demo-case validation on the live stack + two fixes from the findings (Buffy/agent, on main, 2026-09-28)

Rutu's three bench cases were executed end to end against the deployed stacks
(account 890742603792, branch `r/feat/demo-cases` pre-merge, then the fixes on
main after PR #13 merged). All caseIds below are synthetic.

**Live results vs gold (before the fixes):**
- Case A (`demo-ba-a-354484`): SETTLED, award 10000 = gold 10000. Unanimous
  panel, spread 0, swapConsistent true; CloudFront bytes match `rulingSha256`;
  ledger RESOLVE->RELEASE; cost $0.0393 / 14,428 tokens.
- Case B (`demo-ba-b-a37b64`): panel unanimous 0 = gold 0, but the run
  ESCALATED twice. Root cause: the swap-test preamble asked what the mirrored
  claimant should be *paid*, so all three swaps returned 0 (the liability) and
  |0 - (10000-0)| = 10000 > 3000 flagged swapConsistent false. Also reproduced
  on the public path once (unanimous-award escalation).
- Case C (`demo-ba-c-d3ec86`): ESCALATED by design; panel median 5000 = gold
  5000, judges 5000/80/7000 (spread 6920), panel record persisted live.

**Fallback/Catch proof:** exercised twice organically (real ESCALATE failures)
and once by directly invoking the deployed FailLambda on a fresh case: the
fallback landed at `panch-rulings/{caseId}/ruling.json`, CloudFront 200, bytes
identical to the seeded fixture, `fallback: true`, escrow untouched. `ruling.md`
is 403 for every ruling (publish never writes it) — the fixture .md files are
currently dead weight; noted for Rutu.

**Bug found live (fixed this phase):** re-running a SETTLED case appended a
second RESOLVE/RELEASE pair (scratch case ended with 4 ledger entries).
`validateTransition` was never enforced inside `appendLedgerEntry`.

**Fixes (commits `1ca4a10`, `8c45e75`, deployed to PanchWorkflowStack +
PanchApiStack):**
1. Swap-test preamble now binds the answer to the claimant's KEPT share
   (10000 minus the payout to the performer), with the reasoning documented
   in-code. `aggregate.ts` was re-derived and is correct as-is (correction to
   the earlier session note).
2. `appendLedgerEntry` enforces `validateTransition` before the hash and the
   transaction; 3 new guard unit tests.

**Post-fix live proof:**
- Fresh Case B (`demo-ba-bfix-45a736`, seeded DELIBERATING like runDemo):
  SETTLED at 0 bps = gold. Swaps now 0/10000/10000 -> swapMedian 10000 ->
  swapConsistent true, escalated false. Presiding synthesis award 0 @ 0.98;
  $0.0315 / 13,781 tokens; verify match true.
- Re-run of the settled case: SETTLE now fails loudly - SettleLambda logged
  "Error: Double-resolve rejected at validateTransition", execution FAILED via
  Catch, ledger stayed at exactly 2 entries (was 4 on the unfixed stack).
- Public path logged out: one run ESCALATED (correct 404s, panel record live),
  one run SETTLED at 10000 with verify match true. 455 unit tests green
  (13 shared / 20 api / 13 tribunal / 409 web); eslint + cdk synth clean.

**Left as known follow-ups:** swap tests cost 3 extra Bedrock calls per case
and now agree with unanimous panels by construction - consider skipping them
when spread = 0 (cost, not correctness); case seeds must be DELIBERATING
before start-execution now that the ledger guard is strict (the bench README
runbook should say so); ruling.md is never published.

## Phase 17 — Human review API: real ledger chain, reviewer note, published human ruling

**What was broken (`postReview` in services/api/reviews.ts):** RESOLVE was
written with fabricated `seq: 10, prevHash: 'MOCK_PREV'` (RELEASE chained off
it), so human settlements were never part of the real hash chain and
`/rulings/{id}/verify` could not recompute them; the reviewer's note sent by
the /reviews UI was ignored; no Rulings row and no published ruling body, so
human-reviewed cases were invisible in the gallery and the public ruling page
404'd.

**What changed:**
1. Ledger chaining mirrors settle.ts: read the case's ledger head (max seq),
   chain RESOLVE at head+1 with prevHash = head entryHash, RELEASE after it.
   An empty ledger starts at the 64-zero genesis the verify path accepts.
2. The note is now required (1–1000 chars, mirroring the UI's
   MAX_NOTE_LENGTH) and becomes the published ruling's `reasoning`. Reviewer
   provenance is the opaque Cognito sub — no names on a public page.
3. After the ledger transaction commits, the human ruling is published like
   an AI ruling: `ruling.json` (`humanReviewed: true`, note as reasoning,
   `confidence: 1`, RELEASE entryHash) to the rulings bucket plus a Rulings
   row (rulingSha256, note, reviewerSub, published flag). A publish failure
   after settlement degrades to `published: false` + console.error — the
   escrow move is never rolled back and the double-settle guard is unchanged.
4. ApiStack: PostReviewHandler additionally granted Rulings table write,
   rulings bucket write and the KMS key (SSE-KMS PutObject).

**Verification:** services/api 28 tests (10 reviews), full suite 463 green;
eslint + tsc + cdk synth clean; PanchApiStack deployed (endpoint unchanged).
Live E2E (`scripts/tmp-validation/review-e2e.mjs`; seeded ESCALATED case with
real FUND/DISPUTE ledger entries + Cognito token): POST /reviews → 200 SETTLED
with entryHash; ledger 1:FUND, 2:DISPUTE, 3:RESOLVE, 4:RELEASE chainValid
true; Rulings row humanReviewed/hasNote/hasSha/published/reviewerSub all true;
CloudFront 200 with shaMatch true; `/rulings/{id}/verify` → match true
("recomputes clean from genesis"); second review rejected; public ruling page
renders the human ruling logged out.

**Flagged, not attributed:** mid-session, one verified E2E case's artifacts
(case row, rulings row, S3 object) were deleted externally while another
actor was deploying to the same account (CFN shows PanchApiStack updates at
14:01/14:52/14:58Z this session and a Workflow update at 14:00Z, plus a
foreign `hr-e2e-*` case this session's code did not create). No CloudTrail
trail exists to attribute the deletions. Worth a team conversation about
concurrent deploys to the shared dev account.

**Assumptions:** human rulings publish `findingsOfFact: []` and
`clausesRelied: []` — the note is the reasoning, nothing is fabricated;
`confidence: 1` because a human determination is final and the public ruling
contract (web/lib/ruling.ts) requires numeric confidence.

## Phase 18 — evidenceDeadline enforcement (the last open "immediate fix")

**What was missing:** `evidenceDeadline` was a stored-only field (PRD F1 lets
a deal carry a deadline; nothing honored it). No validation on create, no gate
on the evidence window, no overdue visibility.

**What changed (smallest honest enforcement, no invented policy):**
1. `POST /cases` (services/api/cases.ts create): `evidenceDeadline` is
   optional but when present must parse as ISO 8601 and be in the future
   (400 otherwise); stored normalized to ISO.
2. `POST /cases/{id}/evidence` (evidenceUrl): reads the case and returns
   403 "Evidence window closed" once the deadline has passed — the
   respondent's counter-evidence link (F3) expires with it. Cases without a
   deadline keep the open window. ApiStack: EvidenceUrlHandler gained
   CASES_TABLE env + read grant (its first DynamoDB use; caught live as a
   500 on the first E2E attempt, fixed before commit).
3. Hourly EventBridge sweep (PanchWorkflowStack): ResponseOverdueLambda scans
   FUNDED/DISPUTED cases past their deadline, sets `responseOverdue` +
   `overdueSince` with a conditional Update (a mid-sweep status change wins),
   and emits OverdueCases EMF metrics (per-case + sweep total) for the
   dashboard. Deliberately does NOT adjudicate, settle or fail overdue cases:
   auto-rules for party silence are a product decision, not a cron default.
   Deadline blocking of uploads is enforced at the API; the sweep is the
   overdue-visibility half.

**Verification:** 475 tests green (36 api incl. 8 new deadline tests, 17
tribunal incl. 4 sweeper tests); eslint, tsc, cdk synth clean. Deployed
PanchWorkflowStack + PanchApiStack (281 s). Live E2E
(scripts/tmp-validation/deadline-e2e.mjs): seeded DISPUTED case with deadline
2 min in the past -> manual sweeper invoke {scanned:2, flagged:1}, row gained
responseOverdue/overdueSince; evidence upload after deadline -> 403 window
closed; create with past deadline -> 400; future deadline -> 201 stored ISO.
Regression: create with future deadline then upload -> 200 presigned URL.
Rule live: rate(1 hour), ENABLED. Ship gates unchanged (landing 200, /reviews
200, demo ruling 200, reviews API 401-guard).

## Phase 19 — Concurrency hardening + ruling.md cleanup (Arshvir's remaining To-Dos)

**Why:** Phase 17 flagged that two actors deployed concurrently to the shared
dev account and a verified case's artifacts were deleted mid-session with no
way to attribute or recover them. The audit made fixing that Arshvir's only
open To-Do, plus the known `ruling.md` dead-weight cleanup.

**1. Recoverability — S3 versioning with noncurrent expiry:**
- RulingsBucket now `versioned: true` + 90-day noncurrentVersionExpiration.
  Published rulings are the product's source of truth; a delete/overwrite is
  now a recoverable shadow instead of a loss.
- EvidenceBucket (already versioned) gained the same 90-day noncurrent rule.

**2. Attribution — CloudTrail (PanchObsStack):** new trail
`PanchObsStack-PanchAuditTrail...` logging management events (ALL) plus S3
data events on the evidence, rulings and trail buckets, to a dedicated
SSE-S3-KMS-managed audit bucket with 90-day expiry and log-file validation
(Trail default). The next anomaly has a "who and when" answer. (Trail API
note: aws-cdk-lib 2.270 uses the `addS3EventSelector` method, not a
`TrailProps.eventSelectors` prop — TS caught it, synth confirmed.)

**3. Prevention — pre-deploy coordination gate:** `scripts/require-deploy-lock.sh`
enforces the existing TEAM_PLAN deploy rule: refuses dirty tree, non-main
branch, or local main behind origin/main, then takes an expiring SSM lock
(`/panch/deploy/lock`, 30-min TTL, holder ARN embedded) so overlapping
deploys fail fast. Self-tested: correctly REFUSED with a dirty tree (exit 1).
TEAM_PLAN.md documents the gate.

**4. ruling.md dead weight removed:** dropped the unused
`S3_KEY_BUILDERS.rulingMarkdown`, deleted the three fixture .md files
(nothing ever wrote or served them), updated bench README.

**5. bench README runbook fix (logged Phase 16 follow-up):** the seed step
said `status: DISPUTED`, which since the Phase 16 ledger guard fails at
SETTLE (RESOLVE requires DELIBERATING/ESCALATED). Runbook now says seed
DELIBERATING (matching runDemo) and explains why, with the FUND/DISPUTE
ledger-seeding note for cases that want a fuller chain.

**Verification:** 475 tests green; eslint/tsc/cdk synth clean; deployed
PanchDataStack + PanchObsStack (203 s). Live: rulings bucket versioning
Enabled + 90d noncurrent rule; trail IsLogging true, management ALL, S3 data
events on. **Recovery drill on a real ruling** (`hr-e2e-1790608149447`):
deleted the object (delete marker created), restored the prior version via
copy-object, served bytes SHA-match the stored `rulingSha256`, public
`/rulings/{id}/verify` -> match:true, CloudFront 200 throughout the restore.
Ship gates unchanged (landing 200, /reviews 200, demo ruling 200, API 401).

## Phase 20 — unblock Rutu's access: verification script + CLI runbook (Arshvir/agent, branch `a/feat/unblock-rutu-access`, 2026-09-28)

Rutu's Phase 7/12/15 sessions were blocked on AWS credentials, so her handler
work was never validated under her own access. This phase closes that: every
permission TEAM_PLAN §5 grants her was probed live, and she gets a repeatable
pre-flight script instead of a one-off manual check.

**Access confirmed live (all 18 checks PASS, profile `panch`, SSO session
`AWSReservedSSO_PanchAdmin_.../Arshvir`):** sts get-caller-identity on the
shared dev account (890742603792); ssm get-parameter on all four
`/panch/models/*` keys and both `/panch/config/*` keys; S3 read/write
round-trip on the `bench/demo` prefix of the evidence bucket (bucket name
resolved from `/panch/data/buckets/evidence`, not hardcoded); stepfunctions
list-executions / describe-execution / get-execution-history on the deployed
Tribunal state machine; and a real Bedrock Converse ping on each judge model
from SSM (Nova Pro, Mistral Large, Llama 3.3 70B — one ~20-token call each).
Textract was exercised via `detect-document-text` on a throwaway PNG under
`bench/demo/tmp-access-check/` (cleaned up) — it passes too, but it is NOT in
verify-access.sh because it has no free read-only probe (it needs a document;
TEAM_PLAN §5 notes it). **No CDK changes were needed — zero permission gaps,
so no deploy in this phase.**

**Note on "Rutu's access":** the account has a single shared SSO permission
set (`PanchAdmin`); there is no per-person role to differ from Arshvir's.
So this phase verifies the shared profile covers her needs, not a separate
Rutu role. Any future least-privilege split is an SSO change outside CDK.

**New: `scripts/verify-access.sh`** — read-only pre-flight Rutu runs before
every session (after `aws sso login --profile panch`): PASS/FAIL per
permission (STS identity + account check, SSM model+config keys, S3 ls plus
put/get round-trip on `bench/demo/tmp-*` then delete, states
list/describe/history with the SM discovered by name prefix, Bedrock converse
ping per model from SSM), exits non-zero on any FAIL so it can gate scripts.
The only paid calls are the tiny Bedrock pings; no state is written except
the deleted tmp probe object.

**start-execution one-liner re-verified on the deployed SM:** seeded a
throwaway case (`demo-verify-000134`, status DELIBERATING per the Phase 16
ledger guard) with case-a fixture evidence + fallback, ran the raw CLI
`aws stepfunctions start-execution --state-machine-arn <SM> --input
'{"caseId":"<caseId>"}'` → SUCCEEDED in ~40s, case SETTLED, 2 ledger
entries, non-fallback ruling published ($0.0419 / rulingSha256 stored) and
served 200 via CloudFront. The one-liner and its input format are unchanged;
what was missing was the **DELIBERATING precondition**, now documented.

**docs/CONTRACTS.md (Piyush's directory — single change, flagged):** added a
"Starting an execution directly from the CLI" section with the exact
one-liner, the `{"caseId"}` fixture input, the DELIBERATING precondition
(Phase 16 guard rationale: RESOLVE only from DELIBERATING/ESCALATED, so a
DISPUTED seed fails at SETTLE), the evidence/fallback seeding keys, and a
pointer to verify-access.sh. No other docs/ edits.

**Verification:** verify-access.sh 18/18 PASS run twice (probe objects
deleted after each run); tsc/eslint/tests untouched by this change (script
+ docs only, no runtime code); no deploy required.

## Phase 21 — ship-gate prep: cost/abuse check on the live stack + SECURITY.md re-audit (Arshvir/agent, branch `a/feat/ship-gate-prep`, 2026-09-29)

Ship-gate prep while Rutu and Piyush finish their lanes. Read-only live
checks plus one docs/ change (SECURITY.md). **No infra gap found — nothing
deployed, no CDK change.**

**Cost & abuse checks (all confirmed against the DEPLOYED stack, not code):**
- `/demo/run` API Gateway throttle live on the prod stage: method setting
  `/demo/run/POST` → `throttlingRateLimit 2.0 / throttlingBurstLimit 5`
  (read via `get-stage` `methodSettings`; `get-method-settings` is missing
  from this aws-cli v2.37.1 build).
- DynamoDB daily cap live: `DEMO_CAP_YYYY-MM-DD` counter rows in Cases
  (25 / 13 / 8 for Sep 26/27/28) — separate keys per UTC date prove the cap
  resets at UTC midnight (`new Date().toISOString().substring(0,10)` UTC).
  Cap is the code constant 30 (no env override); 429 above 30.
- Budget: `panch-monthly` $20 monthly cost budget with 85%/100% ACTUAL and
  100% FORECASTED email notifications to the owner.
- Alarms: all three (TribunalExecutionsFailed, Api5xx on 5XXError,
  BedrockThrottles on InvocationThrottles) are in OK state, each with the
  `panch-alarms` SNS topic as its only alarm action. **Gap found:
  `panch-alarms` has ZERO subscriptions** — alarm notifications currently go
  nowhere. Fixing needs Arshvir's (or the team's) confirmed email address —
  a one-time console/CLI step outside CDK; do not guess it.
- Demo handler health: 47 invocations in 3 days, max duration 1.83s vs the
  3s timeout, zero timeouts (the async Gateway→Lambda integration retries
  for up to ~10s, so headroom is fine at current latency).
- **Spend to date: $1.153** actual (budget `CalculatedSpend`, ~5.8% of the
  $20 monthly budget).
- **Per-case cost range (TRD §12 real number):** n=13 published rulings with
  costUsd — **min $0.0245, max $0.0419, median $0.0261, mean $0.0294**.
  Confirms the LOG Phase 11–17 range (~$0.025–0.04, 12 real Bedrock calls
  per case, ~9–15k tokens).

**docs/SECURITY.md re-audit (the single docs/ change — flagged to Piyush so
his README/limitations page stays consistent):** verified against the
deployed stacks and updated: evidenceDeadline enforcement (Phase 18) moved
out of the gaps list into a new "Landed since the Day 3 pass" section;
`verifyRuling` stub wording replaced with the real Phase 14 recompute
behavior; new "Attribution and recovery" (CloudTrail + S3 versioning) and
"Deploy coordination" (require-deploy-lock.sh) bullets; post-review and the
response-overdue sweeper's least-privilege shape added to the IAM section;
header marked as re-audited 2026-09-29. Kept stated plainly: no respondent
timeout auto-adjudication, PROMPT_ATTACK filter disabled by design
(false-positives on the judges' own instructions), remaining `xray:*`
wildcard. Newly added as a gap: the SNS subscription gap above.
Injection-test result deliberately left out — it lands from Rutu's
`bench/RESULTS.md` in Part 2B.

**PR reviews:** no open PRs from Rutu or Piyush at time of writing; review
comments to follow as they open (their lanes are still in progress).

**Verification:** every number above was read from the deployed stack (API
Gateway stage, DynamoDB items, Budgets API, CloudWatch alarms, SNS topic,
Lambda config/logs, Rulings scan); `npm test` 409/409 green; docs-only
change, no deploy needed.

## Phase 22 — live verification of /reviews and ruling verify against real data (Piyush/agent, branch `p/fix/reviews-real-data`, 2026-09-29)
Verification pass after Phase 14/17, signed in on the deployed site as the synthetic test reviewer.

**Review queue, real data (`https://main.d1hm3x5hny8fjb.amplifyapp.com/reviews/`):**
- `GET /reviews` returned 9 ESCALATED cases. For every case, every value on screen matched the raw API response: judge awards, confidences, findings/clauses/uncertainty counts, median, spread, and each per-judge swap line. Judges are shown in order, judge-1 to judge-3, even though the API sends them out of order.
- No fallback path triggered wrongly. None of these appeared: "judges not sent", "output could not be read", "worked out from the awards", or "—" placeholders.
- The shapes match the UI reader: `panelOutputs.judges` and `swapOutputs` keyed by judge name, `aggregate` nested, `recoveredFromHistory` on legacy rows.
- `demo-df4844b8` shows judge 1 "Shifted · mirrored 100%, off by 50 pts" and judges 2 and 3 "Consistent".
- The 4 legacy rows (`recoveredFromHistory: true`, empty `swapOutputs`) show "No swap-test run for this judge." as muted text, not an error.
- "No written summary was sent with this case" shows on all 9, which is correct: the case model has no summary field.

**One real decision through the UI:** `c-c3ab6359` at 20% with a note. The results:
- `POST /reviews/c-c3ab6359` returned `200 { status: SETTLED, published: true, entryHash }`, and the case left the queue.
- `GET /rulings/c-c3ab6359` serves `payeeShareBps: 2000`, `humanReviewed: true`, and the note as `reasoning`. The content hash matches in `/verify`.
- A second decision from a tab holding the pre-decision queue hit the real API and got `400 "Case must be ESCALATED"`. The page showed "already resolved by someone else, so nothing was changed" and refreshed the queue.

**Mismatches found and fixed (web only):**
1. The race answer `409 "Case already reviewed and settled"` (`postReview`) was not recognised as a conflict. The UI matched only the 400 wording, so a race showed as a form error. Any 409 is now treated as already resolved. There is a new test, and removing the fix makes it fail.
2. The ruling page showed a human decision as the panel's ("Decided by a blinded panel of three judges and a presiding judge", "Panel confidence 100%"), because it ignored `humanReviewed`. It now says a human reviewer decided, hides the fixed `confidence: 1` meter, and titles the reasoning "Reviewer's reasons". I confirmed this against the live `c-c3ab6359` ruling with a local build pointed at the production API. AI rulings are unchanged.

**Ruling verification:**
- `GET /rulings/demo-9bfae5c6/verify` returns `match: true`, with the content hash matched and the chain valid.
- For the escalated `demo-df4844b8`, both `/rulings/{id}` and `/verify` return 404. The ruling page shows "No published ruling yet" rather than an error.
- The frontend has **no verification page**: nothing calls `/verify`. Building one would be a new feature, so none was added.

**Backend bug found (Arshvir's area, reported, not changed):**
- `/verify` on `c-c3ab6359` returns `match: false`, "Ledger chain failed to recompute": entry 2, DISPUTE, is invalid.
- `services/api/cases.ts:67` writes DISPUTE with `seq: 2, prevHash: 'GENESIS'` instead of chaining onto the FUND entry's hash.
- So every real case that goes through fund and dispute fails `/verify`, whether the AI or a human settles it. Demo cases skip those steps, which is why they verify.
- The review's own RESOLVE/RELEASE entries (3 and 4) are valid and chain correctly.

**Checks run:** web tests 414 (5 new), lint, typecheck, `next build`.

## Phase 23 - final validation: catch-path fallback confirmed live; everything Bedrock blocked by account-level Error 002 (Rutu, branch `r/feat/final-validation`, 2026-09-29)

Goal was the remaining validation gaps: live presiding raw-response artifact,
3x runs of cases A/B/C vs the PRD section 9 metrics, live prompt-injection
probe, and catch-path fallback confirmation, with bench/RESULTS.md + Known
limitations to close out. Two items got done end to end; everything that
needs Bedrock is blocked (details below - exact error, what changed since
2026-09-28, and what Arshvir needs to unblock).

**Infra access repaired and re-verified (14/18 PASS).** AWS CLI v2.37.5
installed (approved elevation); SSO login completed through the Identity
Center portal. Discovery worth logging: the portal at
https://d-9f6758d40c.awsapps.com/start/ is region **ap-south-1**, not
us-east-1 - every login attempt from another region failed with
InvalidRequestException before a parallel sweep of all regions found it.
`~/.aws/config` profile `panch` now carries sso_region ap-south-1 with
session region us-east-1; `sts get-caller-identity` succeeds as
`assumed-role/AWSReservedSSO_PanchAdmin_.../Rutu`. verify-access.sh:
STS, all 6 SSM keys, evidence-bucket S3 round-trip, and all 4 Step Functions
checks PASS; the only FAILs are the 4 Bedrock Converse pings (see below).
Also found while validating: the `/panch/data/tables/*` SSM params referenced
in docs do not exist in this account (ParamNotFound); table names are only
discoverable via list-tables (e.g. `PanchDataStack-Cases80582F3E-GXFZ9LQ0VP10`)
- the bucket params under `/panch/data/buckets/*` do exist.

**Catch-path fallback CONFIRMED LIVE end to end (organic, via the real state
machine).** Seeded `demo-r17-b-ee3bff` (case-b fixture, DELIBERATING per the
Phase 16 ledger guard, single e-1 artifact + fallback at the seeded keys),
started the execution through the real CLI one-liner: it FAILED in ~25s at
JUDGES on the Bedrock block below, Catch routed to FailLambda, and the
fallback landed at `panch-rulings/demo-r17-b-ee3bff/ruling.json`. Verified:
`fallbackCopyIdentical: true` (published bytes == seeded fixture bytes),
ledger untouched (0 events, escrow state unchanged), case row FAILED, and
the **public CloudFront check now passes too** - HTTP 200 from
d1a3grqm50ahjl.cloudfront.net with bytes hash-identical to the S3 origin
object. This closes the fallback side of Phase 15 "to finish when credentialed".

**Bedrock is the hard blocker: `ValidationException: Error 002: Access to
Bedrock models is not allowed for this account`** on every invocation
(amazon.nova-pro-v1:0, mistral.mistral-large-3-675b-instruct,
us.meta.llama3-3-70b-instruct-v1:0). This is account-level model enablement
- the control plane is fine (list-foundation-models works), so it is not IAM
and not code. Models ran fine through Phase 20 on 2026-09-28 (its LOG entry
records a SUCCEEDED case run); the break happened after that, so something
changed on the account side. Arshvir: please re-enable the three models in
Bedrock model access; until then the live presiding artifact, the 3x A/B/C
benchmark runs, and the injection probe cannot run - per task rules I did not
work around this. Consequence: PRD section 9 rows "agreement with gold on
clear cases (above 85 percent)", "escalation on ambiguous (above 60 percent)",
"swap flip rate (under 10 percent)", and "cost per case (under 1 USD)" are
all UNMEASURED this session; the one catch-path property (fallback servable
publicly + byte-identical to the seeded fixture) is confirmed.

**Validation tooling built (gitignored scratch, per policy) and fixed:**
`scripts/tmp-validation/` holds the presiding raw-response probe (builds the
PRESIDING-equivalent deliberation record from a live AGGREGATE output,
captures raw content/usage/stopReason + every retry, checks at least 2 judges
by name, evidenceId citations, synthesis-not-copy, writes the
`bench/artifacts/presiding-live-<date>.json` artifact), the seed/verify
bench harness (DELIBERATING seeds, sha256 + ledger-chain recompute, CloudFront
byte-check, divergence rules per gold.json, PRD-metrics row), the CloudFront
checker, and the credentialed runbook. Two fixes applied after live testing:
(1) the harness and probe resolved table names from the nonexistent
`/panch/data/tables/*` SSM params - they now discover tables via list-tables
prefix match and were exercised end to end with a real `verify` run against
demo-r17-b-ee3bff; (2) the CloudFront checker now sets `AWS_PROFILE=panch`
when spawning aws.exe (and the tool verified the public fallback bytes above).

**Known limitations / not done this session (all Bedrock-gated):** no live
presiding artifact; no 3x benchmark numbers; no injection-probe result; the
FailLambda direct-invocation variant of the catch path was not re-exercised
(coordination needed per Phase 16; the organic Catch path is proven above).
bench/RESULTS.md ships as a skeleton with the confirmed result and an
explicit UNMEASURED section. Nothing deployed; no /infra, WorkflowStack, or
services/shared changes; no SSM edits.
