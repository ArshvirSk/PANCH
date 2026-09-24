# TEAM_PLAN.md: Panch Hackathon Plan

**Team Size:** 3 Members
**Duration:** 3 Days (compressed timeline — replaces the earlier 14-day Phases 1-6)
**Effort:** Full days, paste-one-prompt-at-a-time execution, deploy and check before moving on

> This plan supersedes the original 14-day phase breakdown. See `Arshvir_prompts.md` (3-day prompts) for the exact prompts run each day. Ownership, contracts, and the cut list below carry over unchanged.

## 1. Ownership Map

Each directory is strictly owned by one member. No directory has two owners.

| Member      | Strengths                 | Directory Ownership                           | Responsibilities                                                                                                        |
| :---------- | :------------------------ | :-------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| **Arshvir** | AWS, Backend, DevOps      | `/infra`, `/services/api`, `/services/shared` | CDK stacks (Data, Auth, Api, Web, Workflow, Obs), API Gateway, DynamoDB ledger, Lambda handlers, shared types/contracts |
| **Rutu**    | AI/ML, Prompting, Data    | `/services/tribunal`, `/bench`                | Step Functions handler logic, Bedrock prompts, Guardrail config, demo cases, fallback rulings                           |
| **Piyush**  | Frontend, Design, Writing | `/web`, `/docs`                               | Next.js app, Amplify hosting (GitHub-connected), UI/UX, documentation                                                   |

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

### Day 3: Harden, observe, freeze

**Owner: Arshvir** (branch `a/feat/day3-harden`) — **feature freeze on new functionality**

| Track      | Work                                                                                                                                                                                                                                                                         |
| :--------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cost & Obs | Per-case Bedrock token counts → `costUsd` from an SSM price table; minimal ObsStack (one dashboard: executions, failures, stage durations, throttles, tokens, `/demo/run` count, API 5xx) + alarms; X-Ray on                                                                 |
| Security   | Least-privilege IAM review, no public buckets, SSE-KMS everywhere, no secrets in repo, Guardrails before every judge call, presigned URL limits — write short `docs/SECURITY.md`                                                                                             |
| Edge cases | Duplicate submit, evidence after deadline, respondent never responds, retry after `FAILED`                                                                                                                                                                                   |
| Ship-gate  | Fresh checkout (`npm ci`, `cdk synth`, clean deploy) from `main`; 3x logged-out `/demo/run` to verified ruling for all 3 demo cases with confirmed fallbacks; README/TRD updated where implementation differs; list anything that could fail the ship gate with a mitigation |

**Checkpoint:** Final report + LOG.md entry. Submission-ready.

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
2. Human review queue (always auto-resolve or fail gracefully)
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

---

## 8. Messages to Teammates

**Rutu (after Day 1 step 6 lands):** Build handlers against the contracts in `services/shared` and test with the fixture. Judge-3 (Llama) runs in JSON mode through the shared wrapper. Use the shared model wrapper for every call. Put prompts in `services/tribunal/prompts`, the Guardrail config as a JSON file, and three demo cases plus fallback rulings in `bench/demo`. Ping before needing real Bedrock access.

**Piyush (Day 1):** Clone, run the mock server, build against it. Point at the real API URL once it's sent at the end of Day 1. Connect the repo to Amplify after Arshvir does the one-time GitHub connection.
