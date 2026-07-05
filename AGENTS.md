# AGENTS.md

This repository is the canonical **Claude Code plugin** `dev-flow-control`, housing two products: **Nox** (repo memory/query engine — the `pnpm dfc:*` CLI below) and **Nox Studio** (the `pnpm dfc:dashboard` agent control room). Boundary and MVP spec: `docs/mvp/nox-and-nox-studio-mvp.md`. **Claude Code is the canonical local supervisor**; Codex and future agents use the same repo-local `dfc` CLI commands for dev memory. The memory layer itself is agent-neutral — every agent reads and writes the same per-repo SurrealDB database. The canonical command surface is `pnpm dfc:*` (TypeScript/tsx); the only Rust piece is the external optional `graphify-surreal` binary behind `pnpm dfc:graph:build`.

## Shared Dev Memory

- Storage: embedded SurrealDB (SurrealKV) at `.dfc/dev-memory/` is the default — zero config, no credentials. A hosted SurrealDB instance is optional for shared multi-machine memory. The embedded database is single-process: never run two `dfc` commands concurrently against it.
- Scope: one namespace can serve many repos; use one database per repo.
- This repo defaults to:
  - `DFC_SURREAL_NS=dev_flow_control`
  - `DFC_SURREAL_DB=repo_dev_flow_control`
  - `DFC_REPO_ID=dev-flow-control`
- Secrets must come from environment variables or `.dfc/surreal.env`; never commit real credentials.
- The common interface is npm scripts, not agent-specific tooling.

## Context First

Before broad repo reads, get a task-specific context pack:

```bash
pnpm dfc:context --task "<task goal>" --agent codex
```

Use the returned JSON to inspect the listed files and memories first. Context packs include a `state` section with open tasks and open blockers. Do not treat an empty context pack as proof that no relevant code exists.

## Commands

Core memory:

```bash
pnpm dfc:db:check
pnpm dfc:db:migrate            # applies schema 0001 + 0002 + 0003 + 0004
pnpm dfc:ingest --agent codex
pnpm dfc:remember --kind <decision|evidence|lesson|snippet|repo_fact> --text "..." --agent codex
pnpm dfc:context --task "..." --agent codex
pnpm dfc:status
```

Memory CRUD and task/blocker state:

```bash
pnpm dfc:memory <add|list|search|get|update|delete> --kind <decision|evidence|lesson|snippet|repo_fact>
pnpm dfc:task <add|list|update|done|get|delete>     # statuses: open|in_progress|blocked|done
pnpm dfc:blocker <add|list|resolve|get|delete>
pnpm dfc:metrics [--days 30] [--json]               # memory/run metrics summary
```

Document / graph / vector channels (each supports `--dry-run` with no credentials):

```bash
pnpm dfc:docs:ingest --agent codex        # heading-chunk markdown into doc_chunk
pnpm dfc:docs:query --q "..."             # BM25 over document chunks
pnpm dfc:graph:import --agent codex        # load graphify-out/graph.json (run /graphify first)
pnpm dfc:graph:query --q "..."            # rank graph nodes + neighborhood
pnpm dfc:graph:status                      # graph freshness vs current HEAD
pnpm dfc:embed --dry-run                   # vector scaffolding (approval-gated; see below)
pnpm dfc:memory:doctor                     # cross-channel health (resilient w/o DB)
pnpm dfc:memory:gc --dry-run               # prune orphan/mismatched embeddings
```

If `--agent` is omitted, commands default to `manual`. Supported values are `manual`, `codex`, and `claude`.

**Vectors are approval-gated.** `dfc:embed` requires an explicit `DFC_EMBED_PROVIDER`
(`ollama` local/free, or `openai`). The `openai` path additionally requires `OPENAI_API_KEY`
**and** approval (`DFC_EMBED_APPROVED=1` or `--approve`). Never call a paid embedding API silently.

## Codex

Codex compatibility lives here and in `package.json` scripts. Codex should call `pnpm dfc:context` before large discovery work and write durable memories (decisions, evidence, lessons, snippets, repo facts) through `pnpm dfc:remember`.

## Grok Build

Grok Build is a **manual** external worker, driven via `pnpm dfc:grok-build` (and the
`/dfc-grok-build` Claude skill, and the `grok-build-worker` agent) — never auto-invoked. It runs
the local `grok` CLI in subscription/cached-login mode (`XAI_API_KEY` is stripped from its
environment by the wrapper, so it never bills pay-per-token). A 24h local cooldown
(`.agent-runs/grok/cooldown.json`) kicks in automatically when Grok reports a
quota/rate-limit/usage-limit error; clear it with `--clear-cooldown` or bypass once with
`--force`. `implement` mode requires explicit `--allow-writes`. See
`skills/dfc-grok-build/SKILL.md` and `agents/grok-build-worker.md`.

## Claude Code

Claude compatibility lives in the plugin's `skills/` directory (bundled, so any repo that
loads the plugin gets them). Manual-invoke skills wrap the same `pnpm dfc:*` commands and
read/write the same SurrealDB database as Codex: `/dfc-context`, `/dfc-remember`,
`/dfc-memory`, `/dfc-search`, `/dfc-status`, `/dfc-ingest`, `/dfc-session-recap`, `/dfc-graph`,
`/dfc-grok-build`, `/dfc-init`, and `/dfc-dashboard`. They are thin wrappers — the CLI is
the contract.

## External agent rules

External executors (Codex, Jules, Grok Build, future agents) operate under least privilege:

- **Open PRs only** unless explicitly told otherwise — never push to protected branches.
- **Never deploy.**
- **Never edit secrets** (`.dfc/surreal.env`, `.env`, keys, tokens) and never print or echo `DFC_SURREAL_PASS`.
- **Never change billing, model, or provider routes** (API gateways, `ANTHROPIC_BASE_URL`, Bedrock/Vertex/OpenRouter, paid modes).
- **Never widen scope silently** — stay within the assigned task.
- **Run verification before claiming done** (`pnpm exec tsc --noEmit`, plus task-specific checks).
- **Report** files changed, checks run, failures, and risks.
