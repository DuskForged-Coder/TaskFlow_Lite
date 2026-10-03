# TaskFlow AI experiment

Measuring whether an AI coding assistant actually speeds up real work, without
hiding the defects and rework it may cause.

## Run one task (always from the MAIN checkout)

```sh
./experiment/timer.sh start T03 no-ai   # 1. makes ~/taskflow-runs/T03 from task/T03, copies T03's visible test in
cat experiment/tasks/T03-*.md           # 2. read the goal and acceptance criteria
#    ...do the work in ~/taskflow-runs/T03; AI on only when the schedule says arm=ai ...
(cd ~/taskflow-runs/T03 && corepack pnpm test)   # 3. existing suite stays green
./experiment/timer.sh mark               # 4. optional: record first green
./experiment/timer.sh stop               # 5. runs the visible test, appends one row to experiment/ledger/runs.csv
./experiment/score-hidden.sh T03         # 6. hidden edge cases (uses the active worktree)
node experiment/scorecard.mjs            # 7. report, no composite score
```

Never edit a visible or hidden test to make it pass. Follow the frozen
`experiment/schedule.csv`. T00 is practice and excluded from the scorecard. Add
one honest line per task to `experiment/notes/notes-template.md` while you work.
