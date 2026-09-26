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
- Added a \ailHandler\ lambda as a Catch path fallback to serve cached rulings for demo cases.
- Wired \POST /cases/{id}/submit\ and \POST /demo/run\ to \StartExecution\ via \ApiStack\.
- Updated \GET /cases/{id}\ to return the Step Functions execution status and current stage by pulling history from \DescribeExecution\ and \GetExecutionHistory\.
- Added new API endpoints: \GET /reviews\, \POST /reviews/{caseId}\, \GET /rulings\, \GET /rulings/{id}\, \GET /rulings/{id}/verify\.
- Added unit tests for the stub handlers and the reviews API, ensuring Vitest covers the fallback and escalation behaviors.
