# TEAM_PLAN.md: Panch Hackathon Plan

**Team Size:** 3 Members
**Duration:** 3 Days (compressed timeline — replaces the earlier 14-day Phases 1-6)
**Effort:** Full days, paste-one-prompt-at-a-time execution, deploy and check before moving on

> This plan supersedes the original 14-day phase breakdown. See `Arshvir_prompts.md`, `Rutu_3day_prompts.md` for the exact prompts run each day. Ownership, contracts, and the cut list below carry over unchanged except where marked **[UPDATED]**.

## 1. Ownership Map

Each directory is strictly owned by one member. No directory has two owners.

| Member      | Strengths                 | Directory Ownership                           | Responsibilities                                                                                                        |
| :---------- | :------------------------ | :-------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| **Arshvir** | AWS, Backend, DevOps      | `/infra`, `/services/api`, `/services/shared` | CDK stacks, API Gateway, DynamoDB ledger, Lambda handlers, shared types/contracts, **[UPDATED]** review API routes |
| **Rutu**    | AI/ML, Prompting, Data    | `/services/tribunal`, `/bench`                | Step Functions handler logic, Bedrock prompts, Guardrail config, demo cases, fallback rulings                           |
| **Piyush**  | Frontend, Design, Writing | `/web`, `/docs`                               | Next.js app, Amplify hosting, UI/UX, documentation, **[UPDATED]** human review queue UI                                 |

**Rule for Shared Files:** `services/shared` (types, schemas, ledger logic, handler I/O contracts) is owned by **Arshvir**. Rutu and Piyush must submit a PR and wait for Arshvir's review to change any shared contract.

**Deploy Rule:** Only **Arshvir** runs `cdk deploy`. Always deploy from `main` after merging — Day 1 is the exception, where deploying from Arshvir's branch to get the public URL live is allowed, followed immediately by a merge to `main`.

---

## 2. Contracts to Freeze on Day 1

Before Rutu and Piyush build against the real system, these interfaces are frozen so everyone can build against mocks/fixtures.

### A. Judge JSON Schema (Bedrock Output)

```json
{
  "findingsOfFact": [{ "fact": "string", "evidenceIds": ["string"] }],
  "clausesRelied": [{ "clauseRef": "string", "interpretation": "string" }],
  "payeeShareBps": 0,
  "reasoning": "string",
  "confidence": 0.0,
  "uncertainties": ["string"]
}
```

### B. Step Functions Task Contracts (services/shared, Day 1 step 6)

Typed input/output for every task: `intake`, `blind`, `judge` (input: judge name + blinded case file; output: `judgeOutput`), `crossExam`, `swapTest`, `aggregate`, `presiding`, `publish`, `settle`, `notify`. One fixture input for a full execution, documented in `docs/CONTRACTS.md`. A shared helper reads model config from SSM and wraps model invocation — Rutu's handlers must use it for every Bedrock call.

### C. API Request/Response Shapes

- **POST `/cases`**
  - Req: `{ "claimantEmail": "a@x.com", "respondentEmail": "b@y.com", "amountCents": 40000, "currency": "USD" }`
  - Res: `{ "caseId": "c-123", "status": "CREATED" }`
- **POST `/cases/{id}/evidence`**
  - Req: `{ "party": "claimant", "type": "chat_log", "contentType": "image/png" }`
  - Res: `{ "evidenceId": "e-456", "uploadUrl": "https://s3.aws.com/..." }` (5-minute expiry, size/content-type limits)
- **GET `/cases/{id}`** → status + current stage + timestamps (frozen timeline shape, from `DescribeExecution`)
- **GET `/rulings/{id}`** → ruling JSON/markdown, no raw evidence or PII
- **GET `/rulings/{id}/verify`** → `{ match, computedHash, storedHash, ledgerEntryHash }`
- **POST `/demo/run`** → no auth; creates + funds + disputes + submits a seeded demo case; returns `caseId`; rate-limited (API Gateway throttle + DynamoDB daily cap, default 30/day)

### D. DynamoDB Item Shapes

- **Cases:** `PK: caseId`, `status`, `claimantId`, `respondentId`, `amountCents`, `evidenceDeadline`, `executionArn`
- **Evidence:** `PK: caseId`, `SK: evidenceId`, `party`, `s3Key`, `sha256`, `guardrailFlags`
- Tables: `Cases`, `Evidence`, `Rulings`, `Ledger`, `BenchCases`, `BenchRuns` — on-demand, PITR on, names published via SSM

### E. Ledger States (Simulated Escrow)

- Valid `event` states: `FUND`, `DISPUTE`, `RESOLVE`, `RELEASE`
- Case state machine: `CREATED → FUNDED → DISPUTED → RESOLVED → SETTLED`; double-resolve and illegal transitions rejected
- Hash chain: `entryHash = sha256(prevHash + event + amountCents + caseId)`, written via `TransactWriteItems` with a conditional check on `Cases.status`

### F. S3 Key Layout

