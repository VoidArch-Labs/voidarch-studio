---
name: jules-handoff
description: This skill should be used when the user asks to "hand this to Jules", "create a Jules task", "delegate this async", or route a branchable GitHub task to an external async executor. Manual-only and approval-gated — it produces a bounded Jules task packet and never launches Jules automatically.
disable-model-invocation: true
---

# Jules Handoff

Convert a GSD Plan into a bounded Jules task packet. Jules is an external async executor that
returns a branch/PR. It is NOT a Claude subagent — do not treat it as one.

## Rules

- Do not launch Jules automatically. Launching requires explicit user approval.
- Preferred entry: a GitHub issue labeled `jules`.
- With approval, Jules may be driven via the `agent-cli` MCP: `mcp__agent-cli__jules_create_session`,
  `jules_approve_plan`, `jules_watch`, `jules_collect_outputs`. The `mcp-write-gate` hook gates these.
- The task must be branchable. Jules opens a PR only — never merges, never deploys.
- Jules must follow `AGENTS.md`: respect allowed/forbidden scope, run specified checks, and report
  changed files, tests, and risks.

## Procedure

1. Confirm the task is isolated, branchable, and well-scoped.
2. Draft the packet below from the GSD Plan.
3. Present it for approval (use `approval-request` for the launch itself).
4. On approval: create via the issue label `jules`, or call the `agent-cli` jules tools.
5. Return output through GitHub PR → Kepler/GitKraken review → `pr-reviewer` agent → human approval.

## Output template

```md
# Jules Task Packet

Repo:
Base branch:
Task type:

## Goal

## Context from GSD Plan

## Allowed scope

## Forbidden scope

## Implementation constraints

## Verification commands

## Expected output

## Stop conditions
```

See `templates/docs/jules-flow.md` for the full async flow and how Jules output reconciles back
into the local plan.
