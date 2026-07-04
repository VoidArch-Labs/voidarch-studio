---
description: Build the repo graph directly into SurrealDB with the Rust graphify-surreal binary (no JSON export/import step). Use only when explicitly invoked to build or refresh the repo graph.
disable-model-invocation: true
allowed-tools: Bash
---

Build (or refresh) the active repo's code graph straight into its dev-memory database:

!`pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:graph:build --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}" $ARGUMENTS`

Then report node/edge counts from the final status output. Notes:
- default is the fast AST-only pass; `--deep` adds the agent-harness semantic pass (slow)
- `--status` only prints counts; `--query "question"` searches the graph
- requires the `graphify-surreal` binary (GRAPHIFY_SURREAL_BIN, PATH, or the local
  cargo release build) and repo SurrealDB credentials; the command explains what is
  missing otherwise — fall back to `/dfc-graph` (JSON import path) in that case
