# Jules Flow

Jules is an **external async executor** that returns a branch/PR. It is not a Claude subagent — do
not treat it as one.

## Entry points

| Method | Approval | Notes |
|---|---|---|
| GitHub issue label `jules` | preferred | Lowest-friction; Jules picks up labeled issues. |
| `agent-cli` MCP (`mcp__agent-cli__jules_*`) | required | `jules_create_session`, `jules_approve_plan`, `jules_watch`, `jules_collect_outputs`. Gated by `mcp-write-gate`. |
| Jules web UI / CLI / REST API | required | Manual surfaces; explicit user approval each time. |

Subscription-first: automated Jules **API** sessions are not a default — they require explicit approval.

## The flow

```
GSD Plan
  → jules-handoff skill builds a bounded task packet (manual)
  → approval-request for the launch itself
  → create via issue label `jules`  OR  agent-cli jules tools
  → Jules works async on a branch, opens a PR (never merges, never deploys)
  → PR returns through: Kepler/GitKraken review → pr-reviewer agent → human approval
```

## Task packet must specify

Repo · base branch · task type · goal · context from the Plan · **allowed scope** · **forbidden
scope** · implementation constraints · verification commands · expected output · stop conditions.

## Jules must

Open PRs only · never merge · never deploy · follow `AGENTS.md` · respect allowed/forbidden scope ·
run the specified checks · report changed files, tests, and risks.

## Reconciliation

When Jules returns a PR, reconcile it back into the local plan: confirm it matches the packet's
scope, run `pr-reviewer` and `security-reviewer`, and only then route to human approval for merge.
Record formal deviations (e.g. executor substitutions) rather than silently swapping executors.

## Copilot note

The `agent-cli` bridge also exposes GitHub Copilot delegation (`copilot_delegate`, `copilot_fleet`).
These are likewise gated by `mcp-write-gate` and require approval — keep Jules and Copilot distinct;
never silently substitute one for the other.
