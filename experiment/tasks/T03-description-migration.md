# T03 - Pair 2, twin 1: task description field + migration

**Twin of:** T04 (same subsystem, similar difficulty, different field)

## Goal
Persist a task description. Add a `notes` column through a versioned migration
and expose it in the command surface.

## Acceptance criteria
1. `runMigrations` advances the schema to a new version (5 or higher) and the
   `tasks` table has a `notes` column. Re-opening an existing database runs the
   migration without data loss.
2. `TaskService.createTask({ title, notes })` stores the value, and
   `getTask(id).notes` returns it.
3. `updateTask(id, { notes })` updates it and bumps the version.
4. A deterministic command sets and reads the description, for example
   `note finish DBMS <text>` followed by `show my tasks` showing it, or an
   equivalent design agreed in the notes.
5. Setting a description longer than 200 characters raises a `UserError`.
6. A description containing a terminal control character raises a `UserError`.
   `notes` follows the same validation as the task title: control characters are
   rejected and the value is trimmed, capped at 200 characters, and stored as
   `null` when empty.
7. Undo restores the previous description value.
8. The undo snapshot of a task created before migration 5 still restores
   (missing field defaults to `null`, matching the `estimateMinutes` precedent).
9. `corepack pnpm test` passes with no failures.

## Files likely involved
- `src/db/migrations.ts` (new version block)
- `src/core/tasks/task.ts` (`Task`, `CreateTaskInput`, `UpdateTaskInput`)
- `src/core/tasks/taskService.ts` (validation + normalisation)
- `src/db/repositories/sqliteTaskRepository.ts` (row mapping, write, snapshot)
- `src/commands/commandParser.ts`, `src/app/application.ts`
- `tests/connection.test.ts`, `tests/taskService.test.ts`
