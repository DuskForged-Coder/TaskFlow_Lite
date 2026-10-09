# TaskFlow

TaskFlow is a local-first terminal task assistant. Its task data stays in SQLite; natural-language interpretation can use Gemini when configured, but all task changes are validated and executed by deterministic application services.

## Requirements

- Node.js 22 or later
- Corepack (included with supported Node installations)

## Run

```sh
corepack pnpm install
corepack pnpm dev
```

The interactive terminal opens on **NOW**. Tab and Shift+Tab switch between NOW, NEXT, TODAY, WEEK, MEETINGS, and DEADLINES. Ctrl+C performs graceful shutdown. After building, run `corepack pnpm build` and `corepack pnpm start`.

## Configuration

Configuration is read from environment variables; TaskFlow does not load `.env` files.

`TASKFLOW_DATABASE_PATH` accepts absolute paths, paths relative to the current working directory, and `~` or `~/...` home-directory paths. Paths containing spaces are supported.

| Variable | Default | Purpose |
| --- | --- | --- |
| `TASKFLOW_DATABASE_PATH` | `~/.taskflow/taskflow.sqlite3` | Local SQLite database path |
| `TASKFLOW_TIMEZONE` | System IANA timezone | Calendar interpretation and display |
| `GEMINI_API_KEY` | Unset | Optional environment override; otherwise an in-app key is stored in the OS credential store |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Gemini model name |
| `TASKFLOW_AI_PROVIDER` | `auto` | `auto`, `gemini`, `ax1`, or `none`. `auto` uses Gemini when a key is configured and otherwise falls back to a local AX 1 runtime |
| `TASKFLOW_AX1_BINARY` | `ax1` | Executable used for the local fallback, resolved through `PATH` |
| `TASKFLOW_AX1_WORKDIR` | `~/.taskflow/ax1` | Private directory for the local runtime; deliberately kept away from the database |
| `TASKFLOW_AI_TIMEOUT_MS` | `20000` | Per-request timeout, from 1 to 120 seconds |
| `TASKFLOW_CONFIDENCE_THRESHOLD` | `0.8` | Minimum confidence for automatic execution |

The database directory is created with owner-only permissions, and the database file is set to mode `0600`. Logs are written to `~/.taskflow/taskflow.log` with owner-only permissions. Gemini is optional; common commands work offline.

Enter `add AI` or `add Gemini` in the TUI to connect Gemini. The key-entry prompt masks input; TaskFlow makes a small validation request and stores the key in the operating system credential store only after validation succeeds. Use `replace API key` or `remove API key` to manage a saved key. An environment-provided `GEMINI_API_KEY` takes precedence and cannot be changed from the TUI.

When validation fails, the key is not saved and the message states why: an invalid key, a retired `GEMINI_MODEL`, a disabled Generative Language API, or an exceeded quota are reported distinctly. Google retires models periodically, so if a previously working key starts failing, update `GEMINI_MODEL` to a current model.

Set `TASKFLOW_DEBUG=1` to print the redacted startup exception/cause chain to stderr. Normal terminal errors remain concise; the local log retains stack and cause details.

## Interface

The header shows the AI connection state at all times, so a key that failed to connect is never a mystery. Press `?` on an empty prompt for the full command and key reference.

| Key | Action |
| --- | --- |
| `Tab` / `Shift+Tab` | Cycle views |
| `↑` / `↓` | Recall previous commands |
| `Ctrl+U` | Clear the line (useful after a bad paste) |
| `Ctrl+W` | Delete the last word |
| `Esc` | Cancel a prompt, or stop a request that is taking too long |
| `Ctrl+C` | Quit |

Messages are colour-coded by outcome: green for success, red for errors, yellow for warnings, cyan for informational text. A failure can never be mistaken for something having worked.

## AI backends

TaskFlow works with or without a cloud key. `TASKFLOW_AI_PROVIDER` selects the backend:

| Provider | Behaviour |
| --- | --- |
| `auto` (default) | Gemini when a key is configured, otherwise the local AX 1 runtime, otherwise no AI |
| `gemini` | Gemini only; no AI when no key is configured |
| `ax1` | Local AX 1 runtime only |
| `none` | No AI; the deterministic command set still works |

