# Panch

The AI panchayat for disputes no court will hear. Built for AWS Zero to Shipped Hackathon.

## 📚 Essential Reading
Before writing any code or prompting your agents, please ensure they read these specs:
- [`AGENTS.md`](./AGENTS.md) - The master ruleset for all AI agents working on this repo.
- [`docs/Panch_PRD.md`](./docs/Panch_PRD.md) - Product requirements and feature scope.
- [`docs/Panch_TRD.md`](./docs/Panch_TRD.md) - Technical architecture, schemas, and AWS stack details.
- [`docs/TEAM_PLAN.md`](./docs/TEAM_PLAN.md) - Roles, phases, and workflows.

---

## 🚀 Setup & Local Development

This is an `npm` workspaces monorepo containing our CDK Infrastructure, Backend APIs, AI Workflow, and Next.js Frontend.

1. **Install dependencies:**
   ```bash
   nvm use 20  # or fnm use 20
   npm install
   ```
2. **AWS Credentials:**
   Ensure you are logged into AWS SSO with the `panch` profile (Account `890742603792`, Region `us-east-1`).
   ```bash
   aws sso login --profile panch
   ```

---

## 🏗️ Phase 1 / 2 Infrastructure (Completed)

The foundational Data, Auth, and API stacks are **live and fully integrated**.

**Live Endpoints:**
- **API URL:** `https://y05rlxj2c1.execute-api.us-east-1.amazonaws.com/prod/`
- **Cognito User Pool ID:** `us-east-1_1MJKFFcNn`
- **Cognito Client ID:** Stored in SSM parameter `/panch/auth/userPoolClientId`
- **DynamoDB Tables & S3 Bucket Names:** Stored in SSM (e.g. `/panch/data/tables/cases`, `/panch/data/buckets/evidence`)

---

## ☁️ AWS Services Actually Used

Every service below is created by a CDK stack in `infra/lib/` and exercised by the deployed system (verified Day 3). Nothing on this list is aspirational; Textract was planned in the TRD but is **not** used — evidence text extraction is seeded/uploaded directly.

| Service | Where | Used for |
|---|---|---|
| Lambda (Node.js 20) | ApiStack, WorkflowStack, DataStack | All API handlers, tribunal tasks, evidence processing |
| API Gateway (REST) | ApiStack | Public + Cognito-authorised HTTP API |
| Step Functions (Standard) | WorkflowStack | Tribunal state machine: judges → cross-exam → swap test → aggregate → publish → settle, with Retry/Catch |
| Amazon Bedrock | WorkflowStack | Three judges from three model families (Nova Pro, Mistral Large, Llama 3.3 70B) via Converse |
| Bedrock Guardrails | WorkflowStack | Content policy applied on every judge call (guardrailConfig on Converse) |
| DynamoDB (on-demand) | DataStack | Cases, Ledger (hash-chained, transactional), Evidence, Rulings (cost records) |
| S3 (SSE-KMS) | DataStack | Evidence + benchmark buckets (private, KMS) |
| S3 + CloudFront (OAC) | DataStack | Public rulings path — private bucket, CloudFront-only origin access |
| AWS KMS | DataStack | Encryption keys for S3 buckets |
| Cognito | AuthStack | Sign-up/sign-in; ID-token verification on protected reads |
| Amplify Hosting | WebStack | Next.js static frontend builds |
| CloudWatch | ObsStack | Dashboard (`Panch-Demo`), 3 alarms (failed executions, API 5xx, Bedrock throttles), EMF custom metrics (tokens, demo runs, review actions, stage durations) |
| X-Ray | ApiStack, WorkflowStack, DataStack | Tracing on all Lambdas, the state machine, and API Gateway |
| SNS | ObsStack | Alarm topic (`panch-alarms`) |
| SSM Parameter Store | AuthStack, WorkflowStack | Model IDs/modes, table/bucket names, Cognito IDs, per-1k-token Bedrock pricing (`/panch/pricing/bedrock/*`) |
| Secrets Manager | WebStack | Amplify build GitHub token |

---

## 🧑‍💻 Handover: Frontend (Piyush)

Your goal is to build out the Next.js `web/` application and wire it to the real APIs.

