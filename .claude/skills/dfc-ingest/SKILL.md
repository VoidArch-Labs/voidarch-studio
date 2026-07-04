---
description: Refresh the shared dev memory by ingesting repo files and document chunks into SurrealDB. Use only when explicitly invoked.
disable-model-invocation: true
allowed-tools: Bash
---

Refresh the shared dev memory from the current repo state.

Ingest repo text files (BM25 file memory):

!`pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:ingest --agent claude --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"`

Ingest heading-chunked markdown (document memory):

!`pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:docs:ingest --agent claude --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"`

Notes:
- Both are idempotent: re-ingestion upserts by content; unchanged documents are skipped.
- Add `--dry-run` to either command to preview without a database.
- To also refresh graph memory: run `/graphify` then `pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:graph:import --agent claude --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"`.
- Requires SurrealDB credentials (`.dfc/surreal.env` or `DFC_SURREAL_*`).
