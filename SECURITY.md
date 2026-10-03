# Security

## Data and credentials

TaskFlow stores tasks, projects, and task history in a local SQLite database. It creates the default data directory with owner-only permissions and sets the database file to mode `0600`. The log file is also owner-only. Backups, WAL sidecar handling, and device-level encryption are the operator's responsibility.

Configuration comes from environment variables. Do not put API keys in source control, command history, screenshots, or shared shell profiles. In-app Gemini credentials are stored in the operating system credential store, never in TaskFlow config or SQLite. `GEMINI_API_KEY` remains a supported environment override and takes precedence over a saved key. Key entry is masked, validation occurs before saving, and candidate/current keys are redacted from logs.

When Gemini is enabled, the current user request is sent to Google's Generative Language API over HTTPS. Connecting a key sends a fixed, non-personal validation prompt. Task lists, duration estimates, project data, and database contents are not sent. Gemini output is parsed as untrusted JSON and validated against a strict allowlisted schema before application code can use it. Day-plan context and ordering are calculated locally; the AI cannot schedule or mutate records.

## Authority boundaries

- AI has no database, filesystem, shell, or application-state access.
- All task/project writes pass through application services and repositories.
- Deletes and medium-confidence interpretations require explicit confirmation; low-confidence interpretations are rejected.
- A generated day plan remains a proposal until explicit approval. Applying it checks task versions and existing schedule overlaps, writes through a transaction, and verifies stored blocks.
- Agent Mode planning is read-only. `DayPlanService.propose()` performs no database writes, and a revision generates a new proposal rather than editing the previous one.
- Only an explicit `y`/`yes` at a confirmation prompt authorizes a plan, a revision, or a dependency change. Ambiguous replies such as "looks good" or "okay" are not authorization.
- Durations the planner assumed are displayed to the user and persisted only when the plan is approved, through `TaskService` validation.
- Task dependencies are validated for existence and cycles before storage, so the planner can always order the workload.
- SQLite queries bind user values rather than interpolating them into SQL.
- Task text rejects control characters; terminal output removes ANSI/OSC and bidirectional control sequences.
- The optional local AX 1 runtime runs with every file, network, and code-execution tool denied via `.ax1/config.json`, in a private owner-only directory that contains none of TaskFlow's data, and is invoked with `execFile` so request text cannot reach a shell. Its output is untrusted and must pass the same strict intent schema as any other backend.

## Dependencies and reporting

pnpm build scripts are allowed only for `better-sqlite3` and `esbuild`, which are required by the native database and TypeScript tooling. Review dependency changes before installation. Report suspected vulnerabilities or accidental secret exposure privately to the project maintainers; do not include live credentials in reports.

## Known limits

Reminders and external calendar/meeting integration are not implemented. Agent Mode cannot account for classes or meetings outside TaskFlow schedule blocks. TaskFlow does not claim to send notifications or synchronize calendars. The database is local to one machine; multi-device synchronization and backup/recovery automation are not provided.