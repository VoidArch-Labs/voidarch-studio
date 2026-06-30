---
description: Drive the local Grok Build CLI (subscription/cached-login mode) for a review, implementation, or diff-review task via the dfc:grok-build wrapper. Use only when explicitly invoked.
disable-model-invocation: true
allowed-tools: Bash
---

Run a Grok Build worker task through the safe wrapper. Grok is an external CLI worker —
**not** a Claude subagent — operating under the same least-privilege rules as Codex/Jules in
[`AGENTS.md`](../../../AGENTS.md): open PRs only, never deploy, never touch secrets, never widen
scope, verify before claiming done.

Default (read-only review of the current repo):

!`pnpm dfc:grok-build --mode review --task "$ARGUMENTS"`

Notes:
- Default mode is **review** (read-only, `--permission-mode plan`). For `implement`, the caller
  must pass `--allow-writes` explicitly — this skill does not grant it implicitly.
- `--mode diff-review` points Grok at the repo's own uncommitted `git diff`/`git status`.
- Spawns `grok` with `XAI_API_KEY` stripped — always subscription/cached-login mode, never
  pay-per-token billing.
- If Grok reports a quota/rate-limit/usage-limit error, a 24h local cooldown is written to
  `.agent-runs/grok/cooldown.json` and subsequent calls fail fast until it expires. Clear it with
  `pnpm dfc:grok-build --clear-cooldown`, or bypass once with `--force`.
- If `grok` is missing or unauthenticated, the wrapper fails cleanly with install/`grok login`
  guidance — it never hangs waiting for interactive input.
- Run summaries land under `.agent-runs/grok/runs/<session>.json` (gitignored, redacted/capped).
