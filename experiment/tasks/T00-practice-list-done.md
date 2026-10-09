# T00 - Practice task: "list done" command

**Status:** practice. Excluded from all results and from the scorecard.

## Goal
Add a deterministic command that lists completed tasks.

## Acceptance criteria
1. `interpretRequest('list done')` returns `{ status: 'done' }` with a message
   containing every completed task title.
2. The same request does not contain the title of any open task.
3. With no completed tasks the message says no tasks were found.
4. No AI backend is called (pass `TASKFLOW_AI_PROVIDER=none` or a throwing client).
5. `corepack pnpm test` still passes with no failures.

## Files likely involved
- `src/commands/commandParser.ts` (new deterministic branch)
- `src/ai/schema.ts` (extend `list_tasks` scope, or add an intent)
- `src/app/application.ts` (`executeIntent`, `queryForScope`)
- `tests/commandParser.test.ts`, `tests/application.test.ts`
- `README.md` (command list)
