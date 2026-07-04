---
description: Scaffold the current repository for dev-flow-control (per-repo .dfc env templates, .gitignore entries, optional CLAUDE.md/AGENTS.md). Use only when explicitly invoked to set up a new repo.
disable-model-invocation: true
allowed-tools: Bash
---

Scaffold the active project for dev-flow-control:

!`pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:init --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}" $ARGUMENTS`

Then report to the user:
- what was created vs skipped (the command prints `+` created / `=` skipped lines)
- the printed next steps (credentials, db:check, db:migrate, ingest, dashboard)
- pass-through flags they may want: `--repo-id <slug>`, `--copy-credentials`
  (reuses the plugin's SurrealDB instance with a per-repo database), `--claude-md`,
  `--agents-md`, `--force`

Do not create `.dfc/surreal.env` yourself and never print credential values.
