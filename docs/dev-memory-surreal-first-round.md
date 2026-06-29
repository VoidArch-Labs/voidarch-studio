# Shared Dev Memory On Hosted SurrealDB 3.1

> This is the **first SurrealDB memory slice**, originally built and live-validated in the
> temporary `dev-flow-control-codex` fork and merged back here. The canonical defaults below
> use `dev-flow-control` (not the fork's `*-codex` values). See
> [`dev-flow-control-spec.md`](dev-flow-control-spec.md) for the full architecture and status.

This repo uses one storage solution for agent memory: hosted SurrealDB 3.1.
Codex, Claude Code, and future agents all use the same repo-local CLI commands.

```text
Codex / Claude Code / other agents
  -> pnpm dfc:* commands
  -> hosted SurrealDB namespace/database
  -> per-repo dev-memory schema
  -> compact context-pack JSON
```

## Configure One Database Per Repo

Create `.dfc/surreal.env` from the template:

```bash
cp .dfc/surreal.example.env .dfc/surreal.env
```

Fill in real credentials there or export the same variables in your shell:

```bash
DFC_SURREAL_URL=wss://<surrealdb-cloud-endpoint>
DFC_SURREAL_NS=dev_flow_control
DFC_SURREAL_DB=repo_dev_flow_control
DFC_REPO_ID=dev-flow-control
DFC_SURREAL_USER=<username>
DFC_SURREAL_PASS=<password>
DFC_SURREAL_AUTH_SCOPE=root
```

Environment variables override `.dfc/surreal.env`, which overrides
`.dfc/surreal.example.env`.

Use `DFC_SURREAL_AUTH_SCOPE=root` for first-run migration because the migration
creates the namespace and database when they do not exist yet. Namespace or
database users can be used after the namespace/database has been created and
granted appropriate permissions.

## Install And Verify

```bash
pnpm install
pnpm exec tsc --noEmit
pnpm dfc:db:check
pnpm dfc:db:migrate
pnpm dfc:ingest --agent codex
pnpm dfc:status
```

`surrealdb` is the official JavaScript SDK package used by the CLI. The hosted
database target is SurrealDB 3.1; the npm SDK version should remain the latest
published official client unless SurrealDB publishes a newer JS SDK package.

## Remember Decisions And Evidence

```bash
pnpm dfc:remember --kind decision --text "Use hosted SurrealDB as the shared dev-memory database." --agent codex
pnpm dfc:remember --kind evidence --text "Claude and Codex share the same per-repo DB through env config." --agent claude
```

If `--agent` is omitted, the source agent is `manual`. Supported values:

```text
manual
codex
claude
```

## Generate A Context Pack

```bash
pnpm dfc:context --task "Add approval logging" --agent codex
```

The command prints compact JSON only:

```json
{"task":{"goal":"","phase":"plan"},"repo_context":{"files":[]},"memory_context":{"decisions":[],"evidence":[]},"verification":{"last_failures":[]},"workflow":{"approval_required":[],"approval_available":[]},"agent_context":{"recent_runs":[],"recent_tool_events":[]},"token_budget":{"target_tokens":2500,"estimated_tokens":0,"dropped_items":[]}}
```

Scoring is deterministic:

- exact path match
- filename match
- full-text match
- recent decision/evidence boost
- risk keyword boost
- agent-run relevance boost
- large content penalty

The pack includes short excerpts only. It does not dump full file contents.

## Schema

Core tables are defined in `schema/0001_core.surql`:

```text
repo
file
doc_chunk
decision
evidence_item
task
context_pack
verification_run
approval
agent_run
tool_event
```

Full-text indexes are defined in `schema/0002_indexes.surql` with current
SurrealQL `FULLTEXT ANALYZER ... BM25` syntax for:

```text
file.content
doc_chunk.text
decision.summary
evidence_item.summary
task.goal
context_pack.goal
verification_run.summary
```

Every shared-memory row should carry `repo_id`; rows produced by agents should
also carry `source_agent` as `manual`, `codex`, or `claude`.

## Codex Usage

Codex reads `AGENTS.md`. Before broad repo exploration:

```bash
pnpm dfc:context --task "<task goal>" --agent codex
```

Codex should persist durable facts through:

```bash
pnpm dfc:remember --kind decision --text "..." --agent codex
pnpm dfc:remember --kind evidence --text "..." --agent codex
```

## Claude Code Usage

Claude compatibility is intentionally thin. `.claude/skills/dfc-context/SKILL.md`
defines `/dfc-context`, and that skill calls:

```bash
pnpm dfc:context --task "$ARGUMENTS" --agent claude
```

Claude and Codex therefore read the same context-pack JSON from the same hosted
SurrealDB database.

## Live DB Validation

Run these after credentials are configured:

```bash
pnpm dfc:db:check
pnpm dfc:db:migrate
pnpm dfc:ingest --agent codex
pnpm dfc:remember --kind decision --text "Codex and Claude share the same per-repo SurrealDB dev-memory database." --agent codex
pnpm dfc:context --task "Finish approval logging" --agent codex
pnpm dfc:status
```
