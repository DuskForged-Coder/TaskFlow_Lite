#!/usr/bin/env bash
set -uo pipefail
DIR="${1:?usage: vet_skill.sh <skill-dir>}"
echo "== files in $DIR =="
find "$DIR" -type f -not -path '*/.git/*' | sort
echo "== checks =="
TYPES="--include=*.py --include=*.sh --include=*.js --include=*.ts"
# shellcheck disable=SC2086
if grep -rEn $TYPES 'curl |wget |fetch\(|requests\.|urllib|https?://' "$DIR" 2>/dev/null; then
  echo "WARNING: network calls found"
fi
# shellcheck disable=SC2086
if grep -rEn $TYPES '\.ssh|\.aws|\.env|\$HOME|~/\.' "$DIR" 2>/dev/null; then
  echo "WARNING: sensitive path references found"
fi
# shellcheck disable=SC2086
if grep -rEn $TYPES 'exec\(|eval\(|subprocess|os\.system|child_process' "$DIR" 2>/dev/null; then
  echo "WARNING: dynamic execution found"
fi
if grep -rEn --include=SKILL.md 'ignore (previous|prior|above)|do not tell|secretly|without asking' "$DIR" 2>/dev/null; then
  echo "WARNING: possible prompt injection"
fi
echo "== done =="
exit 0
