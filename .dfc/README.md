# `.dfc/` - dev-flow-control dev-memory config

This folder holds the hosted SurrealDB 3.1 connection config for the shared,
agent-neutral dev-memory layer (Claude Code, Codex, and future agents). It does
not run a local database.

## Files

- `surreal.example.env` - committed template with placeholder values.
- `surreal.env` - your real values (create this; it is **gitignored**).
- `embed.env` - optional embedding provider values, if live vector search is enabled
  (create this only when needed; it is **gitignored**).

## Setup (hosted SurrealDB Cloud)

1. Create a SurrealDB Cloud instance and copy its WebSocket endpoint
   (`wss://<instance>.surrealdb.cloud`). See https://surrealdb.com/docs/cloud.
2. From the repo root:
   ```bash
   cp .dfc/surreal.example.env .dfc/surreal.env
   # edit .dfc/surreal.env: set URL, USER, PASS (NS/DB/REPO_ID have sane defaults)
   ```
3. Install deps and verify the connection:
   ```bash
   pnpm install
   pnpm dfc:db:check
   pnpm dfc:db:migrate
   ```

## Config precedence

Environment variables **override** `.dfc/surreal.env`, which **overrides**
`.dfc/surreal.example.env`:

```
process.env  >  .dfc/surreal.env  >  .dfc/surreal.example.env
```

When the CLI is run from an installed plugin against another repository, pass
`--repo-root /path/to/repo` or set `DFC_TARGET_REPO_ROOT`. Target repo `.dfc`
files override plugin repo `.dfc` files, while `process.env` still wins:

```
process.env  >  target .dfc/*.env  >  plugin .dfc/*.env/templates
```

| Variable           | Meaning                                  | Default                  |
| ------------------ | ---------------------------------------- | ------------------------ |
| `DFC_SURREAL_URL`  | Hosted endpoint (`wss://...`)            | required                 |
| `DFC_SURREAL_NS`   | Namespace (shared across repos)          | `dev_flow_control`       |
| `DFC_SURREAL_DB`   | Database (one per repo)                  | `repo_dev_flow_control`  |
| `DFC_REPO_ID`      | Logical repo id stored on every row      | `dev-flow-control`       |
| `DFC_SURREAL_USER` | Username                                 | required                 |
| `DFC_SURREAL_PASS` | Password                                 | required                 |
| `DFC_SURREAL_AUTH_SCOPE` | `root`, `namespace`, or `database` | `root`                   |

## One instance, many repos

Keep **one namespace** and use **one database per repo**:

```
DFC_SURREAL_NS=dev_flow_control
DFC_SURREAL_DB=repo_<repo_slug>
DFC_REPO_ID=<repo_slug>
```

See `docs/dev-memory-surreal-first-round.md` for the full design, schema, and
context-pack shape.

## Large repo / Free-tier notes

Hosted Free-tier SurrealDB instances are suitable for validation and incremental
memory refreshes, but not for blasting tens of thousands of rows in one run. Use
bounded, resumable writes:

```bash
pnpm dfc:ingest --repo-root /path/to/repo --limit 50
pnpm dfc:docs:ingest --repo-root /path/to/repo --limit 10
```

`dfc:ingest` skips unchanged file hashes and reports how many changed files were
left limited. Discovery excludes generated agent worktrees (`.claude/worktrees/`,
`.codex/worktrees/`, `.agent-worktrees/`) so context packs rank main-repo files.
