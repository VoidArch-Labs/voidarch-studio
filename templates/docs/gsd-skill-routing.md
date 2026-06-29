# GSD Skill Routing

GSD is the workflow spine. Each phase exposes only the tools it needs. The `dev-flow-routing` skill
is the in-session summary; this doc is the full matrix.

## Phase → components

| Phase | Skills | Agents | Tools / MCP | Gates |
|---|---|---|---|---|
| **Discuss** | product-management, engineering | — | — | state assumptions; Karpathy constraints |
| **Plan** | graph-context-scan, dev-flow-routing | repo-explorer, graph-navigator, planner, docs-researcher | graphify, Context7, Firecrawl (gated) | repo-graph before broad reads |
| **Execute** | kepler-task-brief, jules-handoff | implementation-worker, test-debugger | GitKraken MCP, agent-cli (Jules) | jules-handoff approval; protected-file / dangerous-shell hooks |
| **Verify** | pr-review-toolkit | pr-reviewer, security-reviewer | tests/lint/typecheck/build/CI; GitKraken diff | require-verification-before-ship |
| **Ship** | session-report, observability-report, approval-request | release-checker | GitKraken stage/commit/PR | approval-request before irreversible/external actions |

Surface-specific skills (`frontend-design`, `data`, `mcp-server-dev`) load only when the task is
that surface. `project-artifact` is milestone-only. `playground` is prototype-only.

## Anthropic-skill visibility overrides

Set these in your **own** `.claude/settings.json` (a plugin cannot apply them to your session):

```json
{
  "skillOverrides": {
    "product-management": "on",
    "engineering": "on",
    "pr-review-toolkit": "on",
    "session-report": "on",
    "design": "name-only",
    "frontend-design": "name-only",
    "data": "user-invocable-only",
    "mcp-server-dev": "user-invocable-only",
    "mcp-tunnels": "user-invocable-only",
    "plugin-dev": "user-invocable-only",
    "playground": "user-invocable-only",
    "project-artifact": "user-invocable-only",
    "hookify": "user-invocable-only"
  }
}
```

- **on** — auto-invocable.
- **name-only** — Claude sees the name/description and may select it, but the body loads only when chosen.
- **user-invocable-only** — manual; never auto-loaded.

## This plugin's own skills

Set via `disable-model-invocation` in each SKILL.md: auto (`false`) for `dev-flow-routing`,
`graph-context-scan`, `observability-report`, `approval-request`; manual (`true`) for
`kepler-task-brief`, `jules-handoff`, `firecrawl-research`.

## Principle

Everything useful is installed/available; only the current phase's tools are visible or loaded.
Expensive, risky, or rare skills stay manual.