- **Evidence:** `panch-evidence/{caseId}/{evidenceId}`
- **Extracted Text:** `panch-evidence/{caseId}/extracted/{evidenceId}.txt`
- **Rulings:** `panch-rulings/{caseId}/ruling.json` (served via CloudFront with OAC)
- **Benchmark/demo:** `bench/demo` (Rutu: 3 pre-seeded demo cases + cached fallback rulings)

### G. SSM Parameter Names

- `/panch/models/judge-1`, `/panch/models/judge-2`, `/panch/models/judge-3`, `/panch/models/presiding`
- `/panch/config/max-crossexam-rounds`

### H. Human Review (light version)

- **GET `/reviews`** (Cognito-authorized, any signed-in user for the hackathon demo — no separate reviewer role) → list of cases with `status: ESCALATED`, each with the panel's judge outputs, spread, swap-test result if available, and case summary.
- **POST `/reviews/{caseId}`**
  - Req: `{ "payeeShareBps": 7000, "note": "string" }`
  - Res: `{ "caseId": "c-123", "status": "RESOLVED" }`
  - Effect: writes a `Rulings` entry marked `humanReviewed: true`, appends `RESOLVE` then `RELEASE` to the ledger via the existing ledger library. Same settlement path the AI presiding judge uses — no new ledger logic.
- No separate reviewer Cognito group or role. Any authenticated user can act as reviewer for the demo; this is stated plainly in the README as a scope cut, not hidden.
- This does not change `Cases`, `Evidence`, or `Ledger` item shapes. It reads `Rulings`/`Cases` where `status = ESCALATED` and writes through the existing settle path.

---

## 3. Day-by-Day Plan

Run one prompt per day (`Arshvir_prompts.md`), deploy, and check before moving on. Log each session in `docs/dev-process/LOG.md`.

### Day 1: Foundation, API, ledger, live URL

**Owner: Arshvir** (branch `a/feat/day1-infra`)

| Track        | Work                                                                                                                                                                                                       |
| :----------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Infra        | DataStack (tables + KMS + S3, SSM names), AuthStack (Cognito, public routes unauthenticated), ApiStack (API Gateway + CORS + `/health` + Cognito authorizer), WebStack (Amplify Hosting, GitHub-connected) |
| Contracts    | Shared Step Functions task contracts + fixture + `docs/CONTRACTS.md` (unblocks Rutu)                                                                                                                       |
| API & Ledger | Ledger hash-chain library, `POST /cases`, `/fund`, `/dispute`, `/evidence` (presigned upload), `/respond`, `/submit`, `GET /cases/{id}`; stubbed public routes from fixtures; least-privilege IAM          |
| Tests        | Every ledger transition, double-resolve, hash chain integrity, presigned URL constraints; integration script against the deployed API                                                                      |

**Checkpoint:** `cdk deploy --all` run, smoke test passing, public URL live and never broken after this point. PR opened, LOG.md updated. Message sent to Rutu (contracts ready) and Piyush (mock server + real API URL, Amplify GitHub connection).

### Day 2: Workflow wiring, demo, verification

**Owner: Arshvir** (WorkflowStack), **depends on Rutu's handlers in `/services/tribunal`** (branch `a/feat/day2-workflow`)

| Track          | Work                                                                                                                                                                                                                    |
| :------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow       | Tribunal Standard state machine: Intake (Map) → Blind → Judges (Parallel, 3) → Cross-exam (1 round) → Swap test → Aggregate → Route (Choice) → Presiding → Publish → Settle                                             |
| Guardrails/IAM | Bedrock Guardrail from Rutu's config; IAM scoped to model ARNs from SSM (inference profile + foundation model); retries with backoff on throttling; Catch path → `FAILED` + cached fallback ruling for demo cases       |
| API wiring     | `POST /cases/{id}/submit` → `StartExecution`; `GET /cases/{id}` returns stage/timestamps; Settle appends `RESOLVE`+`RELEASE`; `POST /demo/run` (rate-limited); `GET /rulings/{id}`, `/verify`, and list, via CloudFront |
| Tests          | Mocked handlers: happy path, escalation path, failure path                                                                                                                                                              |

**Checkpoint:** `/demo/run` runs end-to-end against fixture handlers, PR opened, LOG.md updated. Rutu given a CLI one-liner to start executions without being blocked on the API.

### Day 2 addition: Arshvir

Add to Day 2's API wiring track, after the Route (Choice) state is wired: implement `GET /reviews` and `POST /reviews/{caseId}` per contract section H above. Both reuse the existing ledger library — no new state machine logic. This can be the last item of Day 2 or the first item of Day 3 depending on time; it's small (reads + one settle call).

### Day 3: Harden, observe, freeze — **[UPDATED]**

**Owner: Arshvir** (branch `a/feat/day3-harden`), **Piyush builds the review queue UI in parallel** (branch `p/feat/review-queue`)

