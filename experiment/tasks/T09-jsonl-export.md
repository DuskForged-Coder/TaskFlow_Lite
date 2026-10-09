# T09 - Pair 5, twin 1: JSONL export

**Twin of:** T10 (data portability, same subsystem family)

## Goal
Export every task to a JSON Lines file that can be read back by another tool.

## Acceptance criteria
1. A deterministic command exports all tasks to a path
   (`export jsonl <path>`, or an equivalent design agreed in the notes).
2. Each task is exactly one line, and the file ends with a trailing newline.
3. Every task field survives a round trip: `id`, `title`, `description`,
   `status`, `priority`, `projectId`, `createdAt`, `updatedAt`, `dueAt`,
   `completedAt`, `estimateMinutes`, `dependsOnTaskId`, `deletedAt`.
   `version` may differ.
4. Soft-deleted tasks are either exported with `"deletedAt": "..."` present or
   omitted entirely, and the choice is documented in the notes.
5. A title or description containing a newline, a quote or a tab does not break
   the file: every line still parses as one JSON object.
6. Writing to an unwritable path raises a `UserError` and does not leave a
   partial file behind.
7. Exporting an empty database writes an empty file (no lines, still valid).
8. `corepack pnpm test` passes with no failures.

## Files likely involved
- `src/utils/` (new export serialiser)
- `src/ai/schema.ts` (export intent), `src/commands/commandParser.ts`
- `src/app/application.ts` (`executeIntent`, error mapping)
- `tests/` (round-trip and escaping tests)
- `README.md`
