# dev-flow-control Specification v0.2

## SurrealDB Shared Dev-Memory Architecture

`dev-flow-control` is the canonical **Claude Code plugin**. This document specifies the shared,
**agent-neutral** dev-memory layer it ships alongside the plugin: a repo-local `dfc` CLI
(`pnpm dfc:*`) backed by **hosted SurrealDB**.

Ground rules that hold throughout this spec:

- **SurrealDB is the only storage backend.** There is **no SQLite / LanceDB / Kuzu / Neo4j
  fallback**.
- **Graphify / SCIP / Tree-sitter are fact producers, not storage backends.** They produce graph
  facts; SurrealDB stores them.
- **BM25 full-text retrieval is implemented now.**
- **Vectors are planned, not implemented.**
- **Graph storage/query is planned, not implemented.**
- **Document chunks are planned beyond placeholders.**
- **The first SurrealDB memory slice was built and live-validated in the temporary
  `dev-flow-control-codex` fork.**
- **The canonical Claude Code plugin still needs live plugin install / hook validation.**

---

## 1. Current Status

### 1.1 Implemented and live-validated in Codex fork

Built and run against a live hosted SurrealDB instance in `dev-flow-control-codex`:

- Hosted SurrealDB dev-memory backend and connection layer (`src/memory/surreal.ts`).
- Schema migrations: `schema/0001_core.surql` (core tables) and `schema/0002_indexes.surql`
  (BM25 full-text indexes).
- CLI surface: `pnpm dfc:db:check`, `dfc:db:migrate`, `dfc:ingest`, `dfc:remember`, `dfc:context`,
  `dfc:status`.
- Repo ingestion, decision/evidence memory, deterministic scoring, and compact context-pack JSON.
- `AGENTS.md` Codex guidance and the Claude `.claude/skills/dfc-context/SKILL.md` wrapper.
- CI typecheck workflow (`.github/workflows/typecheck.yml`).

### 1.2 Being merged into canonical Claude Code repo

This PR imports the slice above into `dev-flow-control` and adapts it to canonical naming
(`dev-flow-control`, `repo_dev_flow_control`) while preserving the existing Claude Code plugin
identity (`.claude-plugin/`, `skills/`, `agents/`, `hooks/`, `templates/`, `.mcp.json`).

### 1.3 Implemented but still needs live Claude Code plugin validation

- The `/dfc-context` skill exists and shells out to the same CLI, but has **not** been run inside a
  live Claude Code plugin install.
- Plugin hook payloads, session markers, and the GitHub MCP wiring have not been exercised against
  this dev-memory layer in a live session.
- No end-to-end run has confirmed Claude and Codex sharing one live database from this repo.

### 1.4 Not implemented yet

- Vector embeddings and vector indexes.
- Graph storage and graph queries inside SurrealDB.
- Document-chunk ingestion beyond schema placeholders.
- Automated import of Claude hook logs / Codex task summaries into `agent_run` / `tool_event`.
- The efficiency benchmark needed before any token-savings claim.

---

## 2. Core Architecture

### 2.1 Runtime flow

```
Claude Code
Codex
future agents
  ↓
repo-local pnpm dfc:* CLI
  ↓
hosted SurrealDB
  ↓
per-repo dev-memory database
  ↓
compact context packs, decisions, evidence, docs, graph facts, vectors,
agent runs, verification, approvals
```

### 2.2 Operating rule

Agents do **not** talk to SurrealDB directly or embed driver code. The repo-local `pnpm dfc:*` CLI
is the single interface. Claude Code invokes it through the `/dfc-context` skill; Codex and future
agents invoke it through `AGENTS.md` instructions. One database per repo; `repo_id` on every row.

### 2.3 What SurrealDB does and does not replace

**Replaces:** ad-hoc scratch notes, scattered decision logs, and "re-read the whole repo every
session" discovery. It is the durable, shared memory substrate.

**Does not replace:** the Claude Code plugin itself (skills/agents/hooks), Git/GitKraken for source
state, graphify/SCIP/Tree-sitter as *fact producers*, Context7 for docs, or the user's approval
authority. SurrealDB stores facts those tools produce; it is not a code host, not a CI system, and
not a secret store.

---

## 3. SurrealDB Dev-Memory Backend

### 3.1 Backend decision

SurrealDB is the **single** storage backend for dev memory — relational rows, full-text (BM25),
graph edges, and vectors in one engine. This avoids a polyglot stack (no SQLite + LanceDB + Kuzu).
There is **no fallback backend**.

### 3.2 Hosted-first setup

Hosted **SurrealDB Cloud** is the primary setup. **No local SurrealDB install is required by
default.** A developer copies `.dfc/surreal.example.env` to `.dfc/surreal.env`, fills in the hosted
endpoint and credentials, and runs `pnpm dfc:db:check`.

