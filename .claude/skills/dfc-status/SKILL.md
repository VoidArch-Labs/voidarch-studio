---
description: Report shared dev-memory health — table counts, graph freshness, and a cross-channel doctor. Use only when explicitly invoked.
disable-model-invocation: true
allowed-tools: Bash
---

Report the health of the shared dev memory across all channels.

Cross-channel doctor (resilient — works even with no database configured):

!`cd "${CLAUDE_PLUGIN_ROOT}" && pnpm dfc:memory:doctor`

Per-table row counts (requires SurrealDB credentials):

!`cd "${CLAUDE_PLUGIN_ROOT}" && pnpm dfc:status`

Graph freshness vs current HEAD:

!`cd "${CLAUDE_PLUGIN_ROOT}" && pnpm dfc:graph:status`

Notes:
- `dfc:memory:doctor` always reports local diagnostics (ingestible docs, graph presence, embedding provider) and adds a database section only when credentials are configured.
- A stale graph means `graphify-out/` predates current code — refresh with `/graphify`, then `pnpm dfc:graph:import`.
