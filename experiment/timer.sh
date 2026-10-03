#!/usr/bin/env bash
# Timing harness for the AI with-vs-without experiment.
#
#   experiment/timer.sh start <task> <ai|no-ai>   # creates a clean worktree and starts the clock
#   experiment/timer.sh mark                      # optional: record "first green" for rework
#   experiment/timer.sh stop                      # runs the visible test and writes the ledger row
#   experiment/timer.sh status
#
# You always run this from the MAIN checkout. The task branches (task/T00..T10)
# were cut from the baseline tag and contain no experiment/ folder, so `start`
# creates a git worktree at ~/taskflow-runs/<task> holding ONLY baseline code
# plus that single task's visible acceptance test. Tooling and the ledger stay
# in the main checkout.
#
# The 60-minute cap is REPORTED, never enforced: an over-long run is flagged
# timed_out=true so the outlier is visible instead of being silently truncated.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEDGER_DIR="$REPO_ROOT/experiment/ledger"
RUNS_CSV="$LEDGER_DIR/runs.csv"
STATE_FILE="$LEDGER_DIR/.current-run.json"
RUNS_ROOT="${TASKFLOW_RUNS_ROOT:-$HOME/taskflow-runs}"
CAP_MINUTES=60
ACCEPTANCE_DIR="acceptance"

mkdir -p "$LEDGER_DIR"

if [[ ! -f "$RUNS_CSV" ]]; then
  cat > "$RUNS_CSV" <<'EOF'
task,arm,start_iso,end_iso,minutes,timed_out,files_changed,insertions,deletions,commits,first_green_minutes,rework_minutes,rework_commits,visible_pass,visible_fail,notes
EOF
fi

die() { echo "timer: $*" >&2; exit 1; }

# Seeded-defect tasks. Only the filename is used, and nothing about it is printed.
seed_for_task() {
  case "$1" in
    T07) echo "bugX.patch" ;;
    T08) echo "bugY.patch" ;;
    *) echo "" ;;
  esac
}

state_field() {
  python3 - "$STATE_FILE" "$1" <<'PY'
import json, sys
with open(sys.argv[1]) as handle:
    value = json.load(handle).get(sys.argv[2], "")
print("" if value is None else value)
PY
}

set_state() {
  python3 - "$STATE_FILE" "$1" "$2" <<'PY'
import json, sys
path, key, value = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    with open(path) as handle:
        state = json.load(handle)
except (OSError, ValueError):
    state = {}
state[key] = int(value) if value.isdigit() else value
with open(path, "w") as handle:
    json.dump(state, handle)
PY
}

