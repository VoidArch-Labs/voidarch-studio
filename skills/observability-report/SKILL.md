---
name: observability-report
description: This skill should be used when the user asks for a "session report", "observability report", "run summary", "what happened this session", or "token/tool usage", or at the end of a GSD Ship phase. It summarizes run state — tools, subagents, files, commands, checks, approvals, and efficiency/accuracy notes.
disable-model-invocation: false
---

# Observability Report

Summarize run/session state for auditability and efficiency tracking. Pull from
`.agent-runs/current.jsonl` (written by the logging hooks) plus the live session.

## Procedure

1. Read `.agent-runs/current.jsonl` if present — one JSON object per logged event. If absent,
   report from the live session only and note that hook logs were unavailable.
2. Aggregate by run/task: which agents, skills, tools/MCP ran; files read/changed; commands;
   checks; approvals; graph / Context7 / Firecrawl / GitKraken / Jules usage; recap/compact events.
3. Note token/cache indicators and any failures or skipped verification.
4. Emit the report below. Keep it factual and compact.

## Output template

```md
# Observability Report

Run ID:                  Task ID:
Repo:                    Branch/worktree:
Kepler task:             GitHub issue/PR:
GSD phase:               Model:             Effort:
Subagents:
Skills loaded:
Tools/MCP:
Graph/index usage:       Context7 usage:     Firecrawl usage:
GitKraken/Kepler actions:                    Jules actions:
Files read:              Files changed:
Commands run:            Tests/checks:
Failures:                Approvals:
Token/cache indicators:
Recap/compact events:    Rollback:
Efficiency notes:
Accuracy notes:
```

For cross-session telemetry, see `templates/docs/observability.md` (OpenTelemetry env config,
local-only by default; remote endpoints require approval).
