---
description: Persist a decision, evidence item, lesson, snippet, or repo fact into the shared SurrealDB dev memory. Use only when explicitly invoked to remember something for future sessions.
disable-model-invocation: true
allowed-tools: Bash
---

Record a decision in the shared, agent-neutral dev memory. Pass the text as arguments, e.g. `/dfc-remember We default to embedded SurrealKV so every repo gets zero-config memory`.

!`pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:remember --kind decision --text "$ARGUMENTS" --agent claude --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"`

Notes:
- The first sentence becomes the summary; keep the text to one or two sentences.
- Other kinds use the same command with a different `--kind`:
  - `evidence` — an observation ("Approval logging must be scoped ...")
  - `lesson` — something learned the hard way ("SurrealKV is single-process ...")
  - `snippet` — a reusable code fragment (text = the code)
  - `repo_fact` — a stable fact about the repo ("CI needs Node 22")
  e.g. `pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:remember --kind lesson --text "..." --agent claude --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"`.
- For listing, searching, updating, or deleting stored items (and task/blocker state), use `/dfc-memory` instead — this skill is the quick-add path.
- Remembered items resurface through `/dfc-context` and `/dfc-search`.
- The embedded SurrealKV default needs no credentials; hosted mode reads `.dfc/surreal.env` or `DFC_SURREAL_*`.
