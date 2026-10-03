#!/usr/bin/env bash
# Timing harness for the AI with-vs-without experiment.
#
#   experiment/timer.sh start <task> <arm>   # arm is "ai" or "no-ai"
#   experiment/timer.sh stop
#   experiment/timer.sh mark                 # optional: record "first green" for rework
#   experiment/timer.sh status
#
# `start` opens a ledger row and, for the seeded-bug tasks (T07/T08), applies the
# bug patch to the current branch so the developer is given the same defect in
# both arms. `stop` closes the row and appends one line to
# experiment/ledger/runs.csv.
#
# The 60-minute cap is REPORTED, never enforced: a run that exceeds 60 minutes is
# flagged timed_out=true so the outlier is visible in the data instead of being
# silently truncated.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEDGER_DIR="$REPO_ROOT/experiment/ledger"
RUNS_CSV="$LEDGER_DIR/runs.csv"
STATE_FILE="$LEDGER_DIR/.current-run.json"
CAP_MINUTES=60

mkdir -p "$LEDGER_DIR"

if [[ ! -f "$RUNS_CSV" ]]; then
  cat > "$RUNS_CSV" <<'EOF'
task,arm,start_iso,end_iso,minutes,timed_out,files_changed,insertions,deletions,commits,first_green_minutes,rework_minutes,rework_commits,notes
EOF
fi

die() { echo "timer: $*" >&2; exit 1; }

seed_for_task() {
  case "$1" in
    T07) echo "experiment/seeds/bugX.patch" ;;
    T08) echo "experiment/seeds/bugY.patch" ;;
    *) echo "" ;;
  esac
}

# Reads one field out of the JSON state file. Written in python3 rather than
# grep/cut because the JSON contains colons, which `cut -d:` would mis-split.
state_field() {
  python3 - "$STATE_FILE" "$1" <<'PY'
import json, sys
with open(sys.argv[1]) as handle:
    value = json.load(handle).get(sys.argv[2], "")
print("" if value is None else value)
PY
}

cmd_start() {
  local task="${1:-}" arm="${2:-}"
  [[ -n "$task" && -n "$arm" ]] || die "usage: timer.sh start <task> <ai|no-ai>"
  [[ "$arm" == "ai" || "$arm" == "no-ai" ]] || die "arm must be 'ai' or 'no-ai'"
  [[ -f "$STATE_FILE" ]] && die "a run is already open (task $(grep -o '"task": *"[^"]*"' "$STATE_FILE" | head -1)); run 'stop' first"

  local branch; branch=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
  local head; head=$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)
  local started; started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local start_epoch; start_epoch=$(date -u +%s)

  local patch; patch=$(seed_for_task "$task")
  if [[ -n "$patch" ]]; then
    echo "timer: applying seeded defect $patch on $branch (do not commit it)"
    (cd "$REPO_ROOT" && git apply "$patch") || die "could not apply $patch"
  fi

  cat > "$STATE_FILE" <<EOF
{"task":"$task","arm":"$arm","branch":"$branch","base_sha":"$head","start_iso":"$started","start_epoch":$start_epoch}
EOF
  echo "timer: started $task ($arm) at $started on $branch"
}

cmd_mark() {
  [[ -f "$STATE_FILE" ]] || die "no run is open"
  local start_epoch; start_epoch=$(state_field start_epoch)
  [[ -n "$start_epoch" ]] || die "state file has no start_epoch"
  local now; now=$(date -u +%s)
  local elapsed=$(( now - start_epoch ))
  python3 - "$STATE_FILE" "$elapsed" <<'PY'
import json, sys
path, elapsed = sys.argv[1], int(sys.argv[2])
with open(path) as handle:
    state = json.load(handle)
state["first_green_epoch"] = elapsed
with open(path, "w") as handle:
    json.dump(state, handle)
print(f"timer: first green marked at {elapsed // 60}m")
PY
}

cmd_stop() {
  [[ -f "$STATE_FILE" ]] || die "no run is open"

  local start_epoch first_green_epoch
  start_epoch=$(state_field start_epoch)
  first_green_epoch=$(state_field first_green_epoch)
  [[ -n "$start_epoch" ]] || die "state file has no start_epoch"

  local ended end_epoch
  ended=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  end_epoch=$(date -u +%s)
  local elapsed=$(( end_epoch - start_epoch ))
  local minutes=$(( elapsed / 60 ))

  local timed_out=false
  if (( elapsed > CAP_MINUTES * 60 )); then timed_out=true; fi

  # Code-change volume since the branch point, ignoring the experiment folder.
  local base_sha
  base_sha=$(state_field base_sha)
  local numstat files_changed insertions deletions
  numstat=$(git -C "$REPO_ROOT" diff --numstat "$base_sha" -- . ':(exclude)experiment' 2>/dev/null)
  files_changed=$(printf '%s\n' "$numstat" | grep -c '^[0-9]' || true)
  insertions=$(printf '%s\n' "$numstat" | awk '{s+=$1} END {print s+0}')
  deletions=$(printf '%s\n' "$numstat" | awk '{s+=$2} END {print s+0}')

  local commits
  commits=$(git -C "$REPO_ROOT" rev-list --count "$base_sha"..HEAD 2>/dev/null || echo 0)

  # Rework = work done after the first green test run.
  local rework_minutes="" rework_commits=""
  if [[ -n "${first_green_epoch:-}" ]]; then
    rework_minutes=$(( elapsed - first_green_epoch ))
    rework_commits=$commits
  fi

  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
    "$(state_field task)" \
    "$(state_field arm)" \
    "$(state_field start_iso)" \
    "$ended" "$minutes" "$timed_out" "$files_changed" "$insertions" "$deletions" \
    "$commits" "${first_green_epoch:-}" "${rework_minutes:-}" "${rework_commits:-}" \
    "" >> "$RUNS_CSV"

  if [[ "$timed_out" == "true" ]]; then
    echo "timer: NOTE - $minutes minutes exceeded the ${CAP_MINUTES}-minute cap; flagged, not truncated."
  else
    echo "timer: stopped at ${minutes}m (files $files_changed, +$insertions/-$deletions, commits $commits)"
  fi
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