### Auth & Connection
1. Initialize AWS Amplify Auth in the Next.js app using the Cognito User Pool ID and Client ID. 
2. Users can sign up via Email.
3. Every call to the protected API routes must include the Cognito `IdToken` in the `Authorization` header.

### Case Workflow Integration
The case progression is managed through REST API endpoints. You no longer need the mock server!

1. **Create Case (Claimant):**
   - `POST /cases`
   - Body: `{ "amountCents": 5000, "respondentEmail": "bob@example.com", "currency": "USD" }`
   - Returns: `201 Created` with `{ caseId: "...", status: "CREATED" }`
2. **Fund Case (Respondent):**
   - `POST /cases/{id}/fund`
   - Transitions case to `FUNDED`.
3. **Dispute Case:**
   - `POST /cases/{id}/dispute`
   - Transitions case to `DISPUTED`.
4. **Upload Evidence:**
   - `POST /cases/{id}/evidence`
   - Request a presigned URL. Returns an `evidenceId` and an S3 PUT `uploadUrl`.
   - **Upload File:** Simply do a `PUT` request to `uploadUrl` with the file blob.
   - **Note:** The backend automatically computes the file's SHA-256 hash asynchronously via an S3 event and stores it in the `Evidence` DynamoDB table! You do not need to calculate or submit hashes from the frontend.
5. **Submit for Deliberation:**
   - `POST /cases/{id}/submit`
   - Transitions case to `DELIBERATING` and locks further uploads. (This will soon trigger the AI Step Functions).

### Public Routes
- **Health Check:** `GET /health` (Returns `{ status: "ok", timestamp: "..." }`)
- **Demo Mode:** `POST /demo/run` (Triggers a quick, unauthenticated demo simulation).

### Frontend status (built)

The `web/` app covers everything above. It is a Next.js static export, hosted by the Amplify app in `WebStack`.

| Page | Login | What it does |
|---|---|---|
| `/` | No | Landing page, **Run demo case** (`POST /demo/run`), API health in the footer (`GET /health`) |
| `/login/` | No | Sign in, create account (email), confirm the emailed code. Uses `USER_PASSWORD_AUTH`, the only flow the Cognito app client enables |
| `/cases/` | Yes | Cases opened on this device (the API has no list route yet), with statuses refreshed from the API; open a case by ID or pasted link |
| `/cases/new/` | Yes | Create a case as claimant (`POST /cases`) |
| `/case/?id=` | Yes | Fund as respondent, dispute, upload evidence (drag and drop, presigned S3 PUT), submit, live polling while deliberating, ledger receipts. Fund, dispute and submit ask for confirmation |
| `/ruling/?id=` | No | Public ruling as a formal award: split, confidence, reasoning, cited findings, clauses (`GET /rulings/{id}`) |
| `/reviews/` | Yes | Human review queue for escalated cases: summary, amount, the three judges side by side, spread, swap test, and a form to settle the case (`GET /reviews`, `POST /reviews/{caseId}`) |

Every protected call sends the Cognito ID token in `Authorization`. Roles come from the case: the claimant is the creator's Cognito `sub`, and the respondent is the account whose email matches `respondentEmail`.

**Human review queue (`/reviews/`, TEAM_PLAN section H):**
- **Scope cut, stated plainly:** any signed-in account can act as the reviewer. There is no reviewer role or invite flow. The page warns a reviewer who is a party to the case.
- **Oldest case first.** Each case shows:
  - the summary, amount and escalation reason;
  - the panel median, spread and swap-test verdict;
  - each judge's award, confidence, reasoning, cited findings, clauses and uncertainties, side by side.
- **Per-judge swap check:** the page maps each swap run back (`10000 − swap award`) and marks a judge *Flipped* when the winner changes sides. The panel's `swapConsistent` compares medians, so this per-judge flag is how a reviewer sees the median-blind case described in LOG.md phase 10.
- **Blind review:** party names and emails are never shown, the same as for the judges.
- **The decision form:**
  - The reviewer enters the claimant's share as a percentage (sent as `payeeShareBps`) and a required note of up to 1,000 characters.
  - Quick-fill buttons offer the median, each judge's award and an even split, with a live money split.
  - A confirmation step comes before `POST /reviews/{caseId}` with `{ payeeShareBps, note }`.
  - If another reviewer settled the case first (400 `Case must be ESCALATED`), the page says so and refreshes the queue.
