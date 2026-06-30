---
description: Refresh the shared dev memory by ingesting repo files and document chunks into SurrealDB. Use only when explicitly invoked.
disable-model-invocation: true
allowed-tools: Bash
---

Refresh the shared dev memory from the current repo state.

Ingest repo text files (BM25 file memory):

!`cd "${CLAUDE_PLUGIN_ROOT}" && pnpm dfc:ingest --agent claude`

Ingest heading-chunked markdown (document memory):

!`cd "${CLAUDE_PLUGIN_ROOT}" && pnpm dfc:docs:ingest --agent claude`

Notes:
- Both are idempotent: re-ingestion upserts by content; unchanged documents are skipped.
- Add `--dry-run` to either command to preview without a database.
- To also refresh graph memory: run `/graphify` then `pnpm dfc:graph:import --agent claude`.
- Requires SurrealDB credentials (`.dfc/surreal.env` or `DFC_SURREAL_*`).
