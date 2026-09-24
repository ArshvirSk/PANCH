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
