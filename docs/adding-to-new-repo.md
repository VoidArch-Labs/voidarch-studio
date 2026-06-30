# Adding dev-flow-control to a New Repo

Use this checklist when installing or validating `dev-flow-control` against a
repository that is not the plugin repo itself.

## Core Rules

- Keep one SurrealDB namespace, but use one database per repo.
- Keep `DFC_REPO_ID` stable and human-readable, usually the repo slug.
- Put real secrets only in the target repo's gitignored `.dfc/*.env` files or in
  process environment variables.
- Never commit `.dfc/surreal.env`, `.dfc/embed.env`, API keys, passwords, or
  Claude launcher env files.
- Run the plugin from its package/cache, but pass the target repo with
  `--repo-root /path/to/repo`.

## Target Repo Files

Create a target repo `.dfc/` directory:

```bash
mkdir -p .dfc
cp /path/to/dev-flow-control/.dfc/surreal.example.env .dfc/surreal.example.env
```

Then create the real, gitignored SurrealDB file:

```bash
cp .dfc/surreal.example.env .dfc/surreal.env
chmod 700 .dfc
chmod 600 .dfc/*.env
```

Set repo-specific identity in `.dfc/surreal.env`:

```dotenv
DFC_SURREAL_NS=dev_flow_control
DFC_SURREAL_DB=repo_my_app
DFC_REPO_ID=my-app
```

Keep connection credentials in the same file or inject them through the process
environment:

```dotenv
DFC_SURREAL_URL=wss://...
DFC_SURREAL_USER=...
DFC_SURREAL_PASS=...
DFC_SURREAL_AUTH_SCOPE=root
```

If live vector search is enabled, put embedding provider values in
`.dfc/embed.env` and keep it gitignored. Do not create it for repos that only use
BM25 docs/files and graph context.

## Git Ignore

Add these patterns to the target repo:

```gitignore
.dfc/*.env
!.dfc/*.example.env
graphify-out/
.agent-runs/
```

Do not ignore `.dfc/*.example.env`; templates are safe to commit and make future
setup easier.

## Config Precedence

When running from an installed plugin against a target repo, config resolves in
this order:

```text
process.env > target .dfc/*.env > plugin .dfc/*.env/templates
```

Target root resolves in this order:

```text
--repo-root > DFC_TARGET_REPO_ROOT > CLAUDE_PROJECT_DIR > PWD > plugin repo
```

Use an explicit `--repo-root` in automation and validation commands so the plugin
cannot accidentally ingest its own package.

## First Validation

From the plugin package or installed plugin cache:

```bash
pnpm dfc:db:check --repo-root /path/to/repo
pnpm dfc:db:migrate --repo-root /path/to/repo
pnpm dfc:docs:ingest --dry-run --repo-root /path/to/repo
pnpm dfc:memory:doctor --repo-root /path/to/repo
```

The DB check must show the target repo's `DFC_REPO_ID` and `DFC_SURREAL_DB`, not
the plugin repo defaults.

## Large Repos and Free-Tier SurrealDB

Small SurrealDB instances are fine for validation, but large repos can overload
them if you import everything in one run. Prefer bounded, resumable writes:

```bash
pnpm dfc:ingest --repo-root /path/to/repo --limit 50
pnpm dfc:docs:ingest --repo-root /path/to/repo --limit 10
```

Re-run the same commands until `limited 0` appears. Keep batch sizes conservative
on Free-tier instances:

```bash
DFC_FILE_WRITE_BATCH_SIZE=1 \
DFC_DOC_CHUNK_BATCH_SIZE=1 \
DFC_DOCUMENT_WRITE_BATCH_SIZE=1 \
pnpm dfc:ingest --repo-root /path/to/repo --limit 50
```

The file and docs ingesters skip generated agent worktrees such as
`.claude/worktrees/`, `.codex/worktrees/`, and `.agent-worktrees/` so context
packs stay focused on the main repo.

## Graph and Vectors

Graph memory needs a local graph first:

```bash
graphify update /path/to/repo
pnpm dfc:graph:status --repo-root /path/to/repo
pnpm dfc:graph:query --dry-run --repo-root /path/to/repo --q "topic"
```

For large repos, verify graph behavior with `--dry-run` before importing graph
rows into SurrealDB. Full graph imports can be much larger than docs/files.

Embeddings are optional and approval-gated. The OpenAI path requires both
`OPENAI_API_KEY` and explicit approval:

```dotenv
DFC_EMBED_PROVIDER=openai
DFC_EMBED_MODEL=text-embedding-3-small
DFC_EMBED_DIMENSION=1536
DFC_EMBED_APPROVED=1
OPENAI_API_KEY=...
```

Use dry-run first:

```bash
pnpm dfc:embed --dry-run --repo-root /path/to/repo --limit 10
```

## Claude Plugin Install Notes

Install the plugin project-scope from the target repo:

```bash
cd /path/to/repo
claude plugin install dev-flow-control@local-dev-flow --scope project
claude plugin details dev-flow-control@local-dev-flow
```

If Claude is already running, restart that Claude process after reinstalling the
plugin or changing launcher environment files. A running process will not
automatically inherit new plugin cache contents or new environment variables.

When a launcher sources secrets for MCP servers, keep it outside the repo or make
the file gitignored and mode `600`. Verify MCP health with the same launcher that
starts Claude:

```bash
claude-career-ops mcp list
```

## Final Smoke Test

Use this minimal sequence before considering a repo wired:

```bash
pnpm dfc:db:check --repo-root /path/to/repo
pnpm dfc:docs:ingest --dry-run --repo-root /path/to/repo
pnpm dfc:ingest --repo-root /path/to/repo --limit 10
pnpm dfc:docs:ingest --repo-root /path/to/repo --limit 3
pnpm dfc:docs:query --repo-root /path/to/repo --q "repo-specific topic" --limit 3
DFC_EMBED_PROVIDER=none pnpm dfc:context --repo-root /path/to/repo --task "repo-specific topic"
pnpm dfc:memory:doctor --repo-root /path/to/repo
pnpm dfc:memory:gc --dry-run --repo-root /path/to/repo
```

The smoke test should prove:

- target DB and repo id are correct
- secrets are not printed or committed
- docs and file rows are written incrementally
- query/context results come from the target repo
- graph/vector channels degrade safely when not imported
- no generated worktree files dominate the context pack
