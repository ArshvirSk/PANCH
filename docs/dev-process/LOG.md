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
