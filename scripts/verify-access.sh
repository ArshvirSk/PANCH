#!/usr/bin/env bash
# verify-access.sh — read-only pre-flight check for Panch tribunal work (Rutu).
#
# Verifies the access per TEAM_PLAN section 5 against the shared dev account
# and prints PASS/FAIL per permission. Run this BEFORE starting any work:
#
#   aws sso login --profile panch
#   ./scripts/verify-access.sh
#
# Checks (all read-only, except the Bedrock ping):
#   1. sts get-caller-identity         — session valid + which account you hit
#   2. ssm get-parameter               — /panch/models/* and /panch/config/* keys
#   3. s3 ls on the bench/demo prefix  — read/write round-trip into a tmp- prefix
#   4. stepfunctions list-executions   — plus describe/get-history on the latest
#   5. bedrock-runtime converse        — tiny "Reply OK" ping on each model from
#                                        SSM (~20 tokens each, no state written)
# Note: Textract is granted per TEAM_PLAN section 5 but has no free read-only
# probe (it needs a document); it is exercised by the pipeline itself.
#
# Exit code 0 = all PASS, 1 = at least one FAIL.

set -u

export MSYS_NO_PATHCONV=1   # Git Bash on Windows mangles /panch/... into a C:\ path
export AWS_PROFILE="${AWS_PROFILE:-panch}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="$AWS_REGION"

PASS=0
FAIL=0
MODEL_IDS=()
CONFIG_KEYS=()

ok()   { PASS=$((PASS+1)); echo "[PASS] $*"; }
bad()  { FAIL=$((FAIL+1)); echo "[FAIL] $*"; }
note() { echo "       $*"; }

command -v aws >/dev/null 2>&1 || { echo "[FAIL] aws CLI not installed"; exit 1; }

echo "== 1. STS session =="
IDENT=$(aws sts get-caller-identity --output json 2>/dev/null)
if [ -n "$IDENT" ]; then
  ACCT=$(echo "$IDENT" | grep -o '"Account": *"[^"]*"' | head -1 | sed 's/.*"Account": *"\([^"]*\)"/\1/')
  ARN=$(echo "$IDENT" | grep -o '"Arn": *"[^"]*"' | head -1 | sed 's/.*"Arn": *"\([^"]*\)"/\1/')
  ok "sts get-caller-identity — account $ACCT"
  note "identity: $ARN"
  if [ "$ACCT" != "890742603792" ]; then
    bad "wrong account — expected the shared dev account 890742603792"
  fi
else
  bad "sts get-caller-identity — no valid session. Run: aws sso login --profile $AWS_PROFILE"
  echo "Summary: $PASS PASS, $FAIL FAIL"
  exit 1
fi

echo "== 2. SSM parameters (model IDs + config) =="
for key in /panch/models/judge-1 /panch/models/judge-2 /panch/models/judge-3 /panch/models/presiding; do
  val=$(aws ssm get-parameter --name "$key" --query Parameter.Value --output text 2>/dev/null)
  if [ -n "$val" ] && [ "$val" != "None" ]; then
    ok "ssm get-parameter $key = $val"
    MODEL_IDS+=("$val")
  else
    bad "ssm get-parameter $key"
  fi
done
for key in /panch/config/spread-threshold-bps /panch/config/max-crossexam-rounds; do
  val=$(aws ssm get-parameter --name "$key" --query Parameter.Value --output text 2>/dev/null)
  if [ -n "$val" ] && [ "$val" != "None" ]; then
    ok "ssm get-parameter $key = $val"
    CONFIG_KEYS+=("$key=$val")
  else
    bad "ssm get-parameter $key"
  fi
done

echo "== 3. S3 bench/demo read/write on the evidence bucket =="
EV_BUCKET=$(aws ssm get-parameter --name /panch/data/buckets/evidence --query Parameter.Value --output text 2>/dev/null)
if [ -n "$EV_BUCKET" ] && [ "$EV_BUCKET" != "None" ]; then
  ok "ssm get-parameter /panch/data/buckets/evidence = $EV_BUCKET"
  COUNT=$(aws s3 ls "s3://$EV_BUCKET/bench/demo/" 2>/dev/null | wc -l | tr -d ' ')
  if [ -n "$COUNT" ] && [ "$COUNT" -ge 1 ]; then
    ok "s3 ls s3://$EV_BUCKET/bench/demo/ ($COUNT entries)"
  else
    bad "s3 ls s3://$EV_BUCKET/bench/demo/ — empty or denied"
  fi
  TMP_KEY="bench/demo/tmp-verify-access-$$/probe.txt"
  if echo "panch access probe" | aws s3 cp - "s3://$EV_BUCKET/$TMP_KEY" >/dev/null 2>&1 \
     && aws s3 cp "s3://$EV_BUCKET/$TMP_KEY" - >/dev/null 2>&1; then
    ok "s3 put+get round-trip on bench/demo prefix"
    aws s3 rm "s3://$EV_BUCKET/$TMP_KEY" >/dev/null 2>&1
  else
    bad "s3 put+get round-trip on bench/demo prefix"
  fi
else
  bad "cannot resolve evidence bucket from /panch/data/buckets/evidence"
fi

echo "== 4. Step Functions on the Tribunal state machine =="
SM_ARN=$(aws stepfunctions list-state-machines \
  --query 'stateMachines[?starts_with(name, `TribunalStateMachine`)] | [0].stateMachineArn' \
  --output text 2>/dev/null)
if [ -n "$SM_ARN" ] && [ "$SM_ARN" != "None" ]; then
  ok "states: discovered Tribunal state machine"
  note "$SM_ARN"
  EXEC=$(aws stepfunctions list-executions --state-machine-arn "$SM_ARN" --max-results 1 \
    --query 'executions[0].executionArn' --output text 2>/dev/null)
  if aws stepfunctions list-executions --state-machine-arn "$SM_ARN" --max-results 5 >/dev/null 2>&1; then
    ok "states list-executions"
  else
    bad "states list-executions"
  fi
  if [ -n "$EXEC" ] && [ "$EXEC" != "None" ]; then
    if aws stepfunctions describe-execution --execution-arn "$EXEC" >/dev/null 2>&1; then
      ok "states describe-execution (latest execution)"
    else
      bad "states describe-execution"
    fi
    if aws stepfunctions get-execution-history --execution-arn "$EXEC" --max-results 1 >/dev/null 2>&1; then
      ok "states get-execution-history"
    else
      bad "states get-execution-history"
    fi
  else
    note "no executions yet — describe/history untested (not a failure)"
  fi
else
  bad "states list-state-machines — TribunalStateMachine not found or denied"
fi

echo "== 5. Bedrock Converse ping per judge model (small paid calls, ~20 tokens each) =="
if [ "${#MODEL_IDS[@]}" -eq 0 ]; then
  bad "no model IDs resolved from SSM — cannot probe Bedrock"
else
  for mid in "${MODEL_IDS[@]}"; do
    resp=$(aws bedrock-runtime converse --model-id "$mid" \
      --messages '[{"role":"user","content":[{"text":"Reply with the single word OK."}]}]' \
      --output json 2>/dev/null)
    if [ -n "$resp" ]; then
      ok "bedrock converse $mid"
    else
      bad "bedrock converse $mid"
    fi
  done
fi

echo
echo "Summary: $PASS PASS, $FAIL FAIL"
[ "$FAIL" -eq 0 ] || { echo "Access gaps above. If your session expired: aws sso login --profile $AWS_PROFILE"; exit 1; }
echo "You are unblocked for tribunal work (handlers, prompts, bench/demo runs)."
