# TaskFlow AI experiment

Measuring whether an AI coding assistant actually speeds up real work, without
hiding the defects and rework it may cause.

## Run one task, start to finish

```sh
git checkout task/T03                     # 1. task branch (seeds the bug automatically on T07/T08)
bash experiment/timer.sh start T03 no-ai   # 2. start the clock
cat experiment/tasks/T03-*.md              # 3. read goal + acceptance criteria
#    ... do the work; use the AI assistant only when the schedule says arm=ai ...
corepack pnpm test                        # 4. existing suite stays green
corepack pnpm vitest run --config experiment/vitest.visible.config.ts   # 5. acceptance passes
bash experiment/timer.sh mark && bash experiment/timer.sh stop          # 6. record first-green, then close
bash experiment/score-hidden.sh T03 && node experiment/scorecard.mjs     # 7. hidden cases + report
```

Ground rules: both arms start from tag `baseline-pre-experiment` on an identical
tree; follow the frozen `experiment/schedule.csv`; never edit
`experiment/tests-visible/` to make it pass; never commit a seed patch; T00 is
practice and excluded; add one line to `experiment/notes/notes-template.md` per task.
