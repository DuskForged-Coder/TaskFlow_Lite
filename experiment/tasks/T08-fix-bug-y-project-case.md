# T08 - Pair 4, twin 2: fix seeded bug Y (project name validation)

**Twin of:** T07 (same shape: a real defect injected into `src/`, find and fix it)

## Setup
The seeded patch is applied automatically by `experiment/timer.sh start T08 <arm>`
on the `task/T08` branch. **Do not commit the patch.** Your job is the fix only.

## The defect (do not read this before first inspecting the code)
A project name is validated before it is stored: it must be non-empty, free of
terminal control characters, at most 80 characters, and unique. The seeded patch
removes the **length** limit. The consequence is that an unbounded project name
is accepted, persisted, and then rendered in the terminal task list, where it can
break the display.

Note that the surrounding validations (empty name, control characters,
duplicate name) are still present and still correct.

## Acceptance criteria
1. `create project <81 characters>` raises a `UserError`; the project is not
   created.
2. A name of exactly 80 characters is accepted.
3. An empty or whitespace-only name still raises a `UserError`.
4. A name containing a terminal control character still raises a `UserError`.
5. A duplicate name still raises a `UserError`, and is still detected
   case-insensitively (`University` then `university`).
6. Creating a valid project succeeds and appears in `show my projects`.
7. The limit applies at the service boundary, not only in the command parser, so
   a direct call cannot bypass it.
8. `corepack pnpm test` passes with no failures.

## Files likely involved
- `src/core/projects/projectService.ts` (`createProject` validation)
- `tests/` (regression test for the name length bound)

## How you will be scored
Fix quality, not just green tests: the fix must restore the documented bound and
be explained in `experiment/notes/T08.md`.
