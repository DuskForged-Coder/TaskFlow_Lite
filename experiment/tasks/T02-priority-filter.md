# T02 - Pair 1, twin 2: `show <priority>` filter command

**Twin of:** T01 (same subsystem, similar difficulty, different feature)

## Goal
Add deterministic `show high`, `show urgent`, `show low priority tasks`
commands that filter open tasks by priority.

## Acceptance criteria
1. `parseCommand('show urgent', opts)` returns a `list_tasks` intent whose
   priority filter is `urgent` and whose scope is `all`.
2. Given open tasks with priorities `low`, `normal`, `high`, `urgent`,
   `interpretRequest('show urgent')` lists only the urgent task.
3. `show high` and `show low` each list exactly the matching open tasks.
4. Completed and soft-deleted tasks are never listed.
5. The phrase `show high priority tasks` (with the trailing noun) is accepted
   and behaves identically.
6. `show everything` still returns all open tasks (existing behaviour preserved).
7. The command never calls the AI backend.
8. `corepack pnpm test` passes with no failures.

## Files likely involved
- `src/commands/commandParser.ts`
- `src/ai/schema.ts` (add an optional priority filter to the list intent)
- `src/app/application.ts` (`queryForScope` / `executeIntent`)
- `src/core/tasks/task.ts` (`TaskQuery` already supports `priority`)
- `README.md`
