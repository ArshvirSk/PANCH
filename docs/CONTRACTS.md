# Contracts (Frozen)

This document outlines the shared interfaces, schemas, and configurations that are frozen for Phase 1. 
These act as the boundary between the Frontend (Piyush), AI/Data (Rutu), and Infra/Backend (Arshvir).

**RULE:** Any changes to the files in `services/shared` (types, schemas, ledger logic, SSM constants) must be made through a Pull Request reviewed by Arshvir. No exceptions.

## Frozen Contracts

1. **Judge Output Schema:** The strict JSON schema every model must output, containing `findingsOfFact`, `clausesRelied`, `payeeShareBps`, `reasoning`, `confidence`, and `uncertainties`.
2. **Cross-Examination Schema:** The schema for a judge critiquing others and producing a `revisedRuling`.
3. **API Types:** `CreateDeal`, `EvidenceUpload` requests and responses. Case and Ruling retrieval endpoints per TRD section 4.
4. **DynamoDB Entities:** `CaseItem`, `EvidenceItem`, `RulingItem`, `LedgerItem`, `BenchCaseItem`, `BenchRunItem`.
5. **Ledger:** The events (`FUND`, `DISPUTE`, `RESOLVE`, `RELEASE`), and the hash chain logic: `entryHash = sha256(prevHash|event|amount|caseId)` (first entry prevHash = "GENESIS").
6. **S3 Keys:** Exact string templates for evidence, extracted text, and rulings.
7. **SSM Parameters:** The keys for the 3 judges and presiding judge model IDs, their `-mode` settings, and configuration thresholds.
8. **Step Functions IO Contracts:** Every Step Functions task (`intake`, `blind`, `judge`, `crossExam`, `swapTest`, `aggregate`, `presiding`, `publish`, `settle`, `notify`) has heavily typed inputs and outputs defined in `step-functions.ts`.
9. **Bedrock Helper:** `invokeJudgeModel(role, params)` helper in `helpers.ts` retrieves the specific model configuration from SSM and invokes Bedrock.

## Usage

Frontend and Tribunal tasks should import types and mock data from `services/shared` rather than redefining them. Mocks are available via the mock API server for parallel development.

## H. Review API (Phase 6)
- \GET /reviews\: Lists cases in ESCALATED state. Re-uses the Cognito Auth.
- \POST /reviews/{caseId}\: Accepts \{ payeeShareBps, note }\. Writes Rulings entry with \humanReviewed: true\ and resolves/releases funds.
*(Scope cut: Any authenticated user can call this route during the hackathon, no special role needed)*

## Workflow Integration Notes for Rutu
- Replace \services/tribunal/stubs/*\ with real handlers. The interface remains the same and no WorkflowStack changes are needed.
- Replace the placeholder Guardrail config with \services/tribunal/guardrail-config.json\ once available.

## Starting an execution directly from the CLI
Rutu can start a tribunal run without going through the API:

```
aws sso login --profile panch
aws stepfunctions start-execution \
  --state-machine-arn arn:aws:states:us-east-1:890742603792:stateMachine:TribunalStateMachine6A233CFC-qgpRfMTRy6vo \
  --input '{"caseId":"<caseId>"}'
```

- The fixture input is just `{"caseId":"<caseId>"}` — everything else is read from DynamoDB and S3.
- The state machine ARN above is the deployed one (verified live 2026-09-28); re-derive it with `aws stepfunctions list-state-machines` if a redeploy ever changes it.
- **Precondition (Phase 16 ledger guard): the seeded case row must have `status: DELIBERATING` before start-execution.** Settle only appends RESOLVE/RELEASE from DELIBERATING/ESCALATED, so a DISPUTED seed passes the run and then fails at SETTLE.
- Also seed the evidence at `panch-evidence/{caseId}/extracted/e-1.txt` and a fallback at `bench/demo/{caseId}/fallback-ruling.json` (the catch path copies that fallback into `panch-rulings/{caseId}/ruling.json`).
- Before starting, run `./scripts/verify-access.sh` — it checks every permission this one-liner depends on.
