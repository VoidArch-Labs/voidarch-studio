---
description: Search the shared dev memory for a topic — ranks document chunks via BM25. Use only when explicitly invoked to find prior context.
disable-model-invocation: true
allowed-tools: Bash
---

Search the document memory for the given topic and read the ranked chunks as context:

!`pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:docs:query --q "$ARGUMENTS" --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"`

Notes:
- Add `--dry-run` to search a fresh in-memory chunking of the repo with no database.
- For the full hybrid context pack (files, graph symbols, graph neighborhood, document chunks, vector matches, decisions, evidence, prior runs) use `/dfc-context` instead.
- Treat results as leads, not complete truth; follow up with narrow file reads.