The local fallback is [AX 1](https://pypi.org/project/ax1/), which runs on Ollama entirely on your machine. It needs no API key, has no quota, and sends nothing over the network. It also means interpretation and planning keep working when a Gemini key is missing, invalid, or its project has the Generative Language API disabled.

**Expect it to be less capable than Gemini.** AX 1 defaults to a small local model (`llama3`, 8k context) that does not reliably follow the intent schema: it often answers in prose or returns a JSON object missing required fields, and a single request can take 20–45 seconds. TaskFlow handles this safely rather than pretending otherwise — anything that fails strict validation is rejected with "I could not match that to a supported command", and your data is never changed on the strength of malformed output. Use it for offline capability and as a fallback; use Gemini when you need reliable interpretation.

### Local runtime security

AX 1 ships file, network, and code-execution tools. TaskFlow's `.ax1/config.json` denies all of them and disables the project index, so the local model has no path to your files, your network, or your database. The runtime additionally runs in its own `~/.taskflow/ax1` directory rather than beside your data. The prompt is passed with `execFile`, never through a shell, so request text cannot inject arguments. Even so, the local model is only a parser: its output is untrusted and must pass `validateIntent` before anything happens.

## Commands

Enter commands in the TUI prompt:

```text
add finish DBMS assignment tomorrow
show my tasks today
show overdue tasks
what is due this week?
what should I do now?
complete DBMS assignment
undo DBMS assignment
reopen DBMS assignment
move project report to Friday
set priority of project report to urgent
delete old notes
restore old notes
create project University
assign DBMS assignment to University
show my projects
estimate DBMS assignment for 90 minutes
plan the next 4 hours
plan my day
write the section depends on research sources
```

Relative dates are interpreted in `TASKFLOW_TIMEZONE`. Date-only deadlines use 9:00 AM local time; “tonight” uses 8:00 PM. Explicit times and IANA timezone offsets are converted to UTC for storage.

Deletion always asks for confirmation. Medium-confidence AI interpretations also require confirmation; low-confidence interpretations do not change data. Ambiguous task names are rejected and must be made more specific.

## Agent Mode

Agent Mode turns "plan my day" into a structured proposal. The planner reads your open tasks, priorities, deadlines, projects, dependencies, and existing schedule blocks, then presents a plan for approval. It never writes anything on its own.

```text
TODAY'S PROPOSED PLAN · 4h available
Work 2h 30m · Breaks 20m · Committed 0m · Buffer 1h 10m
04:02–04:52  DBMS assignment
  Why: It is a higher-priority estimated task.
04:52–05:02  Break
...

Assumptions:
  read the paper: No duration is recorded, so this proposal assumes 1h.

Trade-offs:
  Workload exceeds the window: You have about 4h of free time, but this
  workload needs roughly 5h 30m. 2 task(s) are unscheduled.

Nothing has been changed. Apply this plan? Type y to apply, e to revise, or n to cancel.
```

A task with no recorded estimate is **assumed** at 1 hour rather than dropped, and the assumption is shown so you can correct it with `estimate <task> for 45 minutes`. Approved assumptions are saved, so later plans do not guess again. When the workload does not fit, TaskFlow says so and lists what it left out rather than overfilling your day.

Nothing is scheduled until you type `y`. `n` declines, and `e` discards the proposal so you can revise it in your own words:

```text
give DBMS assignment 60 minutes
don't schedule anything before 10
i have a class at 2
plan the next 6 hours
```

Revising only produces a new proposal; it never edits the previous one or touches stored data.

### Dependencies

Record that one task must follow another:

```text
write the section depends on research sources
DBMS assignment is independent of research sources
```

The planner always schedules a prerequisite before its dependent, and refuses to schedule a dependent whose prerequisite did not fit. Circular dependencies are rejected.

### Safety model

```text
Planner → ProposedPlan → UserConfirmation → ExecutionEngine → Mutations
```

- Planning is read-only. `propose()` performs no database writes.
- `revise_plan`, `set_dependency`, and `delete_task` always require explicit confirmation.
- Only `y`/`yes` counts as approval. Replies such as "looks good" or "okay" are not treated as authorization, and the terminal only accepts `y`, `yes`, `e`, or `n` at a confirmation prompt.
- Applying re-checks each task version and refuses to write if anything changed since the proposal, and a SQLite trigger rejects overlapping blocks even if a caller bypasses the planner.
- All mutations go through `TaskService` and `DayPlanService`, so existing validation and history still apply.

Agent Mode plans only tasks with recorded estimates or stated assumptions; TaskFlow will not invent durations on your behalf. A plan is proposed with deadline/priority rationale, breaks, buffer, assumptions, and trade-offs. External meetings and classes are unknown because calendar integration is not available; you can add them for one plan with "i have a class at 2".

Reminders are not implemented. Requests to set one are explicitly rejected; TaskFlow does not store reminders that it cannot deliver. MEETINGS currently reports that no calendar source is configured.

## Architecture

- `src/ai/` validates structured intent and contains the timeout-bounded Gemini client. It cannot access repositories or execute commands.
- `src/core/agent/` creates deterministic, explainable schedule proposals and persists them only after confirmation.
- `src/app/` composes services and coordinates shutdown.
- `src/core/` owns task/project rules and version-aware history.
- `src/db/` contains the SQLite connection and repositories.
- `src/tui/` renders the Ink interface and forwards user input to the application.
- `src/utils/dates.ts` centralizes timezone-aware parsing and display.

SQLite is the single source of truth, initialized through a transactional, versioned schema migration. Mutations go through `TaskService`; repository writes use transactions and optimistic task versions. Undo compares the task's business state with the recorded post-change snapshot before restoring it, so a newer conflicting edit is not overwritten.

## Checks

```sh
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

See [SECURITY.md](SECURITY.md) and [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for operational details.