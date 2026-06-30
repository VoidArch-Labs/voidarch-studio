# Post-Merge Validation & docs→graph→vectors Roadmap

Status report for the canonical `dev-flow-control` plugin **after PR #1**
("Merge shared SurrealDB dev memory into Claude plugin", merged into `main` as
`cda97cc`). This document records what was validated post-merge and the
implementation-ready plan for the next three memory layers.

Companion to [`spec-delta-surrealdb.md`](spec-delta-surrealdb.md) and
[`dev-flow-control-spec.md`](dev-flow-control-spec.md).

---

## 1. Post-merge validation results

| Area | Result | Evidence |
| --- | --- | --- |
| **B. Live plugin install** | Manifest **loads via the real CLI** (`claude plugin validate .` → ✔ passed, Claude Code 2.1.62). Structure/skills/hooks discovery verified programmatically. A full nested *session* test is blocked by Claude Code's own `CLAUDECODE` guard ("cannot launch inside another session") — runnable interactively (see below). | `claude plugin validate .`; `plugin.json` parses; all 7 `hooks.json` scripts exist + executable; 7 model skills + `/dfc-context` discoverable; 9 agents; `.mcp.json` parses |
| **C. Hook validation** | **39/39 cases pass.** Safe writes allowed; protected files / dangerous shell / write-like MCP blocked; read-only MCP allowed; scoped-approval overrides work; graph-first nudge fires; verification gate warns (+ strict-blocks); observability logs valid JSONL; empty/malformed/missing-jq all **fail closed**. Payload shapes match current Claude Code — **no parser change needed**. | [`scripts/dfc-validate-hooks.sh`](../scripts/dfc-validate-hooks.sh) → `pnpm dfc:validate-hooks` |
| **D. Read-only DB check** | **Skipped — no credentials** (`DFC_SURREAL_URL/USER/PASS` unset; no `.dfc/surreal.env`). `pnpm dfc:db:check` fails **gracefully** with `NOT CONFIGURED` and exits non-zero; no secrets printed. | `pnpm dfc:db:check` (read-only; reports placeholder config) |
| **E. Graphify refresh** | Refreshed via `graphify update .` (AST, **no LLM/tokens**): **135→523 nodes, 180→739 edges, 46 communities**. New import-bridge + SurrealDB modules indexed. `.surql`/new-doc **semantic** extraction deferred (no `GEMINI_API_KEY`) to `/graphify --update`. `graphify-out/` stays gitignored. | `graphify update .`; `graphify-out/graph.json` (523 nodes) |
| **F. Run import bridge** | **Implemented + dry-run validated.** See §2. | `pnpm dfc:import-runs --agent claude --dry-run`; `pnpm exec tsc --noEmit` ✔ |

**Running the live plugin session manually** (outside an active Claude Code
session, so the `CLAUDECODE` guard does not trip):

```bash
claude --plugin-dir /path/to/dev-flow-control
# then, in-session: confirm /dfc-context is offered and hooks fire on tool use
```

The nested-session guard is an environment safety feature, **not** a plugin
defect: the manifest, hooks, skills, and agents all load and validate.

---

## 2. Run import bridge (shipped in this layer)

One-directional flow keeps the loggers credential-free; only the importer talks
to the database:

```
Claude Code hooks (hooks/log-agent-run.sh)  ─┐
dfc:log-tool  (manual / Codex tool events)  ─┼─►  .agent-runs/ (local, gitignored)  ──►  dfc:import-runs  ──►  SurrealDB
dfc:log-run   (explicit run summaries)      ─┘                                          (dedupe + redact)      (tool_event, agent_run,
                                                                                                                verification_run, approval)
```

| Script | Package command | Role | DB? |
| --- | --- | --- | --- |
| [`scripts/dfc-import-runs.ts`](../scripts/dfc-import-runs.ts) | `pnpm dfc:import-runs` | Read `.agent-runs`, map → rows, **dedupe by content hash**, write. | write (only non-dry-run) |
| [`scripts/dfc-log-tool.ts`](../scripts/dfc-log-tool.ts) | `pnpm dfc:log-tool` | Append a hook-shaped `tool_event` line (manual/Codex). | none |
| [`scripts/dfc-log-run.ts`](../scripts/dfc-log-run.ts) | `pnpm dfc:log-run` | Write/merge an explicit `agent_run` summary (`run.json`). | none |
| [`src/memory/runs.ts`](../src/memory/runs.ts) | — | Shared parsing, redaction, hashing, row mapping. | none |

