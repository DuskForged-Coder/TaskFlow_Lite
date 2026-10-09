---
name: dev-orchestrator
description: Orchestrates software development in six phases (discovery, tech stack, capability resolution, planning, implementation, close-out) with script-checked user gates and state in .dev/context.md. Use when you want to start a new project, build an app, add features, or resume work tracked in .dev/context.md. Do NOT use for one-off scripts, debugging existing code, or answering code questions.
---

# dev-orchestrator

## Overview

Project-level workflow for AI coding agents: six gated phases from discovery to close-out.
State lives in `.dev/context.md`; skills are resolved from `.agents/registry.json` into `.agents/skills/`.
Gates are script-checked (`python scripts/context.py gate check`) — never advance on paraphrase.

## Session start

1. Read `.dev/context.md` — `handoff` section first, then `meta`.
2. If `meta.status` is `awaiting_user`: stop and restate the open gate and its exact token. Do not do other work.
3. Run `python scripts/context.py check`. Fix any `FAIL:` lines before continuing.
4. If no `.dev/context.md` exists: run Bootstrap, then start Phase 1.

## Bootstrap

First run only. Create `.dev/refs/` with these five files. Each holds the agent's own working notes (project-specific content, no placeholders) and is updated as `context.md` changes:

- `discovery.md`:
  - Problem statement and target users
  - Goals / non-goals
  - Constraints and assumptions
  - Open questions for the user
- `tech-stack.md`:
  - Candidate stacks with fit notes
  - Maintainability and hiring considerations
  - User experience level and time budget
  - Final recommendation + rationale
- `planning.md`:
  - Milestones mapped to agent phases
  - Scope budget and what is excluded
  - Risks and mitigations
- `implementation.md`:
  - Per-phase deliverables and test plan
  - Running-artifact evidence (URL / curl / screenshot)
  - Review notes per `approve phase <id>`
- `change-requests.md`:
  - Log of change requests with classification
  - Rework vs new-scope decisions
  - Scope-budget impact of each

Then run `python scripts/context.py init` to create `.dev/context.md`.

## Phases

### Phase 1 — Discovery → gate `approve project`

- Interview the user: problem, users, goals, non-goals, constraints.
- Write findings to `project` section of `.dev/context.md`; update `.dev/refs/discovery.md`.
- Set `meta.active_phase=1-discovery`, then `python scripts/context.py gate open --name project`.
- Present a 3-5 line project summary and ask for `approve project`.

### Phase 2 — Tech stack → gate `approve stack`

- Ask TWO questions: (a) do you already have a stack in mind, (b) your experience level and how much time you have.
- Recommend on fit AND maintainability; record options in `.dev/refs/tech-stack.md`.
- Write choice + rationale to `stack` section of `.dev/context.md`.
- Gate: `python scripts/context.py gate open --name stack`. Ask for `approve stack`. Never pick a stack without sign-off.

### Phase 3 — Capability resolution → gate `approve install`

- Derive a CSV of capabilities from the stack and project (e.g. `python-testing,react-patterns`).
- Run `python scripts/fetch_skills.py resolve --capabilities "<csv>"` (reads `.agents/registry.json`, clones in priority order, vets via `scripts/vet_skill.sh`, writes `.agents/skills/INDEX.md`).
- Skills are read inline from disk (grep `.agents/skills/` and read `SKILL.md` directly). They are NOT host-registered or auto-invokable.
- Write results to `capabilities` section of `.dev/context.md`.
- Gate: `python scripts/context.py gate open --name install`. Ask for `approve install`.

### Phase 4 — Planning → gate `approve plan`

- Do NOT write implementation code in this phase.
- Present the plan at two levels: 3-4 user-facing milestones mapped to agent phases.
- Write the phased plan into the `plan` section; set `meta.scope_budget` (e.g. `6 phases / 3 milestones`).
- Gate: `python scripts/context.py gate open --name plan`. Ask for `approve plan`.

### Phase 5 — Implementation loop → gate `approve phase <id>` per phase