### 3.3 Multi-repo model

One hosted instance can serve many repos. Use **one namespace** (`dev_flow_control`) and **one
database per repo** (`repo_<repo_slug>`). Every row also carries `repo_id` so a shared database
remains safe and filterable.

### 3.4 Environment

Canonical defaults for this repo:

```
DFC_SURREAL_URL=wss://<surrealdb-cloud-endpoint>
DFC_SURREAL_NS=dev_flow_control
DFC_SURREAL_DB=repo_dev_flow_control
DFC_REPO_ID=dev-flow-control
DFC_SURREAL_USER=<username>
DFC_SURREAL_PASS=<password>
DFC_SURREAL_AUTH_SCOPE=root|namespace|database
```

Secrets come from environment variables or `.dfc/surreal.env`. `.dfc/surreal.env` is **gitignored**.
`DFC_SURREAL_PASS` must **never** be printed or committed. Precedence:
`process.env > .dfc/surreal.env > .dfc/surreal.example.env`.

### 3.5 Auth model

Root auth is acceptable for the first bootstrap/migration, because the migration creates the
namespace and database when they do not exist yet. Daily Claude/Codex operation should move to
**namespace- or database-scoped credentials** after bootstrap. `DFC_SURREAL_AUTH_SCOPE` selects
`root`, `namespace`, or `database`.

---

## 4. Current Memory Schema

Defined in `schema/0001_core.surql`, indexed in `schema/0002_indexes.surql`:

| Table              | Purpose                                                        |
| ------------------ | ------------------------------------------------------------- |
| `repo`             | Repo identity and metadata.                                   |
| `file`             | Ingested repo files (path + content excerpt), BM25-indexed.   |
| `doc_chunk`        | Document chunk placeholder (text), BM25-indexed.              |
| `decision`         | Durable decisions (`summary`), BM25-indexed.                  |
| `evidence_item`    | Durable evidence (`summary`), BM25-indexed.                   |
| `task`             | Task goals (`goal`), BM25-indexed.                            |
| `context_pack`     | Generated context packs (`goal`), BM25-indexed.               |
| `verification_run` | Verification summaries (`summary`), BM25-indexed.             |
| `approval`         | Approval records.                                             |
| `agent_run`        | Agent run summaries (`manual`, `codex`, `claude`).            |
| `tool_event`       | Per-tool events for shared observability.                     |

Every shared-memory row carries `repo_id`; agent-produced rows also carry `source_agent`
(`manual` | `codex` | `claude`). BM25 full-text indexes (current SurrealQL
`FULLTEXT ANALYZER ... BM25` syntax) cover `file.content`, `doc_chunk.text`, `decision.summary`,
`evidence_item.summary`, `task.goal`, `context_pack.goal`, and `verification_run.summary`.

---

## 5. Target Memory Schema

### 5.1 Core repo memory

Current core tables, hardened: richer `file` metadata (language, symbol counts), explicit
`task → decision → evidence` links, and lifecycle fields on `context_pack`.

### 5.2 Agent and session memory

Populate `agent_run` and `tool_event` automatically from Claude hook logs and Codex task summaries,
plus a `session` grouping so cross-agent timelines reconstruct cleanly.

### 5.3 Graph memory

Graph nodes/edges (symbol → symbol, file → file, decision → file) stored as SurrealDB records and
graph relations. **Planned, not implemented.** Graphify / SCIP / Tree-sitter produce these facts;
SurrealDB stores them.

### 5.4 Vector and document memory

`doc_chunk` populated with real chunked text, plus embedding vectors and SurrealDB vector indexes
for semantic recall. **Planned, not implemented.**

---

## 6. Retrieval Strategy

### 6.1 Current retrieval

BM25 full-text retrieval with **deterministic scoring** (`src/memory/scoring.ts`): exact path
match, filename match, full-text match, recent decision/evidence boost, risk-keyword boost,
agent-run relevance boost, and a large-content penalty. Output is short excerpts assembled into a
compact context-pack JSON under a token budget — never full file dumps.

### 6.2 Target retrieval

Hybrid retrieval: **BM25 + vector + graph**, fused into one ranked context pack. Vectors and graph
are additive channels layered on top of the working BM25 base; the deterministic scoring stays as
the explainable backbone.

---

## 7. Claude Memory Skill Suite

### 7.1 Current implemented Claude skill

`.claude/skills/dfc-context/SKILL.md` — a thin, user-invoked wrapper
(`disable-model-invocation: true`, `allowed-tools: Bash`) that runs
`pnpm dfc:context --task "$ARGUMENTS" --agent claude` and reads the JSON as planning context.

