---
description: Query the repo knowledge graph (graphify) for symbols and their neighborhood. Use only when explicitly invoked to explore code structure.
disable-model-invocation: true
allowed-tools: Bash
---

Rank graph nodes (files, modules, symbols, concepts) for the topic and show their import/call/contains neighborhood:

!`cd "${CLAUDE_PLUGIN_ROOT}" && pnpm dfc:graph:query --q "$ARGUMENTS"`

Notes:
- Add `--dry-run` to query `graphify-out/graph.json` directly with no database.
- Graph facts come from `/graphify`; if results look stale, refresh with `/graphify` then `pnpm dfc:graph:import`.
- Use this to find impact/dependency neighborhoods before editing a symbol.
