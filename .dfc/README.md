# `.dfc/` - dev-flow-control dev-memory config

This folder holds the hosted SurrealDB 3.1 connection config for the shared,
agent-neutral dev-memory layer (Claude Code, Codex, and future agents). It does
not run a local database.

## Files

- `surreal.example.env` - committed template with placeholder values.
- `surreal.env` - your real values (create this; it is **gitignored**).
- `embed.example.env` - committed OpenAI embedding template with placeholders.
- `embed.env` - your real embedding values and API key (create this; it is **gitignored**).

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
| `DFC_SURREAL_DB`   | Database (one per repo)                  | `repo_dev_flow_control`  |
| `DFC_REPO_ID`      | Logical repo id stored on every row      | `dev-flow-control`       |
| `DFC_SURREAL_USER` | Username                                 | required                 |
| `DFC_SURREAL_PASS` | Password                                 | required                 |
| `DFC_SURREAL_AUTH_SCOPE` | `root`, `namespace`, or `database` | `root`                   |

Embedding config uses separate precedence so API keys stay local:

```
process.env  >  .dfc/embed.env  >  defaults
```

| Variable              | Meaning                                  | Default                  |
| --------------------- | ---------------------------------------- | ------------------------ |
| `DFC_EMBED_PROVIDER`  | `none`, `ollama`, or `openai`            | `none`                   |
| `DFC_EMBED_MODEL`     | Provider model id                        | `text-embedding-3-small` for OpenAI |
| `DFC_EMBED_DIMENSION` | Requested/expected vector dimensions     | infer from first vector  |
| `DFC_EMBED_APPROVED`  | Set `1` to approve paid OpenAI requests  | unset                    |
| `OPENAI_API_KEY`      | OpenAI API key for local embedding runs  | required for OpenAI      |

## One instance, many repos

Keep **one namespace** and use **one database per repo**:

```
DFC_SURREAL_NS=dev_flow_control
DFC_SURREAL_DB=repo_<repo_slug>
DFC_REPO_ID=<repo_slug>
```

See `docs/dev-memory-surreal-first-round.md` for the full design, schema, and
context-pack shape.