- Work one phase at a time. For each phase `<id>`:
  1. Implement, test, and produce a running artifact.
  2. Review artifacts are exactly three: (a) git diff, (b) unedited test output, (c) a running artifact (screenshot / curl / URL).
  3. Ask one question: "Does this match what phase <id> was supposed to deliver?"
  4. Gate: `python scripts/context.py gate open --name "phase <id>"`. Advance only when the user message contains `approve phase <id>` verified by `python scripts/context.py gate check --name "phase <id>" --message "<user text>"`.
  5. Commit as `phase/<id>` on pass; update `context.md`.
- Never commit mid-phase.

### Phase 6 — Close-out

- Final test run, docs, `.env.example` (never commit `.env`).
- Update `decisions` (append-only), `changelog`, and `handoff` via `python scripts/context.py flush --intent "<what was done>"`.
- Set `meta.status=done`, `meta.gate=none`. No gate token required.

## Gates

| Gate name | Token | Unlocks |
|---|---|---|
| project | `approve project` | Phase 2 |
| stack | `approve stack` | Phase 3 |
| install | `approve install` | Phase 4 |
| plan | `approve plan` | Phase 5 |
| phase `<id>` | `approve phase <id>` | Next phase / close-out |
| revert phase `<id>` | `revert phase <id>` | Rework of phase `<id>` |

Check gates with `python scripts/context.py gate check --name "<name>" --message "<user text>"`. Exit 0 = pass ("ok"). Exit non-zero = denied. Paraphrases never pass — require the exact token (case-insensitive). For the revert gate, pass `--token "revert phase <id>"` explicitly.

## Change request protocol

| Type | Example | Handling |
|---|---|---|
| trivial | typo, rename | Do inline, log in `changelog` |
| in-scope | fits current phase deliverable | Do in current phase, note in `plan` |
| new scope | new feature / milestone | New phase proposal; needs `approve plan` re-gate; check `scope_budget` |
| rework | redo a committed phase | Follow Revert protocol; needs `revert phase <id>` |

Rule: sub-phases go ONE level deep only (e.g. `3a`). Never nest deeper. If the plan would grow past `scope_budget`, stop and re-gate `approve plan`.

## Commit protocol

## Revert protocol

1. Check `side_effects` recorded in `context.md` / commit body first; if any entry has no teardown, stop and ask the user.
2. Then `git revert --no-commit phase/<id>` (or `git revert --no-commit <sha>` for that tag), verify tests still pass.
3. Update `context.md` (`plan`, `changelog`, `handoff`), commit as `phase <id>: reverted`.
4. Re-gating the redone phase requires `approve phase <id>`.

## Abort (mid-phase)

- Uncommitted work: offer three options and ask which: stash (`git stash push -m "abort phase <id>"`) / discard (`git checkout -- .` + `git clean -fd`) / promote (finish + commit as `phase/<id>`).
- Never leave the repo half-committed. Record the outcome in `changelog` + `handoff`.

## Context rules

- Flush at every gate close: `python scripts/context.py flush --intent "<text>"`.
- `python scripts/context.py check` at every session start.
- `decisions` is append-only (never rewrite history).
- `plan` is append-and-strike (keep completed items struck through, append new ones).
- Never maintain authoritative context in conversation — `.dev/context.md` is the source of truth.

## Secrets policy

- Never ask for secrets in chat. Point to `.env` (copy `.env.example` → `.env`).
- Never commit `.env`, `*.pem`, `*.key`. Never paste secret values into `context.md`, logs, or commits.

## Pitfalls

- Don't skip gates — every phase end requires its exact token via `context.py gate check`.
- Don't implement in Phase 4 — planning only, no code.
- Don't pick a stack without sign-off (`approve stack`).
- Don't maintain context in conversation — flush to `.dev/context.md`.
- Don't accept paraphrased tokens ("looks good", "yes") — require the exact string.
- Don't claim downloaded skills are host-invokable — they are read inline from `.agents/skills/*/SKILL.md`.
- Don't grow the plan past `scope_budget` — re-gate with `approve plan` first.
- Don't commit mid-phase or leave the repo half-committed on abort.


- One commit per phase, tagged `phase/<id>` (message `phase/<id>: <summary>`).
- Never commit mid-phase.
- If not a git repo: `git init` + empty baseline commit tagged `phase/0`.

