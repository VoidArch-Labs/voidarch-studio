---
description: Store a compact end-of-session recap into the shared dev memory for the next session. Use only when explicitly invoked.
disable-model-invocation: true
allowed-tools: Bash
---

Persist a compact recap of this session as evidence so the next session inherits it. Pass a one-or-two sentence summary, e.g. `/dfc-session-recap Implemented docs/graph/vector substrate; live DB validation still pending creds`.

!`pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:remember --kind evidence --text "Session recap: $ARGUMENTS" --agent claude --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"`

Notes:
- Keep it short — the first sentence becomes the searchable summary.
- The recap resurfaces through `/dfc-context` and `/dfc-search`.
- To also import this session's tool activity from `.agent-runs`, run `pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:import-runs --agent claude --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"`.
- Requires SurrealDB credentials (`.dfc/surreal.env` or `DFC_SURREAL_*`).
