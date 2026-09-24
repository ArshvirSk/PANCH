# TEAM_PLAN.md: Panch Hackathon Plan

**Team Size:** 3 Members  
**Duration:** 14 Days (until deadline)  
**Effort:** ~4-6 hours per day per member  

## 1. Ownership Map

Each directory is strictly owned by one member. No directory has two owners. 

| Member | Strengths | Directory Ownership | Responsibilities |
| :--- | :--- | :--- | :--- |
| **Arshvir** | AWS, Backend, DevOps | `/infra`, `/services/api`, `/services/shared` | CDK stacks, API Gateway, DynamoDB ledger, Lambda handlers, shared types |
| **Rutu** | AI/ML, Prompting, Data | `/services/tribunal`, `/bench` | Step Functions logic, Bedrock prompts, guardrails, Textract, benchmarking |
| **Piyush** | Frontend, Design, Writing | `/web`, `/docs` | Next.js App, Amplify, UI/UX, documentation, PRD updates, pitch video |

**Rule for Shared Files:** `services/shared` (types, schemas, ledger logic) is owned by **Arshvir**. Rutu and Piyush must submit a PR and wait for Arshvir's review to change any shared contract.

---

## 2. Contracts to Freeze on Day 1

Before writing logic, the team must agree on these exact interfaces so everyone can build against mocks.

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

### B. API Request/Response Shapes
- **POST `/cases`**
  - Req: `{ "claimantEmail": "a@x.com", "respondentEmail": "b@y.com", "amountCents": 40000, "currency": "USD" }`
  - Res: `{ "caseId": "c-123", "status": "CREATED" }`
- **POST `/cases/{id}/evidence`**
  - Req: `{ "party": "claimant", "type": "chat_log", "contentType": "image/png" }`
  - Res: `{ "evidenceId": "e-456", "uploadUrl": "https://s3.aws.com/..." }`

### C. DynamoDB Item Shapes
- **Cases:** `PK: caseId`, `status`, `claimantId`, `respondentId`, `amountCents`, `evidenceDeadline`, `executionArn`
- **Evidence:** `PK: caseId`, `SK: evidenceId`, `party`, `s3Key`, `sha256`, `guardrailFlags`

### D. Ledger States (Simulated Escrow)
- Valid `event` states: `FUND`, `DISPUTE`, `RESOLVE`, `RELEASE`
- Hash chain: `entryHash = sha256(prevHash + event + amount + caseId)`

### E. S3 Key Layout
- **Evidence:** `panch-evidence/{caseId}/{evidenceId}`
- **Extracted Text:** `panch-evidence/{caseId}/extracted/{evidenceId}.txt`
- **Rulings:** `panch-rulings/{caseId}/ruling.json`

### F. SSM Parameter Names
- `/panch/models/judge-1`
- `/panch/models/judge-2`
- `/panch/models/judge-3`
- `/panch/models/presiding`

---

## 3. Task List per Member, by Phase

### Phase 1: Skeleton & Auth (Days 1-2)
| Member | Task | Files Touched | Dependencies | Priority | Hours |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Arshvir** | CDK Skeleton, AuthStack (Cognito), DataStack (DynamoDB, S3) | `/infra/stacks/*.ts`, `/infra/cdk.json` | None | P0 | 6 |
| **Rutu** | Synthetic Data Archetypes & Contract Templates | `/bench/archetypes/` | None | P0 | 4 |
| **Piyush** | Next.js setup, Amplify deploy config, basic landing page | `/web/app/*`, `/web/next.config.js` | None | P0 | 6 |

### Phase 2: Data & API (Days 3-4)
| Member | Task | Files Touched | Dependencies | Priority | Hours |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Arshvir** | ApiStack, `/cases` endpoints, Ledger transactions | `/infra/ApiStack.ts`, `/services/api/` | None | P0 | 8 |
| **Rutu** | Textract Intake Lambda, Guardrails setup | `/services/tribunal/intake/`, `/infra/WorkflowStack.ts` | Arshvir (DataStack) | P0 | 6 |
| **Piyush** | Mock API hooks, Deal creation UI, Timeline UI shell | `/web/components/`, `/web/lib/api.ts` | None (use mocks) | P0 | 8 |

