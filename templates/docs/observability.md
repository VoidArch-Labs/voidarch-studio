# Observability

Observability is a first-class feature, delivered through the logging hooks, the
`observability-report` skill, and optional OpenTelemetry — all real Claude Code mechanisms (there
is no `monitors` plugin component).

## Session-scoped run log

Logs are written **per session** so concurrent or sequential sessions don't collide:

```
.agent-runs/
  sessions/
    <session-id>/
      tools.jsonl          # one JSON event per tool call (log-agent-run, PostToolUse *)
      verification.json    # last verification run (test/lint/typecheck/build)
      graph-scanned.json   # graph scan marker
      read-count           # raw-read counter for the repo-graph nudge
      graph-warned         # nudge-fired marker
      approvals/           # session-scoped scoped approval records
  approvals/               # global scoped approval records
  current.jsonl            # convenience aggregate across sessions
```

If no session id is available, the fallback is `sessions/current-session/`. Add `.agent-runs/` to
your `.gitignore`.

## Per-event log fields

`log-agent-run` fills what a hook can actually observe; the rest are present as empty defaults for
the `observability-report` skill / supervisor to complete:

```json
{
  "timestamp": "", "run_id": "", "session_id": "", "task_id": "", "gsd_phase": "",
  "agent": "", "subagent": "", "skill": "", "tool": "", "mcp_server": "", "mcp_tool": "",
  "command": "", "file": "", "files_read": [], "files_changed": [],
  "graph_used": false, "context7_used": false, "firecrawl_used": false,
  "gitkraken_used": false, "github_mcp_used": false, "jules_used": false,
  "approval_id": "", "approval_required": false, "approval_status": "",
  "result": "", "error": ""
}
```

The `*_used` booleans and `mcp_server`/`mcp_tool` are derived from the tool name. Fields like
`run_id`, `task_id`, `gsd_phase`, `agent`, `files_read/changed`, and `approval_*` are **not**
visible to a PostToolUse hook — the supervisor or `observability-report` skill fills them.

## Hooks are NOT token telemetry

Hooks observe tool calls, not model accounting. **Token and cache metrics are not available to
hooks.** Get them from:

- **Claude Code telemetry** (OpenTelemetry, below),
- the **Session Report** skill,
- the **observability-report** skill's manual summary.

Do not read token/cache numbers from `tools.jsonl` — they are not there, by design.

## OpenTelemetry (optional, local-only default)

Keep telemetry **local** by default; remote endpoints require explicit approval. Example:

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317   # local collector only
```

> Verify the exact env-var names against the current Claude Code monitoring docs before relying on
> them (see `research-gaps.md`). Do not point telemetry at a remote endpoint without approval.

## What to watch

Failures and skipped verification · graph-vs-raw-read ratio · subagent counts · approval events
(scoped approvals consumed) · recap/compact events · rollback state. Token/cache trends come from
telemetry/Session Report, not the hook log.
