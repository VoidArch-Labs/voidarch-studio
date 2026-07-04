---
description: Start the per-repo dev-flow-control dashboard (local web UI with plugin health, sessions, dev-memory, and repo graph). Use only when explicitly invoked.
disable-model-invocation: true
allowed-tools: Bash
---

Start the dashboard server for the active project in the background:

!`nohup pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:dashboard --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}" $ARGUMENTS >/tmp/dfc-dashboard.log 2>&1 & sleep 1; head -3 /tmp/dfc-dashboard.log`

Then:
- report the URL it printed (default `http://127.0.0.1:4949`; override with `--port <n>`)
- tell the user the four tabs: Overview (health checks), Development (dev-memory:
  tasks/blockers/memories/metrics, approvals), Sessions (.agent-runs observability), Graph (graphify)
- the server is local-only (binds 127.0.0.1) and read-only; stop it with
  `kill $(lsof -ti :4949)` or by closing the terminal
- if the port is already in use, the previous dashboard is probably still running —
  just report the URL
