# Specification Delta: SurrealDB Memory Architecture

## Summary

This delta records the move from an unspecified, plugin-local storage idea to a single,
**agent-neutral SurrealDB dev-memory backend** reached through a repo-local `pnpm dfc:*` CLI. The
first slice was built and live-validated in the temporary `dev-flow-control-codex` fork and is
merged back into the canonical Claude Code plugin repo `dev-flow-control` by this PR, adapted to
canonical naming. Claude Code remains the canonical local supervisor; Codex and future agents share
the same CLI and database. BM25, document, graph, and vector retrieval channels are implemented,
with full OpenAI embedding coverage live-validated on 2026-06-30.

## Before / After Table

| Area | Old spec | Updated spec |
| --- | --- | --- |
| Storage | No single backend selected | SurrealDB only |
| Setup | Plugin-centric, local Claude Code focused | Hosted SurrealDB Cloud + repo-local CLI |
| Multi-repo | Not specified as DB model | One namespace, one database per repo |
| Repo graph | Graphify/equivalent as graph slot | Graph tools produce facts; SurrealDB stores facts |
| Context | Graph/search/docs routed to Claude | Compact context packs from SurrealDB |
| Docs | Docs strategy, no chunk memory | Document chunks in SurrealDB |
| Vectors | Research/benchmark candidate | Approval-gated retrieval channel in SurrealDB |
| Codex | External-agent instructions | Shared DB through AGENTS.md + pnpm dfc:* |
| Claude skill | Routing skills | /dfc-context implemented; memory skill suite planned |
| Observability | Local .agent-runs logs | Import logs/runs/tool events into SurrealDB |
| Auth | Not specified | Root for bootstrap; lower-privilege daily user target |
| Status | Feature-complete but unvalidated plugin | SurrealDB slice validated; full plugin still pending |
| Token claims | Intended token savings | Benchmark required before claiming improvement |

## Conceptual Diff

```diff
- Storage backend: undecided (SQLite? LanceDB? Kuzu? Neo4j? mix?)
+ Storage backend: SurrealDB only — no SQLite/LanceDB/Kuzu/Neo4j fallback

- Repo discovery: re-read files / route graph+search+docs straight to Claude
+ Repo discovery: compact context packs assembled from SurrealDB (BM25 now)

- Graph tools = a storage slot
+ Graph tools (graphify/SCIP/Tree-sitter) = fact producers; SurrealDB stores facts

- Agents: Claude-plugin specific
+ Agents: agent-neutral CLI (pnpm dfc:*); Claude via /dfc-context, Codex via AGENTS.md

- Memory access: direct / ad hoc
+ Memory access: only through repo-local pnpm dfc:* CLI; repo_id on every row

- Status: "feature-complete"
+ Status: SurrealDB slice validated in Codex fork; canonical docs/graph/vector substrate live-validated
```

## Files changed

Imported/adapted from the `dev-flow-control-codex` fork into canonical `dev-flow-control`:

- `.dfc/README.md`, `.dfc/surreal.example.env` — hosted SurrealDB config (canonical defaults).
- `.claude/skills/dfc-context/SKILL.md` — Claude `/dfc-context` thin wrapper.
- `.github/workflows/typecheck.yml` — CI typecheck.
- `schema/0001_core.surql`, `schema/0002_indexes.surql` — core tables + BM25 indexes.
- `scripts/dfc-*.ts` — the six `dfc` CLI entrypoints.
- `src/memory/*` — connection, types, agents, ingestion, scoring, context pack.
- `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `.npmrc` — toolchain and `dfc:*` scripts.
- `AGENTS.md` — agent-neutral guidance + external-agent rules; canonical naming.
- `README.md` — preserved Claude plugin description + agent-neutral dev-memory section.
- `docs/dev-memory-surreal-first-round.md` — first-round design doc (canonical defaults).

Created in this PR:

- `docs/dev-flow-control-spec.md` — specification v0.2.
- `docs/spec-delta-surrealdb.md` — this delta.

Canonical naming applied (fork → canonical): package `dev-flow-control-codex` → `dev-flow-control`;
`DFC_SURREAL_DB=repo_dev_flow_control_codex` → `repo_dev_flow_control`;
`DFC_REPO_ID=dev-flow-control-codex` → `dev-flow-control`; `surreal.ts` defaults updated; CI branch
`codex/surreal-dev-memory` → `surrealdb/shared-dev-memory`.

## Implemented now

- Hosted SurrealDB backend + connection layer; schema migrations.
- `pnpm dfc:db:check | db:migrate | ingest | remember | context | status`.
- Repo ingestion, decision/evidence memory, deterministic **BM25** scoring, compact context-pack
  JSON (short excerpts, token-budgeted).
- Claude `/dfc-context` skill; Codex wiring via `AGENTS.md`.
- CI typecheck workflow.
- **Run import bridge**: `dfc:import-runs` / `dfc:log-run` / `dfc:log-tool` import local
  `.agent-runs` logs into `tool_event` / `agent_run` / `verification_run` / `approval`
  (content-hash dedupe + secret redaction; dry-run needs no DB). See
  [`postmerge-validation-and-roadmap.md`](postmerge-validation-and-roadmap.md).

## Still planned

- Optional per-model vector indexes for KNN tuning; current retrieval ranks stored vectors with
  deterministic JS cosine.
- Live DB import of `.agent-runs` if real session logs are available.
- Efficiency benchmark before any token-savings claim.

## Validation

- The first SurrealDB memory slice was **live-validated in the `dev-flow-control-codex` fork**
  (PR #1, merged).
- In the canonical repo this PR is validated by `pnpm install` + `pnpm exec tsc --noEmit`.
- **Post-merge** (branch `postmerge/live-plugin-memory-validation`): plugin manifest validated via
  `claude plugin validate` (✔, Claude Code 2.1.62); **39/39 hook cases pass**
  (`pnpm dfc:validate-hooks`); graphify graph refreshed (523 nodes); run import bridge dry-run
  validated. A full *nested* plugin session is blocked by Claude Code's `CLAUDECODE` guard — run
  `claude --plugin-dir <repo>` interactively. See
  [`postmerge-validation-and-roadmap.md`](postmerge-validation-and-roadmap.md).
- No token/efficiency improvement is claimed until the benchmark is run.
- **docs/graph/vector substrate** (branch `memory/docs-graph-vector-substrate`, completed
  through PR #5): document, graph, and vector memory channels + hybrid context-pack retrieval
  + seven Claude memory skills are implemented and live validated. Migration `schema/0003`
  is idempotent/non-destructive. On 2026-06-30, the canonical hosted database held 239
  `doc_chunk` rows, 1 `embedding_model`, and 239 OpenAI `text-embedding-3-small`
  `embedding_chunk` rows at 1536 dimensions. See
  [`postmerge-validation-and-roadmap.md`](postmerge-validation-and-roadmap.md).
