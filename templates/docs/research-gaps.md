# Research Gaps

Verify these before full rollout. They are points where vendor behavior, pricing, or APIs may have
changed and the plugin's assumptions need confirming. Prefer Context7 / official docs over memory.

## Claude Code

- current plugin manifest schema and component set (this plugin already dropped the non-existent
  `monitors` component — re-check before adding new component types)
- skill visibility behavior and `disable-model-invocation` semantics
- `skillOverrides` values and precedence (user vs project vs plugin)
- subagent quota / context behavior
- model + effort cache behavior
- Desktop vs terminal differences
- OpenTelemetry env-var names (see `observability.md`)

## GitKraken / Kepler

- current plan/pricing
- which agents Kepler supports (launch vs observe-only)
- GitKraken MCP capabilities by plan
- CLI Work Items availability
- Automations availability
- Launchpad availability

## Jules

- quota and concurrency
- repo permissions and privacy/data handling
- GitHub `jules` label behavior
- CLI/API stability
- whether API sessions auto-approve plans by default (this plugin assumes **not** and gates them)

## Graphify / repo graph

- whether graphify is the chosen tool or just the slot name
- supported languages
- incremental indexing
- output format (`graphify-out/` shape)
- MCP/CLI integration surface
- benchmark vs RepoGraph, RIG, Codebase-Memory, GraphCoder, Tree-sitter indexes, Sourcegraph-like
  search, vector/hybrid retrieval (see `efficiency-benchmark.md`)

## Context7

- CLI vs MCP token cost
- exact library-ID workflow and rate limits
- docs coverage for the packages you actually use
- security/completeness caveats

## Firecrawl

- keyless hosted limits
- API-key pricing
- self-hosting requirements and local CPU/RAM load
- crawl/map/extract limits
- privacy constraints

## How to use this list

Treat each unchecked item as a risk to the plugin's assumptions. When you confirm one, update the
relevant doc (and remove the stale assumption) rather than leaving two sources of truth.
