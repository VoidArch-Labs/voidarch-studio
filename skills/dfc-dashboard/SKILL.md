---
description: Start the Voidarch Studio dashboard (per-repo agent control room — agents, workflows, code map, memory, metrics, tokens, Mercury assistant). Use only when explicitly invoked.
disable-model-invocation: true
allowed-tools: Bash
---

Start the dashboard server for the active project in the background:

!`nohup pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:dashboard --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}" $ARGUMENTS >/tmp/dfc-dashboard.log 2>&1 & sleep 1; head -3 /tmp/dfc-dashboard.log`

Then:
- report the URL it printed (default `http://127.0.0.1:4949`; override with `--port <n>`)
- tell the user it is the Voidarch Studio control room: Control Room (live agents + needs-attention),
  Agents (deploy headless `claude -p` runs, session history), Workflows, Code Map
  (interactive graph), Memory, Metrics, Token Usage, Sync, Observability, Health, and the
  Mercury assistant drawer (needs `MERCURY_API_KEY` in `.dfc/mercury.env`)
- the server is local-only (binds 127.0.0.1); the only write surface is deploying
  agents from the Agents panel; stop it with `kill $(lsof -ti :4949)` or by closing the terminal
- if the port is already in use, the previous dashboard is probably still running —
  just report the URL
