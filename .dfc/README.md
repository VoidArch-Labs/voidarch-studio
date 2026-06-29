# `.dfc/` - dev-flow-control-codex dev-memory config

This folder holds the hosted SurrealDB 3.1 connection config for the shared
Codex/Claude dev-memory layer. It does not run a local database.

## Files

- `surreal.example.env` - committed template with placeholder values.
- `surreal.env` - your real values (create this; it is **gitignored**).

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

| Variable           | Meaning                                  | Default                  |
| ------------------ | ---------------------------------------- | ------------------------ |
| `DFC_SURREAL_URL`  | Hosted endpoint (`wss://...`)            | required                 |
| `DFC_SURREAL_NS`   | Namespace (shared across repos)          | `dev_flow_control`       |
| `DFC_SURREAL_DB`   | Database (one per repo)                  | `repo_dev_flow_control_codex` |
| `DFC_REPO_ID`      | Logical repo id stored on every row      | `dev-flow-control-codex` |
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
