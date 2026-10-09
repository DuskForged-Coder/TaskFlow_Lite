# T05 - Pair 3, twin 1: recurring daily / weekly tasks

**Twin of:** T06 (new user-visible feature, same subsystem family)

## Goal
Allow a task to be created as recurring. Completing a recurring task
automatically creates the next occurrence instead of leaving the list empty.

## Acceptance criteria
1. `TaskService.createTask({ title, recurrence })` stores a recurrence with a
   pattern of `daily` or `weekly` and, for `weekly`, zero or more
   `daysOfWeek` values (0 = Sunday).
2. `createTask` rejects any other pattern with a `UserError`.
3. `completeTask(id)` on a daily task whose `dueAt` is `2026-10-01T09:00:00.000Z`
   marks it completed AND creates exactly one new open task with the same title,
   the same recurrence, and `dueAt` of `2026-10-02T09:00:00.000Z`.
4. A weekly task with `daysOfWeek: [1]` (Monday) due Monday
   `2026-10-05T09:00:00.000Z` produces the next occurrence on
   `2026-10-12T09:00:00.000Z`, skipping the intervening week.
5. A non-recurring task's completion behaves exactly as before: no new task.
6. Completing a recurring task that has no `dueAt` does not create a new
   occurrence and raises no error.
7. The recurrence survives undo of the completion: the spawned occurrence is
   removed and the original task returns to `open`.
8. The recurring behaviour is reachable from the command surface
   (`add <task> every day` / `every monday`, or an equivalent design agreed in
   the notes).
9. `corepack pnpm test` passes with no failures.

## Files likely involved
- `src/core/tasks/task.ts` (`Task`, `CreateTaskInput`)
- `src/core/tasks/taskService.ts` (`completeTask`, validation)
- `src/db/repositories/sqliteTaskRepository.ts` (row mapping)
- `src/ai/schema.ts`, `src/commands/commandParser.ts`, `src/app/application.ts`
- `tests/taskService.test.ts`
