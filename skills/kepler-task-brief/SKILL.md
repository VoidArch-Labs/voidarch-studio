---
name: kepler-task-brief
description: This skill should be used when the user asks to "create a Kepler task", "make a task brief", "turn this issue into a task", "prep this for GitKraken/Kepler", or hand structured work to the Kepler/GitKraken worktree and PR surface. Manual-only — it produces a Kepler-ready task brief and does not auto-trigger.
disable-model-invocation: true
---

# Kepler Task Brief

Convert a user request, GitHub issue, or GSD Plan into a Kepler-ready task brief. Kepler/GitKraken
then owns the worktree, branch, session, diff, staging, commit, and PR flow — Claude reviews and
reasons over Git state instead of operating plumbing.

## When to use

Manual only. Use after Discuss/Plan, once work is bounded enough to hand to Kepler. Do not
auto-trigger — Kepler should not become an accidental auto-create pile.

## Procedure

1. Pull goal, affected area, and acceptance criteria from the GSD Plan (or ask if missing).
2. Classify risk and whether an approval gate applies before Ship.
3. Choose the executor route: local subagent vs. Jules async vs. supervised direct edit.
4. Emit the brief below. Hand it to GitKraken/Kepler (or `mcp__GitKraken__*` tools) — do not
   manually run git plumbing unless GitKraken is unavailable.

## Output template

```md
# Kepler Task Brief

Task title:
Repo:
Base branch:
Suggested worktree:
GSD phase:
Goal:
Context:
Affected area:
Executor route:         # local-subagent | jules-async | supervised-direct
Acceptance criteria:
Required verification:   # tests / lint / typecheck / build / CI / security
Risk level:              # low | medium | high
Approval needed:         # yes/no + which gate
Rollback:
Forbidden scope:
```

Keep it tight. The brief is a handoff, not a design doc — link to the Plan rather than copying it.
See `templates/docs/kepler-flow.md` for the full GitKraken/Kepler offload and Automations notes.
