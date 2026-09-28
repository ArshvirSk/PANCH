#!/usr/bin/env bash
# require-deploy-lock.sh — pre-deploy coordination gate (Phase 17 follow-up).
#
# Why: during Phase 17 two actors deployed to the shared dev account at the
# same time (CFN showed overlapping stack updates) and a verified case's
# artifacts were deleted mid-session, unattributable. The team rule was
# already "only Arshvir runs cdk deploy, always from main" (TEAM_PLAN.md) —
# nothing enforced it. This script checks both halves before a deploy:
#
#   1. Working tree clean and on main (deploy exactly what main says).
#   2. A simple advisory lock in SSM so overlapping deploys fail fast.
#
# Usage (from infra/ or the repo root):
#   scripts/require-deploy-lock.sh <stack names...>
#     e.g. scripts/require-deploy-lock.sh PanchApiStack
#
# The lock auto-expires (TTL) so a crashed deploy cannot wedge the team.
set -euo pipefail

LOCK_PARAM="/panch/deploy/lock"
LOCK_TTL_MINUTES="${LOCK_TTL_MINUTES:-30}"
STACKS="${*:-ALL}"

command -v aws >/dev/null || { echo "aws CLI not found" >&2; exit 1; }

# --- 1. Branch + cleanliness -------------------------------------------------
branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "main" ]; then
  echo "REFUSED: deploys must run from main (current branch: $branch)." >&2
  echo "TEAM_PLAN deploy rule: merge to main first, then deploy." >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "REFUSED: working tree is dirty — deploy exactly what main has committed." >&2
  git status --short >&2
  exit 1
fi
git fetch --quiet origin main 2>/dev/null || true
local_head="$(git rev-parse HEAD)"
origin_head="$(git rev-parse origin/main 2>/dev/null || echo "$local_head")"
if [ "$local_head" != "$origin_head" ]; then
  echo "REFUSED: local main ($local_head) != origin/main ($origin_head). Pull or push first." >&2
  exit 1
fi

# --- 2. Advisory deploy lock (SSM, expiring) ---------------------------------
now="$(date -u +%s)"
expires_at="$(python -c "import time; print(int(time.time()) + $LOCK_TTL_MINUTES * 60)" 2>/dev/null \
  || echo $((now + LOCK_TTL_MINUTES * 60)))"
lock_value="holder=$(aws sts get-caller-identity --query Arn --output text 2>/dev/null | tr -d '\r'), acquired=$(date -u +%FT%TZ), expires=$expires_at, stacks=$STACKS"

existing="$(aws ssm get-parameter --name "$LOCK_PARAM" --with-decryption --query Parameter.Value --output text 2>/dev/null | tr -d '\r')" || existing=""
if [ -n "$existing" ]; then
  existing_expires="$(printf '%s' "$existing" | sed -n 's/.*expires=\([0-9]*\).*/\1/p')"
  if [ -n "$existing_expires" ] && [ "$now" -lt "$existing_expires" ]; then
    echo "REFUSED: another deploy holds the lock until $(date -u -d "@$existing_expires" 2>/dev/null || date -u -r "$existing_expires")." >&2
    echo "Lock: $existing" >&2
    echo "If you are certain it is stale, delete it:" >&2
    echo "  aws ssm delete-parameter --name $LOCK_PARAM" >&2
    exit 1
  fi
  echo "Stale lock found (expired), replacing: $existing" >&2
fi

aws ssm put-parameter --name "$LOCK_PARAM" --type String --value "$lock_value" --overwrite >/dev/null
echo "Deploy lock acquired (expires in ${LOCK_TTL_MINUTES}m): $lock_value"
echo "Run your deploy now, then release with:"
echo "  aws ssm delete-parameter --name $LOCK_PARAM"
