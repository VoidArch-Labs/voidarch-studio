# AGENTS.md

This repository is agent-neutral. Codex, Claude Code, and future agents use the same repo-local CLI commands for dev memory.

## Shared Dev Memory

- Storage: hosted SurrealDB 3.1 is the primary dev-memory database.
- Scope: one namespace can serve many repos; use one database per repo.
- This repo defaults to:
  - `DFC_SURREAL_NS=dev_flow_control`
  - `DFC_SURREAL_DB=repo_dev_flow_control_codex`
  - `DFC_REPO_ID=dev-flow-control-codex`
- Secrets must come from environment variables or `.dfc/surreal.env`; never commit real credentials.
- The common interface is npm scripts, not agent-specific tooling.

## Context First

Before broad repo reads, get a task-specific context pack:

```bash
pnpm dfc:context --task "<task goal>" --agent codex
```

Use the returned JSON to inspect the listed files and memories first. Do not treat an empty context pack as proof that no relevant code exists.

## Commands

```bash
pnpm dfc:db:check
pnpm dfc:db:migrate
pnpm dfc:ingest --agent codex
pnpm dfc:remember --kind decision --text "..." --agent codex
pnpm dfc:remember --kind evidence --text "..." --agent codex
pnpm dfc:context --task "..." --agent codex
pnpm dfc:status
```

If `--agent` is omitted, commands default to `manual`. Supported values are `manual`, `codex`, and `claude`.

## Codex

Codex compatibility lives here and in `package.json` scripts. Codex should call `pnpm dfc:context` before large discovery work and write durable decisions/evidence through `pnpm dfc:remember`.

## Claude Code

Claude compatibility lives in `.claude/skills/dfc-context/SKILL.md`. The `/dfc-context` skill calls the same `pnpm dfc:context` command and reads the same SurrealDB database as Codex.
