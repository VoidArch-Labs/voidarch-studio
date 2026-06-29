# Repo Graph / Index Flow

Use a repo graph/index **before** broad raw file reads on medium-or-larger code tasks. This is one
of the few moves that genuinely lowers tokens rather than just looking clever in a diagram.

## Integration is explicit — and may be unavailable

The plugin does not pretend a graph tool exists when it doesn't. State of integration:

```
Preferred:
- Graphify MCP or CLI, if installed and configured.

Fallback (in order):
- RepoGraph / RIG-like graph
- Tree-sitter / AST index
- Sourcegraph-like literal search
- vector / hybrid index
- plain grep / glob via repo-explorer (last resort)
```

**If the Graphify command/MCP name is unknown, the plugin records graph integration as
`unavailable` and falls back to `repo-explorer` search.** Do not invent a Graphify command.
`templates/mcp.examples/graphify.optional.json` is an explicit placeholder, not an active server.

## Configuration (env vars, with defaults)

```
GRAPH_INDEX_TOOL=graphify
GRAPH_INDEX_COMMAND=                       # empty = unknown → unavailable → fall back to search
GRAPH_INDEX_OUTPUT_DIR=.agent-runs/graph
GRAPH_INDEX_FRESHNESS_MINUTES=60
DFC_GRAPH_READ_THRESHOLD=4                 # raw reads before the graph-first nudge fires
```

`graph-context-scan` and `graph-navigator` read these. `enforce-repo-graph-first` treats a fresh
`GRAPH_INDEX_OUTPUT_DIR` (or an existing `graphify-out/`) as "scanned" for the session.

## Session-specific markers (no stale global silence)

Graph-scan state is **per session**, not global:

```
.agent-runs/sessions/<session-id>/
  graph-scanned.json     # written when a graph scan ran (or a fresh output dir exists)
  read-count             # raw-read counter for the nudge
  graph-warned           # set once the nudge has fired this session
```

If no session id is available, the fallback is `.agent-runs/sessions/current-session/`. Because the
markers are session-scoped, one stale `graph-scanned` cannot silence the nudge forever — each new
session re-evaluates. `log-compact-recap` also re-arms the nudge after compaction.

## "Graphify is a slot, not a guarantee"

Benchmark graphify against alternatives before claiming it's the best choice: RepoGraph, RIG/SPADE,
Codebase-Memory, GraphCoder, Tree-sitter/AST indexes, Sourcegraph-like search, vector/hybrid
indexes, a local symbol index. See `efficiency-benchmark.md` for measurement and `research-gaps.md`
for the open questions about graphify itself (languages, incremental indexing, output format,
concrete command/MCP name).

## Rules

1. Use the graph before raw file reads on medium+ tasks.
2. Record availability, the command/MCP used (or "none"), and graph freshness.
3. If unavailable, say so and fall back to search — honesty over a fabricated command.
4. Return a compact "relevant files" read set, not file dumps.