### Phase 3: Tribunal Workflow & Bench (Days 5-8)
| Member | Task | Files Touched | Dependencies | Priority | Hours |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Arshvir** | Step Functions orchestration wrapper, execution polling | `/infra/WorkflowStack.ts`, `/services/api/cases.ts` | None | P0 | 6 |
| **Rutu** | 3 Judges, Cross-Exam, Swap Test, Presiding Synthesis logic | `/services/tribunal/judges/`, `/bench/run.ts` | None | P0 | 12 |
| **Piyush** | Evidence Upload UI, Ruling Gallery, `docs/TEAM_PLAN.md` updates | `/web/app/ruling/`, `/web/app/evidence/` | Arshvir (API) | P0 | 8 |

### Phase 4: Frontend Integration (Days 9-11)
| Member | Task | Files Touched | Dependencies | Priority | Hours |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Arshvir** | API <> Tribunal wiring, Hash verification endpoint | `/services/api/` | Rutu (Tribunal) | P0 | 5 |
| **Rutu** | Bias-eval dashboard generation, Benchmark execution | `/bench/` | None | P1 | 6 |
| **Piyush** | Live timeline polling, End-to-end UX flow polish | `/web/components/Timeline.tsx` | Arshvir (API) | P0 | 10 |

### Phase 5: Evaluation & Polish (Days 12-13)
| Member | Task | Files Touched | Dependencies | Priority | Hours |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Arshvir** | Cost/token tracking per case, CloudWatch dashboard | `/infra/ObsStack.ts`, `/services/tribunal/` | None | P1 | 4 |
| **Rutu** | 3 Scripted Demo Cases for `/demo/run` | `/bench/demo-cases/` | None | P0 | 5 |
| **Piyush** | Demo video recording, Builder Center writeup, Pitch slides | `/docs/` | Rutu (Demo cases) | P0 | 8 |

### Phase 6: Stretch & Submission (Day 14)
| Member | Task | Files Touched | Dependencies | Priority | Hours |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Arshvir** | (P2) Solidity Escrow | `/contracts/ArbiterEscrow.sol` | None | P2 | 4 |
| **Rutu** | Final bias-eval report generation | `/docs/bias-eval.md` | None | P1 | 2 |
| **Piyush** | Final ship-gate verification (logged out) | None | All (Code freeze) | P0 | 2 |

---

## 4. Day-by-Day Schedule

| Day | Arshvir (Backend/AWS) | Rutu (AI/Data) | Piyush (Web/Docs) | Checkpoints |
| :--- | :--- | :--- | :--- | :--- |
| **1** | AWS Account Setup, IAM, CDK Skeleton | Model access, Guardrails config | Next.js Init, GitHub setup | **Code Contracts Frozen** |
| **2** | Cognito AuthStack, S3 & DynamoDB | Contract Templates, Archetypes | Amplify Deploy, Landing Page | Web & Auth live |
| **3** | Create Case API, Escrow Ledger | Textract Intake lambda | API mock wiring, Deal UI | |
| **4** | Upload Evidence API | Bench generation script | Evidence Upload UI | |
| **5** | Step Functions Workflow Shell | 3 Bedrock Judges logic | Ruling Page UI shell | |
| **6** | Step Functions Wiring | Cross-exam & Swap Test | Timeline UI shell | **Checkpoint 1: Upload to S3 works** |
| **7** | Ledger conditional writes | Presiding Judge synthesis | Bias-eval Dashboard UI | |
| **8** | API Polling for execution | Gold label verification | Polish Evidence UI | |
| **9** | Hash verification API | Refine prompts & error handling | Live Timeline polling | **Checkpoint 2: Mock Tribunal runs** |
| **10** | Fix API/Ledger edge cases | Run synthetic benchmark | End-to-end Deal to Ruling flow | |
| **11** | SES/SNS notifications (P1) | Analyze benchmark results | `demo/run` button implementation | |
| **12** | CloudWatch Alarms & ObsStack | Craft 3 Scripted Demo Cases | Demo video recording | **Checkpoint 3: End-to-End `demo/run`** |
| **13** | Code Review & Security pass | Bias Eval slide | Builder Center Page, README | |
| **14** | Submit. (Stretch: Solidity testnet) | Submit. | Logged-out Ship-Gate test | **Feature Freeze / Submission** |

