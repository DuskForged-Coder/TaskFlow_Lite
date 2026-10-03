# T07 - Pair 4, twin 1: fix seeded bug X (ambiguous task resolution)

**Twin of:** T08 (same shape: a real defect injected into `src/`, find and fix it)

## Setup
The seeded patch is applied automatically by `experiment/timer.sh start T07 <arm>`
on the `task/T07` branch. **Do not commit the patch.** Your job is the fix only.

## The defect (do not read this before first inspecting the code)
A task is resolved from user text by searching titles. When the user's text
matches more than one task, the original code is supposed to refuse the
ambiguous request and ask for a more specific title. The seeded patch makes it
silently pick the first match instead. The consequence is that a destructive
command such as `delete` can hit the wrong task with no warning.

## Acceptance criteria
1. `interpretRequest('delete <ambiguous text>')` where two or more tasks match
   raises a `UserError` listing the candidate titles and suggesting a more
   specific title. Nothing is deleted.
2. The same holds for `complete`, `set_priority`, `set_estimate`, `set_deadline`
   and `undo` when the query is ambiguous.
3. An exact-title match still wins over partial matches: if one task's title
   equals the query exactly, that task is used even when other tasks partially
   match.
4. A query matching exactly one task behaves as before.
5. A query matching nothing raises the existing "couldn't find a task" error.
6. `corepack pnpm test` passes with no failures.

## Files likely involved
- `src/app/application.ts` (`resolveTask`, the multi-match branch)
- `tests/application.test.ts` (regression test for the ambiguity guard)

## How you will be scored
Fix quality, not just green tests: the fix must restore the documented safety
behaviour and be explained in `experiment/notes/T07.md`.
