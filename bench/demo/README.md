# Demo cases A/B/C (TRD §13 "Workflow: integration runs on 3 demo cases")

Three complete benchmark cases for the tribunal: one clear claimant win, one
clear respondent win, one genuine split (the escalation-path demo). Gold labels
were fixed **before** any panel run — that is the point of a gold label — and
each case carries a cached fallback ruling for the demo-day Catch path.

## Layout

| File | Purpose |
| --- | --- |
| `contract.txt`, `chat.txt`, `invoice.txt` | Source artifacts (human review / future tooling) |
| `extracted-e-1.txt` | The combined evidence text seeded to `panch-evidence/{caseId}/extracted/e-1.txt` at run time |
| `gold.json` | Pre-declared gold `payeeShareBps`, rationale, divergence rule, escalation expectations |
| `fallback-ruling.json` | Cached Catch-path ruling, copied byte-for-byte to `bench/demo/{caseId}/fallback-ruling.json` in S3 |

Note: the published artifact is `ruling.json` only. `ruling.md` mirrors were
removed in Phase 19 — nothing in the pipeline ever wrote or served a `.md`.

Single-artifact note: the real `intake.ts` emits exactly one contract evidence
item (`e-1`, key `panch-evidence/{caseId}/extracted/e-1.txt`), and `blind.ts`
inlines that extracted text into the blinded case file — so the three artifacts
are packed into one `e-1` text per case. Do not invent additional evidence IDs:
`sanitizeJudgeOutput` drops findings citing IDs absent from the case file.

## Cases

| Case | Scenario | Gold `payeeShareBps` | Escalation expected |
| --- | --- | --- | --- |
| `case-a` | Clear claimant win: non-payment after confirmed delivery | 10000 | No (one-sided facts) |
| `case-b` | Clear respondent win: no delivery, sketches invoiced as full fee | 0 | No |
| `case-c` | Genuine split: partial delivery, disputed scope, contested hold | 5000 (band 4000–6000) | By design (split panel) |

Case A's contract text is verbatim `services/api/demo.ts` `DEMO_CONTRACT_TEXT`
(checked before writing anything new), so Case A doubles as the shipped demo.

## Running a case live

Prereq: an AWS session with access to the panch account (SSM parameters and the
deployed stacks). `caseId` **must** start with `demo-` — `failHandler.ts` only
engages the cached fallback for `demo-*` cases.

Per case, replicate exactly what `POST /demo/run` does (see `services/api/demo.ts`):

1. Pick `caseId` (e.g. `demo-ba-<6 hex>`) and create the case row in the cases
   table with `status: DELIBERATING`, `isDemo: true`, `amountCents`:
   A `50000`, B `40000`, C `60000` (USD).
   **Why DELIBERATING, not DISPUTED:** `runDemo` flips the row to
   DELIBERATING before start-execution, and since the Phase 16 ledger guard a
   SETTLE against a DISPUTED case is an illegal transition (RESOLVE requires
   DELIBERATING or ESCALATED) — the workflow would fail at SETTLE. Seed the
   status the live demo path actually runs with.
   (If you want the FUND/DISPUTE ledger entries too, write them at seq 1/2
   with `prevHash: 'GENESIS'` and flip the row to DELIBERATING afterwards —
   same as `review-e2e.mjs` does for human-review cases.)
2. Put `extracted-e-1.txt` → S3 key `panch-evidence/{caseId}/extracted/e-1.txt`
   (the same bucket `intake.ts` reads; use the constants in
   `services/shared/constants.ts` — do not invent paths).
3. Put the case's `fallback-ruling.json` (with `caseId` filled in) →
   S3 key `bench/demo/{caseId}/fallback-ruling.json` — the exact key
   `failHandler.ts` copies to `panch-rulings/{caseId}/ruling.json` on failure.
4. `aws stepfunctions start-execution --state-machine-arn <TribunalStateMachine>
   --input '{"caseId":"<caseId>"}'`.
5. Poll execution status to `SUCCEED` (case SETTLED) or `FAILED` (Catch path —
   verify the fallback ruling is then served under
   `panch-rulings/{caseId}/ruling.json`).
6. Compare the settled award against `gold.json`. Apply the divergence rule as
   written there: report meaningful divergences as findings; do not edit
   `gold.json` to match the panel.

## Status (2026-09-28)

- Cases built, gold labels fixed pre-run, fallbacks written: done (this branch).
- Live executions, divergence report, and reachability confirmation against the
  deployed stack: **pending** — this session had no AWS credentials. See the
  Phase 15 entries in `docs/dev-process/LOG.md`.