---

## 5. Git Workflow

- **Branch Naming:** `<initial>/<type>/<ticket-or-feature>` (e.g., `a/feat/dynamo-ledger`, `r/fix/cross-exam-prompt`, `p/ui/landing-page`).
- **PR Rules:** All changes require a Pull Request to `main`. At least 1 approval is required from a teammate.
- **Main Branch:** Protected. Merges to `main` are handled by **Arshvir** (as DevOps lead) after review.
- **CDK Stack Conflicts:** 
  - One owner per stack (Arshvir owns Infra).
  - **Deploy Rule:** Only **Arshvir** runs `cdk deploy` against the `main` environment. Rutu and Piyush run `npm run dev` locally or test against the cloud environment after Arshvir deploys.

---

## 6. AWS Access Plan

- **Account Holder:** **Arshvir** owns the root account and billing.
- **Team Access:** Arshvir sets up AWS IAM Identity Center (SSO) and creates restricted IAM roles for Rutu and Piyush.
- **Rutu's Role:** Bedrock, S3, Textract, CloudWatch read/invoke access.
- **Piyush's Role:** Amplify, API Gateway read access (primarily uses the deployed endpoints).
- **Deployment:** **Arshvir** is the only one who runs `cdk deploy --all` to prevent state lock conflicts and drift.

---

## 7. Hackathon-Specific Tasks (Owners & Deadlines)

| Task | Owner | Deadline |
| :--- | :--- | :--- |
| Coding Agent Connection Proof (All 3 members must log in `LOG.md`) | Arshvir (lead) | Day 2 |
| AWS Budgets Alert | Arshvir | Day 1 |
| Demo Video (3 mins) | Piyush | Day 13 |
| Bias-Eval Results Publish | Rutu | Day 13 |
| Builder Center Project Page | Piyush | Day 13 |
| Category (`#commercial-potential`) & Lane (`#startup`) Tags | Piyush | Day 14 |
| Final Logged-Out Ship-Gate Test | Piyush | Day 14 |

---

## 8. Risks and Blockers

| Risk | Mitigation / Fallback |
| :--- | :--- |
| **Tribunal waiting on API:** Rutu needs to test Step Functions, but Arshvir hasn't finished the API. | Rutu triggers Step Functions directly via AWS Console/CLI using frozen JSON mock inputs. |
| **Frontend waiting on Tribunal:** Piyush needs to build the timeline, but Step Functions isn't ready. | Piyush uses a hardcoded `/cases/{id}` mock API response that slowly advances through states over time. |
| **Bedrock Quotas/Throttling:** Rutu hits rate limits running the 50-case benchmark. | Arshvir requests quota increase Day 1. Rutu builds a script with exponential backoff and limits concurrent executions. |
| **Frontend waiting on Auth:** Piyush needs to test login. | Arshvir deploys AuthStack first. Piyush builds a "demo mode" guest fallback. |

---

## 9. Cut List (If behind schedule)

If we fall behind, features will be dropped in this strict order to preserve the P0 Ship-Gate:
1. **P2: Solidity Escrow** (Never start this until everything else is 100% done).
2. **P1: Human Review Queue** (Always auto-resolve or fail gracefully).
3. **P1: Appeal Window** (Settle immediately in all modes).
4. **P1: Email Notifications (SES)** (Assume users poll the timeline).
5. **P1: Bias-Eval Dashboard UI** (Fallback: generate a markdown report via CLI instead of a UI dashboard).
6. **P0 (Partial): Cross-Examination Round 2** (Limit cross-exam to 1 round to save time/latency).
