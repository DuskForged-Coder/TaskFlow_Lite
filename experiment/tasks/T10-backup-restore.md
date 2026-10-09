# T10 - Pair 5, twin 2: backup and restore

**Twin of:** T09 (data portability, same subsystem family)

## Goal
Snapshot the whole local database to a file and restore it, so a user can undo
a bad run or move the database to another machine.

## Acceptance criteria
1. A deterministic command writes a backup
   (`backup <path>`, or an equivalent design agreed in the notes) and reports
   the path written.
2. The backup file is a valid SQLite database and contains the same number of
   rows in `tasks` as the live database at the time of the backup.
3. `task_history` rows are included in the backup.
4. A deterministic command restores it (`restore <path>`, or equivalent) and
   requires explicit confirmation before overwriting live data, matching the
   existing confirmation flow.
5. Declining the confirmation leaves the live database byte-for-byte unchanged.
6. Restoring a backup that does not exist raises a `UserError` and changes
   nothing.
7. Restoring a file that exists but is not a SQLite database raises a
   `UserError`, leaves live data unchanged, and does not crash the process.
8. After a successful restore, `show my tasks` reflects the backup contents.
9. `corepack pnpm test` passes with no failures.

## Files likely involved
- `src/db/connection.ts` (backup/restore helpers, safe close/reopen)
- `src/db/migrations.ts` (schema check on restore)
- `src/ai/schema.ts`, `src/commands/commandParser.ts`
- `src/app/application.ts` (confirmation gating, error mapping)
- `tests/connection.test.ts`
- `README.md`, `SECURITY.md`
