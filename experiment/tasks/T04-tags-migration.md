# T04 - Pair 2, twin 2: task tags field + migration

**Twin of:** T03 (same subsystem, similar difficulty, different field)

## Goal
Persist free-form tags on a task. Add a `tags` column through a versioned
migration and expose tagging in the command surface.

## Acceptance criteria
1. `runMigrations` advances the schema to a new version (5 or higher) and the
   `tasks` table has a `tags` column. Re-opening an existing database runs the
   migration without data loss.
2. `TaskService.createTask({ title, tags })` stores the values, and
   `getTask(id).tags` returns them.
3. Tags are stored and returned normalised: trimmed, lower-cased, duplicates
   removed, order preserved.
4. An empty tag string is discarded rather than stored as `""`.
5. `updateTask(id, { tags })` replaces the set and bumps the version.
6. A deterministic command adds and removes tags, for example
   `tag finish DBMS <tag>` and `untag finish DBMS <tag>`, or an equivalent
   design agreed in the notes.
7. More than 10 tags, or a single tag longer than 40 characters, raises a
   `UserError`.
8. Undo restores the previous tag set.
9. The undo snapshot of a task created before migration 5 still restores
   (missing field defaults to an empty array).
10. `corepack pnpm test` passes with no failures.

## Files likely involved
- `src/db/migrations.ts`
- `src/core/tasks/task.ts`, `src/core/tasks/taskService.ts`
- `src/db/repositories/sqliteTaskRepository.ts` (JSON encode/decode, snapshot)
- `src/commands/commandParser.ts`, `src/app/application.ts`
- `tests/connection.test.ts`, `tests/taskService.test.ts`
