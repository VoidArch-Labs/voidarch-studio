---
description: Full CRUD over the shared dev memory — memory kinds (decision, evidence, lesson, snippet, repo_fact), task state, and blockers. Use only when explicitly invoked to manage stored memory or task/blocker state.
disable-model-invocation: true
allowed-tools: Bash
---

Manage the shared, agent-neutral dev memory. Interpret the user's request, then run the matching command below with Bash. Always pass `--repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"` and `--agent claude`, and prefix every command with `pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}"`.

## Memory kinds (`dfc:memory`)

Kinds: `decision`, `evidence`, `lesson`, `snippet`, `repo_fact`, plus read-only `context` (context packs).

```bash
# add (snippets can read code from a file and carry --language/--path)
pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:memory add --kind lesson --text "..." [--tags a,b] [--task "goal"] --agent claude --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"
pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:memory add --kind snippet --file path/to/code.ts --language typescript --path src/x.ts --agent claude --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"

# list / search / get
pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:memory list --kind repo_fact [--limit 20] [--json] --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"
pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:memory search --kind decision --query "surrealdb" [--limit 10] --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"
pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:memory get --kind lesson --id lesson:abc123 --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"

# update / delete (ids accepted as table:xyz or bare xyz)
pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:memory update --kind lesson --id lesson:abc123 [--text "..."] [--tags a,b] [--task "goal"] --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"
pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:memory delete --kind lesson --id lesson:abc123 --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"

# context packs are read/delete only (adds happen via /dfc-context)
pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:memory list --kind context --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"
```

## Task state (`dfc:task`)

Statuses: `open`, `in_progress`, `blocked`, `done`. Default list hides done tasks and legacy status-less audit rows; `--all` shows everything.

```bash
pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:task add --goal "..." [--status open] [--tags a,b] --agent claude --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"
pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:task list [--status in_progress] [--all] [--json] --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"
pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:task update --id task:abc --status blocked [--goal "..."] --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"
pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:task done --id task:abc --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"
pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:task get --id task:abc --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"
pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:task delete --id task:abc --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"
```

## Blockers (`dfc:blocker`)

Default list shows open blockers only; `--all` includes resolved ones.

```bash
pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:blocker add --text "..." [--task "goal"] [--session id] [--tags a,b] --agent claude --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"
pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:blocker list [--all] [--json] --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"
pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:blocker resolve --id blocker:abc [--note "how it was fixed"] --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"
pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:blocker get --id blocker:abc --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"
pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:blocker delete --id blocker:abc --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"
```

Notes:
- Quick adds also work via `/dfc-remember` (`dfc:remember --kind <kind> --text "..."`); this skill is the full CRUD path.
- `search` uses BM25 full-text over summary/text with a substring fallback.
- The embedded SurrealKV database is single-process: run commands one at a time, never in parallel.
- Requires SurrealDB config (`.dfc/surreal.env` or `DFC_SURREAL_*`).
