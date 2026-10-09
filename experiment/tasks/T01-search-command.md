# T01 - Pair 1, twin 1: `search <text>` command

## Goal
Add a deterministic `search <text>` command that performs a case-insensitive
substring search across task titles and descriptions.

## Acceptance criteria
1. `parseCommand('search dbms', opts)` returns
   `{ type: 'list_tasks', scope: 'all', query: 'dbms', confidence: 1 }`.
2. With two open tasks titled `Finish DBMS assignment` and `Buy milk`, and a
   third completed task titled `DBMS revision`, `interpretRequest('search dbms')`
   returns a message containing the first title and NOT `Buy milk`. Completed
   tasks are excluded by default.
3. Searching is case-insensitive: `search DBMs` matches `Finish DBMS assignment`.
4. The search also matches the description text of a task.
5. `search <text>` never calls the AI backend.
6. A whitespace-only query raises a `UserError` (the existing
   "Enter a word or phrase to search for." behaviour) rather than returning
   every task.
7. `corepack pnpm test` passes with no failures.

## Files likely involved
- `src/commands/commandParser.ts` (new `search` branch)
- `src/app/application.ts` (`executeIntent` already routes `list_tasks.query`
  to `TaskService.searchTasks`)
- `src/db/repositories/sqliteTaskRepository.ts` (text predicate already exists)
- `README.md` (command list)
