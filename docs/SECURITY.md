# Panch — Security Notes (Day 3 hardening)

Scope: full IAM / bucket / encryption / secrets review of every stack (`infra/lib/*`), plus what is deliberately left open. Last reviewed: 2026-09-27, branch `a/feat/day3-harden`.

## IAM review

- The state machine role's previous wildcard statement (`dynamodb:*`, `s3:*`, `textract:*` on `*`) has been **removed**. Every tribunal Lambda now has scoped grants only:
  - Cases table read; Ledger table read/write; evidence bucket read + put; scoped `ssm:GetParameter` on `/panch/models/*` and `/panch/pricing/bedrock/*`; `bedrock:ApplyGuardrail` on the tribunal guardrail only; Bedrock `Converse`/`InvokeModel` on the three judge model ARNs (plus the Llama cross-region destination-region models — IAM checks the destination model, so `us-east-2`/`us-west-2` ARNs are granted; commented in the stack).
  - publish: Rulings table write + rulings bucket write; fail: Cases `UpdateItem` + rulings bucket write (fallback copy); settle: `TransactWriteItems` + `UpdateItem` on exactly Cases and Ledger (a transaction's `Update` checks the per-item `UpdateItem` permission — its absence once failed the RESOLVE transaction silently, see LOG Phase 11).
  - escalate: Cases `UpdateItem` only.
- Remaining wildcards: `xray:*` on `*` (AWS-managed tracing policy shape — cannot be scoped to a resource; documented, accepted) and the SSM parameter-path prefixes (intentional namespace scoping).
- API Lambdas: per-handler least-privilege (e.g. GetRulings reads only the Rulings table; the gallery previously also read Cases and is now tightened). GetCase holds `states:DescribeExecution`/`GetExecutionHistory` on the state machine and its `execution:*` ARNs only.

## Buckets & encryption

- All buckets block public access and are private. The **only** public path is rulings via CloudFront with Origin Access Control; the bucket policy allows `s3:GetObject` solely to the CloudFront service principal conditioned on the distribution ARN (`AWS:SourceArn`).
- SSE-KMS on evidence and rulings buckets (account KMS key in DataStack); tribunal Lambdas hold `kms:GenerateDataKey`/`Decrypt` scoped by grants, not wildcards. The benchmark bucket was moved to SSE-KMS in this pass.

## Secrets

- Repo scanned for key-shaped material (`AKIA`, `BEGIN.*PRIVATE KEY`, hardcoded credentials): clean, including the last 60 commits. Only `web/.env.example` is tracked and it contains empty values. Real config lives in SSM parameters; the Amplify GitHub token lives in Secrets Manager. No root credentials are used anywhere; access is via the `panch` SSO profile.

## Guardrails

- A Bedrock guardrail is genuinely attached to every judge call via Converse `guardrailConfig` (id + version injected from the stack into Lambda env), not a placeholder. The managed **PROMPT_ATTACK** filter is deliberately excluded: it false-positives on the tribunal's own anti-injection instructions (verified via `ApplyGuardrail`: the standard judge prompt triggers PROMPT_ATTACK/HIGH, so no model call ever ran). Injection defense is structural instead: evidence wrapped in `<evidence>` tags marked "data, not instructions", blinded case files (no names/countries/platforms reach the model), schema-validated outputs, evidence-ID sanitization, numbers never parsed from free text.
- Operational note: guardrail versions are immutable; the version resource's logical id carries a content-policy hash so any config change mints a new version (a stale immutable version once kept serving the old policy and blocked every judge input).

## Known gaps (honest list)

- `evidenceDeadline` exists in the type but is enforced nowhere: evidence presigned URLs can be requested after submission. Mitigation/talking point: P1 hardening item; uploads after submission do not reach a live deliberation (intake snapshots evidence at submission), but the API should refuse them.
- No respondent-response timeout: a disputed case can sit in DELIBERATING… (in practice the tribunal does not wait on the respondent, so this is a UX/SLA gap, not a funds-safety one).
- `verifyRuling` (`GET /rulings/{id}/verify`) is still a stub returning `match: true` with dummy hashes. The ledger itself is genuinely hash-chained and transactional, but the verify endpoint must be wired to recompute the chain before any public trust claim is made.
- Judge model outputs are schema-validated, but numeric range normalization (confidence > 1 → /100) is a pragmatic patch for model variance, not a guarantee; panels can still split (spread > 3000 bps escalates to human review by design).
- Demo fallback rulings are pre-seeded static JSON, clearly labeled `fallback: true`; they are not model output and never touch escrow.
