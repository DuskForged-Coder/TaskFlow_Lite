# T06 - Pair 3, twin 2: focus-session tracker

**Twin of:** T05 (new user-visible feature, same subsystem family)

## Goal
Record timed focus sessions against a task and report the total time spent.

## Acceptance criteria
1. A deterministic command starts a session for a named task
   (`start focus on <task>`, or an equivalent design agreed in the notes) and a
   second command stops it (`stop focus`).
2. Starting a session for a task that does not exist raises a `UserError`.
3. Starting a second session while one is already running raises a `UserError`
   and leaves the first session running.
4. Stopping with no session running raises a `UserError`.
5. A stopped session persists the task id, a start timestamp, an end timestamp,
   and a duration in whole minutes.
6. A deterministic command reports the total focus minutes per task
   (`show my focus time`, or equivalent), and the reported total equals the sum
   of the persisted session durations.
7. Sessions survive a process restart (they are persisted in SQLite, not in
   memory).
8. A session for a soft-deleted task can still be read by the report.
9. Undo of a task change does not remove its focus sessions.
10. `corepack pnpm test` passes with no failures.

## Files likely involved
- `src/db/migrations.ts` (new `focus_sessions` table + version bump)
- `src/db/repositories/` (new repository + row mapping)
- `src/core/` (new service, or `TaskService` methods)
- `src/commands/commandParser.ts`, `src/ai/schema.ts`, `src/app/application.ts`
- `tests/connection.test.ts`, `tests/taskService.test.ts`
