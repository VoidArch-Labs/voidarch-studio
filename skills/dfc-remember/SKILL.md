---
description: Persist a decision or evidence item into the shared SurrealDB dev memory. Use only when explicitly invoked to remember something for future sessions.
disable-model-invocation: true
allowed-tools: Bash
---

Record a decision in the shared, agent-neutral dev memory. Pass the text as arguments, e.g. `/dfc-remember We chose hosted SurrealDB because one backend serves every repo`.

!`pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:remember --kind decision --text "$ARGUMENTS" --agent claude --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"`

Notes:
- The first sentence becomes the summary; keep the text to one or two sentences.
- To record an observation instead of a decision, run `pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:remember --kind evidence --text "..." --agent claude --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"`.
- Remembered items resurface through `/dfc-context` and `/dfc-search`.
- Requires SurrealDB credentials (`.dfc/surreal.env` or `DFC_SURREAL_*`).
