#!/usr/bin/env bash
# Runs the HIDDEN edge-case tests for one task and records the result.
#
# The hidden tests live OUTSIDE this repository (in ~/taskflow-experiment-private)
# so they cannot be read while a task is being implemented. This script copies
# them into the working tree, runs them, prints pass/fail counts, and removes
# them again. Nothing is left behind.
#
# Usage:  experiment/score-hidden.sh T01
# Output: one line of counts on stdout, plus a JSON record in
#         experiment/ledger/hidden-results.jsonl for the scorecard.

set -uo pipefail

TASK="${1:-}"
if [[ -z "$TASK" ]]; then
  echo "usage: experiment/score-hidden.sh <task-id>" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRIVATE_DIR="${TASKFLOW_PRIVATE_TESTS:-$HOME/taskflow-experiment-private}"
SOURCE_DIR="$PRIVATE_DIR/tests"
LANDING_DIR="$REPO_ROOT/experiment/tests-hidden"
CONFIG="$REPO_ROOT/experiment/vitest.hidden.config.ts"
LEDGER_DIR="$REPO_ROOT/experiment/ledger"

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

cleanup() {
  rm -rf "$LANDING_DIR"
  rm -f "$CONFIG"
}
trap cleanup EXIT

mkdir -p "$LANDING_DIR" "$LEDGER_DIR"
for file in "${MATCHES[@]}"; do
  cp "$file" "$LANDING_DIR/"
done

cat > "$CONFIG" <<EOF
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['experiment/tests-hidden/**/*.test.ts'],
    restoreMocks: true,
    testTimeout: 30_000,
    env: { TASKFLOW_AI_PROVIDER: 'none' },
  },
});
EOF

echo "== hidden tests for $TASK =="
cd "$REPO_ROOT"
corepack pnpm vitest run --config "$CONFIG" 2>&1 | tee "$LEDGER_DIR/.hidden-$TASK.log"
STATUS=${PIPESTATUS[0]}

PASSED=$(grep -Eo '[0-9]+ passed' "$LEDGER_DIR/.hidden-$TASK.log" | tail -1 | grep -Eo '[0-9]+' || echo 0)
FAILED=$(grep -Eo '[0-9]+ failed' "$LEDGER_DIR/.hidden-$TASK.log" | tail -1 | grep -Eo '[0-9]+' || echo 0)
rm -f "$LEDGER_DIR/.hidden-$TASK.log"

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
mkdir -p "$LEDGER_DIR"
printf '{"task":"%s","branch":"%s","passed":%s,"failed":%s,"exit":%s,"at":"%s"}\n' \
  "$TASK" "$BRANCH" "$PASSED" "$FAILED" "$STATUS" "$STAMP" >> "$LEDGER_DIR/hidden-results.jsonl"

cleanup
echo "hidden $TASK: $PASSED passed, $FAILED failed"
exit "$STATUS"