| Track              | Work                                                                                                                                                                                                                                                                         |
| :----------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cost & Obs         | Per-case Bedrock token counts → `costUsd` from an SSM price table; minimal ObsStack (one dashboard: executions, failures, stage durations, throttles, tokens, `/demo/run` count, API 5xx) + alarms; X-Ray on                                                                 |
| Security           | Least-privilege IAM review, no public buckets, SSE-KMS everywhere, no secrets in repo, Guardrails before every judge call, presigned URL limits — write short `docs/SECURITY.md`                                                                                             |
| Edge cases         | Duplicate submit, evidence after deadline, respondent never responds, retry after `FAILED`                                                                                                                                                                                   |
| **Review queue UI**| **[NEW, Piyush]** A simple `/reviews` page behind normal sign-in: lists escalated cases (case summary, amount, the three judges' outputs side by side, spread, swap-test result if present). A form to enter the final `payeeShareBps` and a note, calling `POST /reviews/{caseId}`. No separate reviewer role or invite flow — reuses existing auth. Plain, functional, not styled to the same polish as the rest of the app; this is P1, not the centerpiece. |
| Ship-gate          | Fresh checkout (`npm ci`, `cdk synth`, clean deploy) from `main`; 3x logged-out `/demo/run` to verified ruling for all 3 demo cases with confirmed fallbacks; confirm `/reviews` works logged in, and confirm an escalated case actually appears there and can be resolved end to end. |

**Checkpoint:** Final report + LOG.md entry. Submission-ready. Plus one escalated case resolved through the review queue as part of the final ship-gate check.

---

## 4. Git Workflow

- **Branch Naming:** `<initial>/<type>/<ticket-or-feature>` (e.g., `a/feat/day1-infra`, `r/fix/cross-exam-prompt`, `p/ui/landing-page`).
- **PR Rules:** All changes require a Pull Request to `main`. Arshvir merges every PR.
- **Main Branch:** Protected. Only **Arshvir** deploys against the `main` environment.
- **Deploy Rule:** Only Arshvir runs `cdk deploy`. Rutu and Piyush test locally or against the deployed environment after Arshvir deploys (Day 1 exception: Arshvir may deploy from his branch first to get the URL live, then merges immediately).

---

## 5. AWS Access Plan

- **Account Holder:** **Arshvir** — account `890742603792`, region `us-east-1`, profile `panch`, owns root account and billing.
- **Rutu's Role:** Bedrock, S3, Textract, CloudWatch read/invoke access.
- **Piyush's Role:** Amplify, API Gateway read access (primarily uses deployed endpoints).
- **Deployment:** **Arshvir** is the only one who runs `cdk deploy --all`, to prevent state lock conflicts and drift.

---

## 6. Cut List (in order, if behind schedule)

1. Solidity contract escrow
2. ~~Human review queue~~ → **restored as P1, light version (section H above). If Day 3 runs out of time, cut the UI first and leave `/reviews` and `POST /reviews/{caseId}` reachable via a raw API call for the demo — the escalation decision and settlement logic still work, just without a page for it.**
3. Appeal window (settle immediately in all modes)
4. SES email notifications (assume users poll the timeline)
5. WAF
6. Canary
7. Benchmark beyond 10 cases
8. Cross-examination round 2 (limit to 1 round)

---

## 7. Risks and Blockers

| Risk                                                                                                | Mitigation / Fallback                                                                                                   |
| :-------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| **Tribunal waiting on API:** Rutu needs to test Step Functions before the API is ready.             | Rutu triggers executions directly via CLI using the frozen fixture input (Day 1 deliverable to Rutu).                   |
| **Frontend waiting on Tribunal:** Piyush needs to build the timeline before Step Functions is live. | Piyush uses the mock server against frozen `/cases/{id}` response shapes until the real API URL is sent (end of Day 1). |
| **Bedrock quotas/throttling:** Rutu hits rate limits.                                               | Backoff + retry built into WorkflowStack (Day 2); demo cases fall back to cached rulings on `FAILED`.                   |
| **Frontend waiting on Auth:** Piyush needs to test login.                                           | AuthStack deployed Day 1; public routes stay unauthenticated so demo mode doesn't need it.                              |
| **Manual Amplify/GitHub connection needed.**                                                        | Arshvir stops and gives Piyush the exact console steps rather than guessing.                                            |
| **Review queue is a late addition and could eat Day 3 time.**                                       | It's deliberately scoped light: no new role, no new ledger logic, reuses existing auth and settle path. If it slips, cut the UI only and demo the escalation via a direct API call instead. |

---

## 8. Messages to Teammates

**Rutu (after Day 1 step 6 lands):** Build handlers against the contracts in `services/shared` and test with the fixture. Judge-3 (Llama) runs in JSON mode through the shared wrapper. Use the shared model wrapper for every call. Put prompts in `services/tribunal/prompts`, the Guardrail config as a JSON file, and three demo cases plus fallback rulings in `bench/demo`. Ping before needing real Bedrock access.

**Piyush (Day 1):** Clone, run the mock server, build against it. Point at the real API URL once it's sent at the end of Day 1. Connect the repo to Amplify after Arshvir does the one-time GitHub connection.

**Piyush (Day 3):** Build the `/reviews` queue page once Arshvir's `GET /reviews` and `POST /reviews/{caseId}` are live — check with him before starting so you're not blocked. Keep it simple: a list, the panel outputs, a form. This is P1, don't spend design time on it. If you're behind on Day 3, tell Arshvir and we cut the UI, not the API — he can demo escalation with a raw request if needed.