**Mapping** (source JSONL → DB columns the `/dfc-context` pack already queries):

- `tool_event`: `repo_id, source_agent, tool_name, action, summary, success, created_at` (+ provenance + `event_hash`). `action`/`summary` derived per tool (Bash → first token / command; mcp → `mcp_tool`; file tools → path).
- `agent_run`: one per session, derived from its events (or overridden by `run.json`): `task_goal, status, summary, event_count, tool_breakdown, created_at`.
- `verification_run`: from `verification.json` — `status` defaults to `ran` (never `fail`, since the hook marker records only that verification *executed*).
- `approval`: from `.agent-runs/approvals/*.json` (global + per-session) — `tool_pattern, expires_at, single_use`.

**Flags:** `--agent claude|codex|manual` · `--dry-run` · `--limit <n>` · `--session <id>` · `--json` · `--task <goal>`.

**Safety guarantees (validated):** secrets are redacted before any write
(`Bearer …`, `gh*_…`, `password|token|secret|DFC_SURREAL_PASS=…`, `--password/--token`);
payloads are length-capped; PreCompact markers and malformed JSONL lines are
skipped with a warning; re-import is idempotent (hash dedupe). Dry-run + typecheck
need **no** credentials.

**Deferred:** a live DB import (`pnpm dfc:import-runs --agent claude --limit 50`)
once `.dfc/surreal.env` exists; an optional `schema/0003` dedupe index on
`event_hash` / `run_hash` (the `IN` dedupe query works without it at current scale).

---

## 3. Next three implementation stages

Storage stays **SurrealDB**. Retrieval stays **token-budgeted**. Each stage adds a
channel; none replaces BM25 or the graph.

