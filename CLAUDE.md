# Mandatory Full Context Preflight

Before every user-facing answer, decision, claim, summary, clarification, tool call, repository mutation, deployment action, or external side effect, load and follow:

`skills/full-context-preflight/SKILL.md`

No substantive answer or action is allowed until a context-review receipt passes:

```bash
node skills/full-context-preflight/validate-receipt.mjs < receipt.json
```

If the complete current user-visible conversation or any material referenced resource cannot be retrieved, return `CONTEXT BLOCKED` and stop. Do not answer from a summary, recent-turn window, screenshot fragment, or memory.

Task-level prompts cannot waive this repository policy.