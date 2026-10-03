# Troubleshooting

## Corepack or pnpm is unavailable

Use a supported Node.js installation that includes Corepack, then run `corepack pnpm --version`. The repository pins its pnpm version in `package.json`.

## Native SQLite module cannot load

Both `corepack pnpm start` and `corepack pnpm dev` probe the native binding before launch. If Node's module ABI changed since the addon was built, the preflight rebuilds only `better-sqlite3` and verifies it again. If rebuilding fails, run `corepack pnpm install` from the project root; the project permits the `better-sqlite3` install script only for the native SQLite binding. On platforms without a prebuilt binary, install the platform's C/C++ build tools and rerun the install.

## Database cannot be opened

Check that the configured parent directory exists or can be created, that the path is writable, and that no directory is being used as the database file. Set `TASKFLOW_DATABASE_PATH` to a writable file path. SQLite waits up to five seconds for a database lock before reporting an error.

Absolute paths, paths relative to the current working directory, and `~`/`~/...` paths are supported. If startup still fails, set `TASKFLOW_DEBUG=1` to print the redacted native/filesystem/migration cause chain. The same details, including stack traces, are recorded in `~/.taskflow/taskflow.log`; the normal TUI message does not expose internal details.

## Dates are shifted or rejected

Set `TASKFLOW_TIMEZONE` to a valid IANA name such as `America/New_York`, `Asia/Kolkata`, or `UTC`. TaskFlow stores UTC instants and interprets natural dates in that configured zone. Date-only phrases default to 9:00 AM local time.

## AI interpretation fails

AI is optional. Check `GEMINI_API_KEY`, `GEMINI_MODEL`, network connectivity, and the configured request timeout. API keys are never included in user-facing errors. Deterministic supported commands continue to work without Gemini.

## The API key will not connect

TaskFlow validates a key with a small request before saving it, and the key is only stored after that request succeeds, so a failed attempt leaves no saved credential. The message identifies the cause:

| Message | Cause | Fix |
| --- | --- | --- |
| Gemini rejected this API key | The key is invalid, revoked, or copied incompletely | Create a new key in Google AI Studio and use `replace API key` |
| The configured model has been retired / was not found | `GEMINI_MODEL` names a model Google has shut down | Set `GEMINI_MODEL` to a current model, for example `gemini-3.8-flash` |
| Gemini denied the request | The key is valid, but its project cannot make the call | See the 403 causes below |
| Gemini rate limit or quota reached | Free-tier quota is exhausted | Wait, or use a billed project in Google AI Studio |

A `403` denial means the key itself is valid — Google authenticated it and then refused the call. The message names the specific cause:

| 403 message | Cause | Fix |
| --- | --- | --- |
| Enable the Generative Language API for that project | The API is off for the key's project | Enable it in the Google Cloud Console, then wait about a minute |
| Google has blocked this key as publicly exposed | The key was found in a public repo, paste, or log | Create a new key in Google AI Studio |
| The Gemini API is not available from this region | Calling from an unsupported country | Check the supported-regions list; a VPN will not help |
| This project needs billing enabled | Project has no billing account | Link a billing account in the Google Cloud Console |

A retired model is the most common cause after a key has worked for a while, because Google shuts models down on its own schedule. Confirm the current lineup at <https://ai.google.dev/gemini-api/docs/models>.

## Command is not recognized

Try a supported form such as `add <task> tomorrow`, `show my tasks today`, `complete <task>`, `move <task> to Friday`, or `what should I do now?`. Configure Gemini if you want interpretation outside that command vocabulary. Reminder requests are intentionally rejected because delivery is not implemented.

## Terminal display is interrupted

Use Ctrl+C to invoke centralized shutdown. If an external process forcibly kills Node, the terminal may not receive normal cleanup; start a fresh terminal session. TaskFlow does not call `process.exit()` during normal shutdown.