> **✅ DELIVERED** in branch `memory/docs-graph-vector-substrate` (PR #3), then live
> validated after PR #5. All three stages below are implemented, typecheck-clean, and
> live validated in the canonical hosted SurrealDB database. As-built notes:
>
> | Stage | As-built commands | Tables | Notes |
> | --- | --- | --- | --- |
> | 1 docs | `dfc:docs:ingest`, `dfc:docs:query` | `document` + reused `doc_chunk` (BM25 from 0002) | heading-first chunking, content-hash dedupe, idempotent (unchanged files skipped); `--dry-run` chunks + scores locally |
> | 2 graph | `dfc:graph:import`, `dfc:graph:query`, `dfc:graph:status` | `graph_snapshot/node/edge/hyperedge`, `graph_import_run` | unified node(`kind`)/edge(`relation`) model maps graphify node-link JSON; the producer is `/graphify` (the roadmap's `dfc:graph:index`); freshness = `built_at_commit` vs HEAD |
> | 3 vectors | `dfc:embed`, `dfc:memory:doctor`, `dfc:memory:gc` | `embedding_model`, `embedding_chunk` | explicit provider, paid path gated; dimension-agnostic schema + JS cosine; dedupe by content hash; **off by default** |
>
> Schema: [`schema/0003_documents_graph_vectors.surql`](../schema/0003_documents_graph_vectors.surql)
> (idempotent, non-destructive). Hybrid retrieval lives in
> [`src/memory/context-pack.ts`](../src/memory/context-pack.ts) — `repo_context.{symbols,graph_neighborhood}`,
> `document_context.chunks`, `vector_context.chunks` added behind graceful degradation.
>
> **What is implemented vs gated:**
> - *Implemented now (typecheck + live validation):* all code paths above + the seven `.claude/skills/dfc-*`.
> - *Dry-run only (no creds):* `*:ingest/query/status --dry-run`, `dfc:embed --dry-run`, `dfc:memory:doctor`, `dfc:memory:gc --dry-run`.
> - *Requires SurrealDB credentials:* every live ingest/import/query/status + `dfc:db:migrate`.
> - *Requires explicit embedding provider:* `dfc:embed` live; the `openai` path also requires `OPENAI_API_KEY` **and** approval.
>
> **Live validation result (2026-06-30):**
> - `pnpm dfc:embed --limit 1000` embedded 234 remaining chunks after the initial 5-row bounded check, with 0 skips, 0 errors, and dimension 1536.
> - `pnpm dfc:status` reported `Doc chunks: 239`, `Embedding models: 1`, and `Embedding chunks: 239`.
> - `pnpm dfc:context --task "Verify full OpenAI text-embedding-3-small vector retrieval after full embedding" --agent codex` returned 6 `vector_context.chunks`.
>
> **Run live validation** once `.dfc/surreal.env` exists (URL + user + pass + ns/db):
> ```bash
> pnpm dfc:db:check && pnpm dfc:db:migrate
> pnpm dfc:ingest --agent claude && pnpm dfc:docs:ingest --agent claude
> pnpm dfc:graph:import --agent claude        # after /graphify
> pnpm dfc:import-runs --agent claude --limit 50
> pnpm dfc:context --task "Final live validation of docs graph vector memory substrate" --agent claude
> pnpm dfc:status
> # vectors only with an explicit, approved provider:
> # DFC_EMBED_PROVIDER=ollama pnpm dfc:embed --limit 25
> ```

### Stage 1 — docs / chunks

Populate the reserved `doc_chunk` table so prose (not just whole files) is retrievable.

- **Commands:** `dfc:docs:ingest` (chunk + store), `dfc:docs:query` (retrieve chunks).
- **Sources:** `README`/`docs`/`templates`, skills, agents, session recaps, PR summaries, architecture notes, external-doc summaries.
- **Design:** split on headings/size with overlap; `content_hash` per chunk (dedupe); keep `path`, `heading`, `ord`, `repo_id`, `source_agent`; reuse the BM25 index pattern from `schema/0002`; fold top chunks into the existing context-pack token budget.

### Stage 2 — graph

Store graph **facts** in SurrealDB (graphify/Tree-sitter/SCIP are fact *producers*).

- **Commands:** `dfc:graph:index` (run a producer), `dfc:graph:import` (load `graphify-out/graph.json` → SurrealDB), `dfc:graph:query` (path/neighbors), `dfc:graph:status` (freshness).
- **Producers:** Tree-sitter, SCIP, Graphify or equivalent → normalized `graph_node` / `graph_edge` rows (`repo_id`, `kind`, `source_file`, `confidence` EXTRACTED/INFERRED/AMBIGUOUS).
- **Design:** `dfc:graph:import` is deterministic + idempotent (hash by node/edge id) — mirrors `dfc:import-runs`; freshness compares producer output mtime vs newest source commit (the staleness check this round already used).

### Stage 3 — vectors

Add embeddings as **one** retrieval channel in a hybrid ranker.

- **Commands:** `dfc:embed` (embed chunks/memories), `dfc:memory:doctor` (health/coverage), `dfc:memory:gc` (prune stale/orphaned).
- **Rules (hard):**
  - Vectors are a retrieval channel — **not** a replacement for BM25 or graph.
  - Embedding **provider must be explicit**; **paid embedding APIs require approval** (route through the `approval-request` skill / scoped approval).
  - Chunks **dedupe by content hash**.
  - Hybrid retrieval (BM25 + vector + graph) stays **token-budgeted** (extend the context-pack greedy-by-score assembly).
  - Local/offline embedding is the default path when no provider is approved.

---

## 4. What remains after this layer

- **Live canonical SurrealDB validation** — completed on 2026-06-30 for docs, graph,
  context retrieval, and full OpenAI vector embeddings.
- **Interactive plugin-session test** — `claude --plugin-dir .` to confirm the seven
  `/dfc-*` skills are offered and hooks fire (blocked here by the nested-session guard).
- **Vector index tuning** — optionally add a per-model MTREE index for KNN (the 0003
  schema remains dimension-agnostic; current retrieval uses deterministic JS cosine).
- Doc-level semantic graph re-extraction (`/graphify --update` or set `GEMINI_API_KEY`).
- Efficiency benchmark before any token-savings claim (unchanged from prior spec).
