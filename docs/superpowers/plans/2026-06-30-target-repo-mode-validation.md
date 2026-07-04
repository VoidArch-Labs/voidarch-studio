# Target Repo Mode Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `dev-flow-control` usable as an installed Claude plugin against an external target repository, then validate the canonical plugin memory stack and remote install.

**Architecture:** Keep the plugin package as the execution root while resolving the target repository from `--repo-root`, `DFC_TARGET_REPO_ROOT`, `CLAUDE_PROJECT_DIR`, or cwd. Load target `.dfc/*.env` before plugin `.dfc/*.env`, while keeping process env highest priority for secrets.

**Tech Stack:** TypeScript CLI scripts, pnpm 11, Claude Code plugin skills, hosted SurrealDB, graphify output, OpenAI embeddings.

---

### Task 1: Shared Target Repo Resolution

**Files:**
- Create: `src/memory/cli.ts`
- Modify: `src/memory/surreal.ts`
- Modify: `src/memory/vectors.ts`

- [x] Add CLI arg parsing and `resolveRepoRoot()` precedence: `--repo-root`, `DFC_TARGET_REPO_ROOT`, `CLAUDE_PROJECT_DIR`, `PWD`, plugin `REPO_ROOT`.
- [x] Change `.dfc` file env loading to merge plugin template defaults, plugin real env, target env, then `process.env`.
- [x] Preserve migration schema reads from plugin `REPO_ROOT`.

### Task 2: Thread Target Root Through CLI Scripts

**Files:**
- Modify: `scripts/dfc-*.ts`

- [x] Replace ad hoc `process.env.CLAUDE_PROJECT_DIR || REPO_ROOT` root selection with `repoRootFromArgs(args)`.
- [x] Replace repeated `loadConfig()` calls with one config per script.
- [x] Ensure ingest/docs/graph/import-runs use the target root for filesystem reads.
- [x] Ensure db/migrate/status/context/remember/gc use target config for `repo_id` and database.
- [x] Add bounded/resumable `--limit` support for large target repo file/doc ingestion.
- [x] Exclude generated agent worktrees from file/docs discovery.

### Task 3: Claude Skill Wrapper Portability

**Files:**
- Modify: `.claude/skills/dfc-*.md`

- [x] Run commands from `${CLAUDE_PLUGIN_ROOT:-.}`.
- [x] Pass `--repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"` for every command that can target an external repo.

### Task 4: Docs and Validation

**Files:**
- Modify: `README.md`
- Modify: `.gitignore`
- Add: `pnpm-workspace.yaml`

- [x] Document target-repo mode and env precedence.
- [x] Ensure `.dfc/*.env` stays ignored.
- [x] Add pnpm 11 `allowBuilds` for `esbuild`.
- [x] Run typecheck, hooks, db check/migrate, ingest, docs ingest, graph import/status/query, embeddings, context, status, doctor, and gc dry-run.
- [x] Sync and reinstall remote plugin; verify Claude plugin inventory, MCP health, and dfc DB/status from installed plugin cache.

### Validation Note

Remote `/opt/career-ops` validation used bounded writes because its hosted SurrealDB
instance is Free tier (512 MB RAM, 0.25 vCPU, single node). Full graph/doc/vector
loads should be chunked over several runs or moved to a larger SurrealDB instance.