single_match() {
  local found=()
  while IFS= read -r line; do found+=("$line"); done < <(printf '%s\n' "$@")
  [[ ${#found[@]} -eq 1 ]] || die "expected exactly one match, found ${#found[@]}"
  printf '%s' "${found[0]}"
}

visible_test_for() {
  local task="$1" found=()
  while IFS= read -r line; do found+=("$line"); done < <(
    find "$REPO_ROOT/experiment/tests-visible" -maxdepth 1 -name "${task}.*.test.ts" | sort
  )
  [[ ${#found[@]} -eq 1 ]] || die "expected exactly one visible test for $task, found ${#found[@]}"
  printf '%s' "${found[0]}"
}

spec_path_for() {
  local task="$1" found=()
  while IFS= read -r line; do found+=("$line"); done < <(
    find "$REPO_ROOT/experiment/tasks" -maxdepth 1 -name "${task}-*.md" | sort
  )
  [[ ${#found[@]} -eq 1 ]] || die "expected exactly one task spec for $task, found ${#found[@]}"
  printf '%s' "${found[0]}"
}

# The acceptance test lands at depth 2 so its ../../src imports resolve exactly as
# they do in the main checkout, without creating an experiment/ dir in the worktree.
# T00 is the practice task and has no acceptance test; that is not an error.
install_acceptance() {
  local worktree="$1" task="$2" source=""
  if ! source=$(visible_test_for "$task" 2>/dev/null); then
    source=""
  fi
  mkdir -p "$worktree/$ACCEPTANCE_DIR/visible"
  [[ -n "$source" ]] && cp "$source" "$worktree/$ACCEPTANCE_DIR/visible/"
  cat > "$worktree/$ACCEPTANCE_DIR/vitest.acceptance.config.ts" <<EOF
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['acceptance/visible/**/*.test.ts'],
    restoreMocks: true,
    testTimeout: 30_000,
    env: { TASKFLOW_AI_PROVIDER: 'none' },
  },
});
EOF
}

link_dependencies() {
  local worktree="$1"
  [[ -e "$worktree/node_modules" ]] && return 0
  ln -s "$REPO_ROOT/node_modules" "$worktree/node_modules"
}

cmd_start() {
  local task="${1:-}" arm="${2:-}"
  [[ -n "$task" && -n "$arm" ]] || die "usage: timer.sh start <task> <ai|no-ai>"
  [[ "$arm" == "ai" || "$arm" == "no-ai" ]] || die "arm must be 'ai' or 'no-ai'"
  [[ -f "$STATE_FILE" ]] && die "a run is already open for task $(state_field task); run 'stop' first"
  git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository"

  local branch="task/$task"
  git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$branch" || die "branch $branch does not exist"

  local worktree="$RUNS_ROOT/$task" spec
  mkdir -p "$RUNS_ROOT"
  [[ -e "$worktree" ]] && die "$worktree already exists; remove that run before starting $task"
  spec=$(spec_path_for "$task")

  git -C "$REPO_ROOT" worktree add --quiet "$worktree" "$branch" \
    || die "could not create a worktree at $worktree"

  install_acceptance "$worktree" "$task"
  link_dependencies "$worktree"

  # Seeded-defect tasks get their starting state committed, so the diff stats
  # recorded at stop measure only the developer's own work.
  local patch; patch=$(seed_for_task "$task")
  if [[ -n "$patch" ]]; then
    ( cd "$worktree" && git apply --quiet "$REPO_ROOT/experiment/seeds/$patch" ) \
      || die "could not prepare the starting state for $task"
    ( cd "$worktree" && git commit --quiet -a -m "Seeded starting state" ) \
      || die "could not record the starting state for $task"
  fi

  local start_commit started start_epoch
  start_commit=$(git -C "$worktree" rev-parse HEAD)
  started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  start_epoch=$(date -u +%s)

  cat > "$STATE_FILE" <<EOF
{"task":"$task","arm":"$arm","branch":"$branch","worktree":"$worktree","start_commit":"$start_commit","start_iso":"$started","start_epoch":$start_epoch}
EOF

  echo "worktree:  $worktree"
  echo "task spec: $spec"
  echo "time cap:  ${CAP_MINUTES} minutes (flagged, never cut off)"
  if [[ "$arm" == "no-ai" ]]; then
    echo "arm:       no-ai - turn OFF Cline and Copilot for this whole run"
  else
    echo "arm:       ai - use the assistant as you normally would"
  fi
}

cmd_mark() {
  [[ -f "$STATE_FILE" ]] || die "no run is open"
  local start_epoch now elapsed
  start_epoch=$(state_field start_epoch)
  [[ -n "$start_epoch" ]] || die "state file has no start_epoch"
  now=$(date -u +%s)
  elapsed=$(( now - start_epoch ))
  set_state first_green_epoch "$elapsed"
  echo "timer: first green marked at $(( elapsed / 60 ))m"
}

cmd_stop() {
  [[ -f "$STATE_FILE" ]] || die "no run is open"

  local start_epoch first_green_epoch worktree start_commit
  start_epoch=$(state_field start_epoch)
  first_green_epoch=$(state_field first_green_epoch)
  worktree=$(state_field worktree)
  start_commit=$(state_field start_commit)
  [[ -n "$start_epoch" ]] || die "state file has no start_epoch"
  [[ -d "$worktree" ]] || die "worktree $worktree is missing; the run cannot be measured"

  local ended end_epoch elapsed minutes
  ended=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  end_epoch=$(date -u +%s)
  elapsed=$(( end_epoch - start_epoch ))
  minutes=$(( elapsed / 60 ))

  local timed_out=false
  if (( elapsed > CAP_MINUTES * 60 )); then timed_out=true; fi

  # Code-change volume since the starting commit, excluding the acceptance copy.
  local numstat files_changed insertions deletions
  numstat=$(git -C "$worktree" diff --numstat "$start_commit" -- . ":(exclude)$ACCEPTANCE_DIR" 2>/dev/null)
  files_changed=$(printf '%s\n' "$numstat" | grep -c '^[0-9]' || true)
  insertions=$(printf '%s\n' "$numstat" | awk '{s+=$1} END {print s+0}')
  deletions=$(printf '%s\n' "$numstat" | awk '{s+=$2} END {print s+0}')

  local commits
  commits=$(git -C "$worktree" rev-list --count "$start_commit"..HEAD 2>/dev/null || echo 0)

  # Acceptance gate: the task only counts as done if its own visible test passes.
  local task visible_pass visible_fail log
  task=$(state_field task)
  log="$LEDGER_DIR/.visible-$task.log"
  install_acceptance "$worktree" "$task"
  if [[ -n "$(find "$worktree/$ACCEPTANCE_DIR/visible" -name '*.test.ts' 2>/dev/null)" ]]; then
    ( cd "$worktree" && corepack pnpm vitest run --config "$ACCEPTANCE_DIR/vitest.acceptance.config.ts" ) > "$log" 2>&1
    visible_pass=$(grep -Eo '[0-9]+ passed' "$log" | tail -1 | grep -Eo '[0-9]+' || echo 0)
    visible_fail=$(grep -Eo '[0-9]+ failed' "$log" | tail -1 | grep -Eo '[0-9]+' || echo 0)
  else
    visible_pass="n/a"; visible_fail="n/a"
  fi
  rm -f "$log"

  local rework_minutes="" rework_commits=""
  if [[ -n "$first_green_epoch" ]]; then
    rework_minutes=$(( elapsed - first_green_epoch ))
    rework_commits=$commits
  fi

  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
    "$task" "$(state_field arm)" "$(state_field start_iso)" \
    "$ended" "$minutes" "$timed_out" "$files_changed" "$insertions" "$deletions" \
    "$commits" "${first_green_epoch:-}" "${rework_minutes:-}" "${rework_commits:-}" \
    "$visible_pass" "$visible_fail" "" >> "$RUNS_CSV"

  if [[ "$timed_out" == "true" ]]; then
    echo "timer: NOTE - ${minutes}m exceeded the ${CAP_MINUTES}-minute cap; flagged, not truncated."
  fi
  echo "timer: $task stopped at ${minutes}m | files $files_changed +$insertions/-$deletions | commits $commits | visible $visible_pass passed, $visible_fail failed"
  rm -f "$STATE_FILE"
}

case "${1:-}" in
  start) shift; cmd_start "$@" ;;
  stop) cmd_stop ;;
  mark) cmd_mark ;;
  status)
    if [[ -f "$STATE_FILE" ]]; then cat "$STATE_FILE"; else echo "no run open"; fi
    ;;
  *) die "usage: timer.sh {start <task> <ai|no-ai> | stop | mark | status}" ;;
esac
