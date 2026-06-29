---
name: approval-request
description: This skill should be used before any irreversible or external action, or when the user asks to "deploy", "merge", "ship this", "push to main", "send it", or "get approval" — covering deploy, merge, push to a protected branch, write to production data, send messages, purchase, post publicly, expose secrets, change billing/model/provider routes, enable paid modes, or start a Jules API session. It produces a standard approval request with action, risk, diff/payload preview, and rollback.
disable-model-invocation: false
---

# Approval Request

Produce a standard human approval request before any irreversible or external side effect.
Autonomy stops here: present the request and wait for explicit approval.

## When required

deploy to production · merge PRs · push protected branches · write production data ·
access/expose secrets · send emails/messages · submit forms/applications · purchases/payments ·
public posts · change billing/model/provider routes · change security settings ·
run destructive shell commands · enable paid Firecrawl/API modes · start Jules API sessions.

These are also enforced deterministically by the `block-dangerous-shell`, `block-protected-files`,
and `mcp-write-gate` hooks — this skill is the human-readable gate that accompanies them. The hooks
**fail closed** on malformed payloads.

To actually authorize a gated action after approval, the user records a **scoped approval** — a JSON
file under `.agent-runs/approvals/` (or `.agent-runs/sessions/<id>/approvals/`) whose `tool_pattern`
matches the specific tool/command, with `expires_at` and `single_use`. See
`templates/approval.example.json` and `templates/docs/approval-gates.md`. Do not rely on the
deprecated broad flags.

## Output template

```md
# Approval Request

Action:
Why needed:
Affected files/systems:
Diff/payload preview:
External side effects:
Billing/cost impact:
Security impact:
Rollback:
Alternatives:
Recommendation:
```

Fill every field. If a field is "none", say so explicitly — silence is not consent.
See `templates/docs/approval-gates.md` for the full gate list and the present-before-approval checklist.
