#!/usr/bin/env bash
# Runs the HIDDEN edge-case tests for one task and records the result.
#
# The hidden tests live OUTSIDE this repository (in ~/taskflow-experiment-private)
# so they cannot be read while a task is being implemented. This script copies
# them into a scratch folder, runs them, prints pass/fail counts, and removes
# them again. Nothing is left behind.
#
# Usage:
#   experiment/score-hidden.sh <task>                     # uses the active run's worktree
#   experiment/score-hidden.sh <task> <worktree-path>     # explicit worktree
#
# Output: a counts line on stdout, plus a JSON record appended to
# experiment/ledger/hidden-results.jsonl in the MAIN checkout for the scorecard.

set -uo pipefail

TASK="${1:-}"
if [[ -z "$TASK" ]]; then
  echo "usage: experiment/score-hidden.sh <task-id> [worktree-path]" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRIVATE_DIR="${TASKFLOW_PRIVATE_TESTS:-$HOME/taskflow-experiment-private}"
SOURCE_DIR="$PRIVATE_DIR/tests"
STATE_FILE="$REPO_ROOT/experiment/ledger/.current-run.json"
LEDGER_DIR="$REPO_ROOT/experiment/ledger"

# Resolve the worktree: explicit argument wins, otherwise the active run's.
WORKTREE="${2:-}"
if [[ -z "$WORKTREE" && -f "$STATE_FILE" ]]; then
  WORKTREE=$(python3 - "$STATE_FILE" <<'PY'
import json, sys
with open(sys.argv[1]) as handle:
    print(json.load(handle).get("worktree", ""))
PY
)
fi
if [[ -z "$WORKTREE" ]]; then
  echo "no worktree given and no active run; pass <task> <worktree-path>" >&2
  exit 2
fi
if [[ ! -d "$WORKTREE/src" ]]; then
  echo "not a TaskFlow worktree: $WORKTREE" >&2
  exit 2
fi
if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "hidden test directory not found: $SOURCE_DIR" >&2
  exit 3
fi

# Only run hidden tests whose filename declares this task id.
# (macOS ships bash 3.2, so mapfile/readarray are unavailable.)
MATCHES=()
while IFS= read -r found; do
  MATCHES+=("$found")
done < <(find "$SOURCE_DIR" -maxdepth 1 -name "*${TASK}*.test.ts" | sort)

if [[ ${#MATCHES[@]} -eq 0 ]]; then
  echo "no hidden tests found for $TASK in $SOURCE_DIR" >&2
  exit 4
fi

# Land at depth 2 so the ../../src imports resolve as they do in the main
# checkout, and outside the worktree so nothing pollutes the measured diff.
LANDING_DIR="$WORKTREE/acceptance/hidden"
CONFIG="$WORKTREE/acceptance/vitest.hidden.config.ts"

cleanup() {
  rm -rf "$LANDING_DIR"
  rm -f "$CONFIG"
}
trap cleanup EXIT

mkdir -p "$LANDING_DIR" "$LEDGER_DIR"
for file in "${MATCHES[@]}"; do
  cp "$file" "$LANDING_DIR/"
done

cat > "$CONFIG" <<'EOF'
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['acceptance/hidden/**/*.test.ts'],
    restoreMocks: true,
    testTimeout: 30_000,
    env: { TASKFLOW_AI_PROVIDER: 'none' },
  },
});
EOF

echo "== hidden tests for $TASK in $WORKTREE =="
LOG="$LEDGER_DIR/.hidden-$TASK.log"
( cd "$WORKTREE" && corepack pnpm vitest run --config acceptance/vitest.hidden.config.ts ) 2>&1 | tee "$LOG"
STATUS=${PIPESTATUS[0]}

PASSED=$(grep -Eo '[0-9]+ passed' "$LOG" | tail -1 | grep -Eo '[0-9]+' || echo 0)
FAILED=$(grep -Eo '[0-9]+ failed' "$LOG" | tail -1 | grep -Eo '[0-9]+' || echo 0)
rm -f "$LOG"

BRANCH=$(git -C "$WORKTREE" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{"task":"%s","branch":"%s","passed":%s,"failed":%s,"exit":%s,"at":"%s"}\n' \
  "$TASK" "$BRANCH" "$PASSED" "$FAILED" "$STATUS" "$STAMP" >> "$LEDGER_DIR/hidden-results.jsonl"

cleanup
echo "hidden $TASK: $PASSED passed, $FAILED failed"
exit "$STATUS"

