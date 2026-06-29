---
name: dev-flow-routing
description: This skill should be used at the start of a non-trivial or multi-step development task, or when the user asks "what phase am I in", "how should I approach this", "route this work", "which agent should handle this", or mentions the dev-flow-control supervisor workflow. It maps each GSD phase (Discuss, Plan, Execute, Verify, Ship) to the right skills, subagents, tools, and approval gates so Claude supervises while specialized tools operate.
disable-model-invocation: false
---

# Dev Flow Routing

Route development work through GSD phases. Claude supervises and reasons; specialized tools
operate. This skill is a thin routing layer — it points at other skills, agents, and tools
rather than duplicating their contents.

## Core operating rule

- GSD controls phases. Karpathy rules constrain coding behavior.
- Kepler/GitKraken owns Git and workflow state.
- A repo graph (graphify) owns repo-structure discovery before broad file reads.
- Claude controls reasoning and supervision; subagents execute bounded local work.
- Jules executes async GitHub PR work. Context7 provides current docs. Firecrawl is gated.
- Hooks enforce safety. Observability records what happened. The user approves irreversible actions.

Do not load every tool into every session. Expose only the current phase's tools.

## Phase routing

### Discuss — clarify intent, value, architecture, risk
- Skills: `product-management` (vague product intent, specs, value), `engineering` (architecture, ADRs, tradeoffs).
- Behavior: apply Karpathy constraints — think first, state assumptions, smallest change, no premature code.
- Output: a bounded problem statement and success criteria.

### Plan — locate, design, gather current facts
- Repo discovery FIRST: invoke `graph-context-scan` (wraps the graphify skill) before raw reads.
- Subagents: `repo-explorer` (read-only locate), `graph-navigator` (dependencies / impact radius).
- Planning: the `planner` agent converts Discuss output into a bounded plan with verification + gates.
- Docs: the `docs-researcher` agent + Context7 for version-sensitive library/API facts only.
- External web: `firecrawl-research` only if needed (manual, gated).

### Execute — make the smallest working change
- Local: `implementation-worker` (scoped edits, tests), `test-debugger` (narrow fixes).
- Async branchable GitHub tasks: `jules-handoff` (manual, approval-gated) → Jules opens a PR.
- Surface-specific: `frontend-design`, `data`, `mcp-server-dev` only when the task is that surface.
- Git state: hand task/worktree/branch/diff/commit/PR to Kepler/GitKraken — see `kepler-task-brief`.

### Verify — prove correctness before shipping
- Agents: `pr-reviewer`, `security-reviewer`; skill: `pr-review-toolkit`.
- Deterministic checks: tests, lint, typecheck, build, CI, browser tests, security scans.
- Diff review through Kepler/GitKraken rather than Claude guessing Git state.
- The `require-verification-before-ship` hook warns if files changed with no verification.

### Ship — summarize, gate, integrate
- Skills: `session-report` / `observability-report` for the run summary.
- `approval-request` before any irreversible or external action.
- Kepler/GitKraken handles stage/commit/PR flow. The `release-checker` agent confirms Ship readiness.
- `project-artifact` only for milestones.

## Real tool wiring (this environment)

These integrations are installed here; routing targets them directly, with fallbacks:
- Repo graph → `graphify` skill. Fallback: Grep/Glob + `repo-explorer`.
- Git state → GitKraken MCP (`mcp__GitKraken__*`). Fallback: minimal read-only `git` facts.
- Async executor → Jules via the `agent-cli` MCP (`mcp__agent-cli__jules_*`). Fallback: GitHub issue label `jules`.
- Docs → Context7 (`mcp__context7__*`). Web → Firecrawl (`mcp__firecrawl__*`, gated).
- GSD phases → the installed `gsd-*` skills.

On another machine these may be absent — keep references generic and degrade gracefully.

## Skill visibility

- Manual-only (`disable-model-invocation: true`): `kepler-task-brief`, `jules-handoff`, `firecrawl-research`.
- Auto-invocable (`false`): `dev-flow-routing`, `graph-context-scan`, `observability-report`, `approval-request`.

See `templates/docs/gsd-skill-routing.md` for the full routing matrix and Anthropic-skill overrides.
