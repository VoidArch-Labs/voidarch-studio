# Jules / agent-cli — notes (no default MCP server)

Jules is an **external async executor**, not a Claude subagent and not a default MCP server in this
plugin's `.mcp.json`. There is intentionally **no auto-enabled Jules server** — starting Jules
sessions is approval-gated.

## Entry points

| Method | Approval | Notes |
|---|---|---|
| GitHub issue label `jules` | preferred | Lowest-friction; subscription-first. |
| `agent-cli` MCP (`mcp__agent-cli__jules_*`) | **required** | `jules_create_session`, `jules_approve_plan`, `jules_watch`, `jules_collect_outputs`. These write/control tools are blocked by `mcp-write-gate.sh` and require a scoped approval. |
| Jules web UI / CLI / REST API | **required** | Manual surfaces; explicit user approval each time. Automated API sessions are NOT a default. |

## If you run the `agent-cli` MCP server

It is typically already provided by the host environment (it also bridges GitHub Copilot). This
plugin does not redefine it. If you add it yourself, keep these gated by `mcp-write-gate.sh`:

```
mcp__agent-cli__jules_create_session
mcp__agent-cli__jules_api_create_session
mcp__agent-cli__jules_approve_plan
mcp__agent-cli__jules_remote_new
mcp__agent-cli__jules_remote_apply
mcp__agent-cli__jules_send_message
mcp__agent-cli__copilot_delegate
mcp__agent-cli__copilot_autopilot
mcp__agent-cli__copilot_fleet
```

## Rules

- Jules opens PRs only — never merges, never deploys.
- Jules must follow `AGENTS.md` (allowed/forbidden scope, run checks, report changed files/risks).
- Never silently substitute Jules for Copilot or vice versa.
- See `templates/docs/jules-flow.md` for the full async flow and reconciliation.
