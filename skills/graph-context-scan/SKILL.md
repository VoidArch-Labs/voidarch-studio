---
name: graph-context-scan
description: This skill should be used before broad file reads on any medium-or-larger code task — when the user asks to "understand the codebase", "find where X is implemented", "locate the relevant files", "map dependencies", investigate a cross-file bug, or plan a multi-file change. It queries the repo graph (graphify) or an index first and returns a compact structural summary instead of reading many files raw.
disable-model-invocation: false
---

# Graph Context Scan

Query a repo graph/index before raw file reads on medium-or-larger code tasks. This is one of
the few moves that actually saves tokens: it locates the relevant files, symbols, and tests so
file reads are targeted, not archaeological.

## When to use

- Before broad file reads on any non-trivial code task: cross-file work, unclear architecture,
  bug localization, "where is X", or impact analysis.
- Skip for tiny single-file edits where the target is already known (the
  `enforce-repo-graph-first` hook deliberately does not block these).

## Integration model — explicit, and may be unavailable

```
Preferred:
- Graphify MCP or CLI, if installed.

Fallback (in order):
- RepoGraph / RIG-like graph
- Tree-sitter / AST index
- Sourcegraph-like literal search
- vector / hybrid index
- plain grep / glob search via repo-explorer (last resort)
```

Configuration (env vars, with defaults):

```
GRAPH_INDEX_TOOL=graphify
GRAPH_INDEX_COMMAND=                       # leave empty if the real command is unknown
GRAPH_INDEX_OUTPUT_DIR=.agent-runs/graph
GRAPH_INDEX_FRESHNESS_MINUTES=60
```

**If the Graphify command/MCP name is unknown, do not invent one.** Record graph integration as
**unavailable** and fall back to `repo-explorer` search. Honesty about availability beats a
fabricated command.

## Procedure

1. **Determine availability.** Check for a configured `GRAPH_INDEX_COMMAND`, a graphify MCP, a
   fresh `GRAPH_INDEX_OUTPUT_DIR` (default `.agent-runs/graph`), or an existing `graphify-out/`.
   If none exist and no command is configured → graph is **unavailable**.
2. **Query the graph** (if available): run it / read its output. Treat the user's question as a
   graph query. A fresh output dir also silences the `enforce-repo-graph-first` nudge for the session.
3. **Fall back** (if unavailable): use `repo-explorer` or Grep/Glob, and record the reason.
4. **Return the compact summary** below. Do not dump file contents.

## Required output

```md
# Graph Context Scan

Graph tool:                 # graphify | repograph | tree-sitter | sourcegraph | vector | none
Graph available:            # yes / no
Graph freshness:            # fresh | stale | unknown
Command/MCP used:           # the actual command or MCP tool, or "none"
Output location:            # e.g. .agent-runs/graph, graphify-out/, or "n/a"
Relevant files:
Relevant symbols:
Callers/callees:
Related tests:
Fallback used:              # e.g. grep/glob via repo-explorer, or "none"
Reason if graph unavailable:
```

Hand the minimal "Relevant files" read set back to the supervisor or `implementation-worker` —
not a wall of code. See `templates/docs/graph-index-flow.md` for the benchmark-against-alternatives
policy.
