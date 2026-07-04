---
description: Report shared dev-memory health — table counts, graph freshness, and a cross-channel doctor. Use only when explicitly invoked.
disable-model-invocation: true
allowed-tools: Bash
---

Report the health of the shared dev memory across all channels.

Cross-channel doctor (resilient — works even with no database configured):

!`pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:memory:doctor --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"`

Per-table row counts (requires SurrealDB credentials):

!`pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:status --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"`

Graph freshness vs current HEAD:

!`pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:graph:status --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"`

Notes:
- `dfc:memory:doctor` always reports local diagnostics (ingestible docs, graph presence, embedding provider) and adds a database section only when credentials are configured.
- A stale graph means `graphify-out/` predates current code — refresh with `/graphify`, then `pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:graph:import --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"`.
