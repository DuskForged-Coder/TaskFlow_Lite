# Changelog

## 0.1.0 - Initial clean foundation

- Added a strict TypeScript, pnpm, Vitest, and ESLint project foundation.
- Added local SQLite persistence for tasks, projects, and conflict-aware undo history.
- Added deterministic task lifecycle, search, deadline, priority, project, and recommendation operations.
- Added timezone-aware natural date parsing and validated optional Gemini intent interpretation.
- Added an Ink terminal interface, graceful shutdown, and terminal output sanitization.
- Deferred reminders and calendar integration rather than exposing nonfunctional features.
- Added Keychain-backed Gemini key management and a confirmation-gated, locally planned Agent Mode with explicit task estimates.
- Agent Mode: structured plans now record assumptions, conflicts, and the exact proposed changes. Unestimated tasks are assumed at 1 hour and reported instead of being dropped, an over-capacity workload is explained rather than silently trimmed, and task dependencies are stored, validated against cycles, and honoured when ordering the day.
- Agent Mode: plans can be revised in natural language ("give DBMS more time", "don't schedule anything before 10", "i have a class at 2"). A revision only produces a new proposal; nothing is written until it is approved.
- Added migration 4 for task dependencies.
- Added an optional local AX 1 (Ollama) AI backend selected with `TASKFLOW_AI_PROVIDER`, used automatically when no Gemini key is available. It runs with all file, network, and code-execution tools denied, in a private working directory, and its untrusted output must pass the existing strict intent schema.
- Terminal UX: errors are now shown in red instead of success green, messages carry an explicit outcome tone, the AI connection state is always visible in the header, `↑`/`↓` recall command history, `?` opens a help overlay, `Ctrl+U`/`Ctrl+W` edit the line, `Esc` interrupts a slow request, and the task list refreshes after every change.