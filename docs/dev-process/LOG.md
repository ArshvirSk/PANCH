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

**Not yet done / next:**
- Arshvir: review, merge and run `cdk deploy --all` so the CORS, S3 and Amplify changes go live. Then merge to `main` for the first Amplify build.
- A signed-in run against the real Cognito pool needs the app client ID (SSM `/panch/auth/userPoolClientId`), which this machine could not read.