- **Accepted `GET /reviews` shapes:** a list, or `{ items | reviews | cases: [...] }`. Each item is a Cases item with the panel record under `panelOutputs` or at the top level:
  - **Judges:** `judges`, or `finalPanelOutputs` (array, `{ judgeName, output }` task results, or keyed by judge name).
  - **Swap runs:** `swapOutputs`.
  - **Panel values:** `spreadBps`, `medianPayeeShareBps`, `swapConsistent` and `escalationReason`, flat or under `aggregate`.
  - **Summary:** `summary` or `caseSummary`.
  - **Missing parts:** the page says so instead of guessing.

**Reliability and security:**
- API calls time out after 20 s and uploads after 120 s.
- Reads are retried once on a network error or a 502/503/504. Writes are never retried.
- Server errors are shown without internal details.
- Double submits are blocked.
- The site sends a CSP and other security headers from `web/security-headers.json`, applied by `WebStack`.

**Tests:**
- `npm run test --workspace=web` runs 409 unit and component tests (Vitest, Testing Library, jsdom). They cover:
  - every case status for each role;
  - the dialogs, polling, uploads and login;
  - every accepted review-queue shape, the swap-test maths and the review form;
  - hostile input.
- Two browser suites pass in Chrome and Edge: 95 checks for the case flow and 65 for the review queue. They live outside the repo; see `docs/dev-process/LOG.md`. They cover:
  - accessibility (axe, WCAG 2.1 AA, light and dark) and keyboard use;
  - offline and failing APIs, conflicting edits and two reviewers racing;
  - XSS, mobile layout, performance budgets and zero CSP violations.

**Run locally:**
```bash
cp web/.env.example web/.env.local   # fill in the API URL and Cognito IDs
npm run dev --workspace=web          # http://localhost:3000
npm run build --workspace=web        # static site in web/out
```

**Before the deployed site works end to end, run one `cdk deploy --all` from branch `p/feat/web-frontend` (Arshvir):**
- API CORS allows the Amplify origin (today only `http://localhost:3000` passes preflight), and API Gateway 401s carry CORS headers.
- The evidence bucket gets a PUT CORS rule. Without it, browsers cannot upload to the presigned URL.
- The Amplify app gets `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_USER_POOL_ID` and `NEXT_PUBLIC_USER_POOL_CLIENT_ID` from the stacks. Builds use `/amplify.yml`.
- `GET /rulings/c-104` returns the fixture ruling instead of an empty body.
- The Amplify app serves the security headers (CSP, HSTS, frame and MIME-sniffing protection).

After the deploy, merging to `main` triggers the Amplify build. The site URL is the `PanchWebStack.WebUrl` output.

---

## 🤖 Handover: AI & Workflows (Rutu)

Your goal is to implement the Step Functions orchestration and the judge logic under `services/tribunal/`.

### Bedrock & Model Configuration
- Do **NOT** hardcode model IDs in your Lambda code.
- Models for each judge role are defined in AWS SSM Parameters (e.g., `/panch/models/judge-1`, `/panch/models/judge-1-mode`).
- **Helper Available:** Use the `invokeJudgeModel` helper in `services/shared/helpers.ts`. It will automatically fetch the correct model ID from SSM, parse the mode (`json` vs `tool`), and securely invoke Amazon Bedrock.

### Step Function Schemas
The exact input/output boundaries for the Step Functions are frozen in `services/shared/step-functions.ts`. 

Your next steps:
1. Build the Lambda functions for the tribunal (e.g. `IntakeHandler`, `JudgeHandler`, `PresidingHandler`) in `services/tribunal/`.
2. Update `WorkflowStack.ts` to construct the Step Function state machine using these Lambdas.
3. Validate the inputs and enforce structured JSON outputs using the Zod schemas from `services/shared/schemas.ts`.
4. Keep token counts and costs logged per case!

---

## 🛠️ Testing & Verification
You can run the full E2E Integration script at any time to verify the API, Ledger hashes, Auth, and S3 event triggers are working correctly.

```bash
# Run the integration test (requires API_URL and AWS Profile)
$env:AWS_PROFILE="panch"
$env:AWS_REGION="us-east-1"
npx tsx scripts/integration.ts
```
