# Final validation results — demo cases A/B/C vs PRD § 9 (Phase 21)

Status: **BLOCKED on Bedrock model access** — every model invocation returns
`ValidationException: Error 002: Access to Bedrock models is not allowed for
this account` (account-level enablement; control plane works). Models ran
fine through 2026-09-28 (Phase 20); the block began after that. This file is
a committed skeleton: the catch-path result below is real and verified; the
PRD § 9 measurement rows are intentionally **UNMEASURED** rather than guessed.
Rerun the blocked rows via `scripts/tmp-validation/RUNBOOK.md` once model
access is restored, and fill them in here.

Environment: profile `panch` (SSO portal https://d-9f6758d40c.awsapps.com/start/,
portal region ap-south-1), account 890742603792, us-east-1,
`scripts/verify-access.sh` = 14 PASS / 4 FAIL (FAILs = the Bedrock pings only).

## PRD § 9 metrics

| Metric | PRD target | Result | Evidence |
| --- | --- | --- | --- |
| Agreement with gold on clear cases (A=10000, B=0) | > 85% | **UNMEASURED** — Bedrock Error 002; no panel ran | last known-good 2026-09-28: A 10000=gold, B 0=gold (LOG Phase 16) |
| Escalation on ambiguous case (C, gold 5000, band 4000–6000) | > 60% | **UNMEASURED** — Bedrock Error 002 | last known-good: C escalated by design, median 5000=gold (LOG Phase 16) |
| Swap-test flip rate | < 10% | **UNMEASURED** — no swap tests could run | last known-good: swaps consistent post-fix (LOG Phase 16) |
| Cost per case (Bedrock + AWS) | < $1 | **UNMEASURED** — no billable invocations succeeded | last known-good: $0.0315–0.0419/case (LOG Phase 16) |
| Public URL uptime during judging | 100% | not probed this session (out of blocked scope) | Phase 11 ship gates |
| End-to-end demo case time | < 5 min | **UNMEASURED** — no successful run | last known-good: ~40 s (LOG Phase 20) |

## Catch-path fallback — CONFIRMED LIVE (the one fully verified result)

Organic proof through the real state machine (not a mocked invocation):
seeded `demo-r17-b-ee3bff` (case-b fixture, DELIBERATING, e-1 + fallback at
the documented keys), `start-execution` → FAILED in ~25 s at JUDGES on Error
002 → Catch → FailLambda published the cached fallback.

| Check | Result |
| --- | --- |
| Published at `panch-rulings/demo-r17-b-ee3bff/ruling.json` | yes |
| `fallbackCopyIdentical` (published bytes == seeded fixture bytes) | **true** |
| Ledger events / escrow untouched | 0 events |
| Case row status | FAILED |
| Public CloudFront (`d1a3grqm50ahjl.cloudfront.net`) | HTTP 200 |
| CloudFront bytes vs S3 origin | hash-identical (`bytesMatch: true`) |
| Ruling flags | `fallback: true`, award 0 bps, caseId correct |

## Known limitations

- **Bedrock model access is account-level blocked (Error 002).** All live
  tribunal work — presiding synthesis, judge panels, swap tests, guardrail —
  fails at JUDGES until the three models (`amazon.nova-pro-v1:0`,
  `mistral.mistral-large-3-675b-instruct`, `us.meta.llama3-3-70b-instruct-v1:0`)
  are re-enabled for the account. Not an IAM or code issue: control-plane
  calls succeed, and the same calls succeeded on 2026-09-28.
- **Divergence rules pre-declared in `bench/demo/*/gold.json`** (A: settled
  < 8000 or sub-5000-judge escalation is divergence; B: settled > 2000 is
  divergence; C: band 4000–6000, escalation expected by design) — none could
  be evaluated this session.
- **`/panch/data/tables/*` SSM params do not exist** in this account
  (ParamNotFound); real tables are `PanchDataStack-{Cases,Ledger,Rulings,Evidence}<hash>`.
  Tooling that resolved names via those params was switched to `list-tables`
  discovery (scratch harness + probe, gitignored by policy).
- **Scratch validation tooling is gitignored** (`scripts/tmp-validation/` —
  presiding raw-response probe, seed/verify harness, CloudFront checker,
  runbook) per repo policy; only this file and LOG.md are committed. A real
  execution (post-unblock) is still required to produce
  `bench/artifacts/presiding-live-<date>.json`.
- **FailLambda direct-invocation variant** of the catch path was not
  re-exercised this session (needs Arshvir coordination per Phase 16); the
  organic Catch path above is proven end to end.
- **Single sample.** Even post-unblock, one run per case is not 3×; the
  3×-per-case protocol (and the optional swap-skip / 10-case extension) is
  queued in the runbook.
- Nothing deployed; no `/infra`, WorkflowStack, or `services/shared` changes;
  no SSM edits.