### 7.2 Target Claude memory skills

- `dfc-remember` — persist a decision/evidence item from a Claude session.
- `dfc-status` — surface dev-memory health inline.
- `dfc-ingest` — refresh repo ingestion before planning.
- Optional auto-invocable "recall before broad reads" companion to the existing graph-scan hook.

---

## 8. Codex Wiring

Codex reads `AGENTS.md`. Before broad repo reads it runs
`pnpm dfc:context --task "<goal>" --agent codex`; it persists durable facts with
`pnpm dfc:remember --kind decision|evidence --text "..." --agent codex`. Codex uses the **same**
CLI, the **same** database, and the **same** `repo_id` as Claude — the plugin does not depend on
Codex, and Codex does not depend on the plugin.

---

## 9. Graph and Index Strategy

Implemented today: BM25 full-text indexes (Section 4). Planned: a graph schema (records + relations)
populated from graphify / SCIP / Tree-sitter output, queryable for dependencies, call chains, and
impact radius. **Graph tools produce facts; SurrealDB stores facts.** Graph storage and query are
**planned, not implemented**.

---

## 10. Document and Vector Memory

`doc_chunk` exists as a placeholder table with a BM25 index. Real document-chunk ingestion
(chunking, dedup, provenance) is **planned beyond placeholders**. Vector embeddings and vector
indexes are **planned, not implemented**. Both become retrieval channels after the BM25/docs/graph
base is solid.

---

## 11. Observability and Session Memory

Today the plugin logs runs and tool events to `.agent-runs/` (local JSONL). Target: import those
logs — plus Codex task summaries and tool events — into SurrealDB `agent_run` / `tool_event` so all
agents share one observable history instead of per-agent local logs.

---

## 12. Approval and Verification Memory

The `approval` and `verification_run` tables exist and `verification_run.summary` is BM25-indexed.
Target: import the plugin's verification gate results and scoped approval records into SurrealDB so
context packs can answer "what was last verified?" and "what is already approved?" across agents.

---

## 13. MCP and External Tools

The Claude plugin ships a **read-only GitHub MCP** server and references GitKraken, Context7,
Firecrawl, and `agent-cli` (Jules/Copilot) from the host. The dev-memory CLI is **independent** of
MCP: it is plain `pnpm dfc:*` scripts so any agent/harness can call it without MCP. MCP tools may
later *feed* SurrealDB (e.g. PR metadata), but are not a dependency of the memory layer.

---

## 14. Research and Implementation Gaps

- SurrealDB vector index ergonomics and embedding-model choice (local vs hosted).
- Graph-fact schema shape and the graphify → SurrealDB import contract.
- Hook-log → SurrealDB import format (Claude `PostToolUse` JSONL → `tool_event`).
- Token/accuracy **benchmark** methodology before claiming efficiency gains.
- Namespace/database-scoped credential provisioning after root bootstrap.

---

## 15. Acceptance Criteria

### 15.1 Acceptance A: current first slice

- `pnpm install` and `pnpm exec tsc --noEmit` pass.
- `pnpm dfc:db:check` connects to a hosted instance; `dfc:db:migrate` applies both schema files.
- `dfc:ingest`, `dfc:remember`, `dfc:context`, `dfc:status` run and `dfc:context` emits compact JSON
  with deterministic BM25-ranked excerpts.
- Naming is canonical (`dev-flow-control`, `repo_dev_flow_control`); no secrets are printed or
  committed; `.dfc/surreal.env` is gitignored.

### 15.2 Acceptance B: full memory substrate

- Hybrid BM25 + vector + graph retrieval in one context pack.
- Graph facts and document chunks ingested and queryable.
- Claude hook logs and Codex task summaries imported into `agent_run` / `tool_event`.
- Verification/approval memory imported and surfaced in context packs.
- Full Claude memory skill suite shipped, and the efficiency benchmark run with recorded deltas.

---

## 16. Updated Final Operating Rule

**SurrealDB is the single shared dev-memory backend. Agents reach it only through the repo-local
`pnpm dfc:*` CLI — Claude Code via `/dfc-context`, Codex and future agents via `AGENTS.md`. One
namespace, one database per repo, `repo_id` on every row. BM25 retrieval is live; graph, vector, and
document memory are planned. Graphify/SCIP/Tree-sitter produce facts; SurrealDB stores them. Root
auth bootstraps; scoped credentials run daily. Secrets stay in env or gitignored `.dfc/surreal.env`,
and `DFC_SURREAL_PASS` is never printed or committed. The slice was validated in the Codex fork; the
canonical Claude Code plugin still needs live install/hook validation, and no token-savings claim is
made until the benchmark is run.**
