---
description: Drive the local Grok Build CLI (subscription/cached-login mode) for a review, implementation, or diff-review task via the dfc:grok-build wrapper. Use only when explicitly invoked.
disable-model-invocation: true
allowed-tools: Bash
---

Run a Grok Build worker task through the safe wrapper. Grok is an external CLI worker —
**not** a Claude subagent — operating under the same least-privilege rules as Codex/Jules in
[`AGENTS.md`](../../../AGENTS.md): open PRs only, never deploy, never touch secrets, never widen
scope, verify before claiming done.

Run the following via the Bash tool directly (do **not** rely on inline `!` command
substitution for this skill) with an explicit timeout of at least 120000ms. Grok CLI startup
(skill/MCP loading) plus model response routinely takes 10-60+ seconds — well past the short
timeout this plugin's quick status-check skills (`dfc-status`, `dfc-search`, etc.) rely on for
their inline `!` commands, which is built for instant local DB/file checks, not an external LLM
call. Using inline `!` substitution here was the original design and it reliably truncated the
run with `stopReason: "Cancelled"` and empty output, confirmed live on a real host — hence this
explicit Bash-tool instruction instead.

`pnpm` resolves the `dfc:grok-build` script from this plugin's own directory, not the project
being worked on — `cd` there first, then pass `--repo-root` explicitly so Grok still operates on
the actual project (`$CLAUDE_PROJECT_DIR`), not on the plugin's own directory:

```
cd "${CLAUDE_PLUGIN_ROOT}" && pnpm dfc:grok-build --mode review --repo-root "${CLAUDE_PROJECT_DIR}" --task "<task derived from the user's request>"
```

Notes:
- Default mode is **review** (read-only, `--permission-mode auto` — confirmed live to allow
  reads while still declining write attempts; `plan` mode was tried first but blocks/cancels
  read tool calls too in headless operation, not just writes). For `implement`, pass
  `--allow-writes` explicitly — only when the user's request clearly authorized Grok to edit
  files. For `diff-review`, pass `--mode diff-review` instead.
- Spawns `grok` with `XAI_API_KEY` stripped — always subscription/cached-login mode, never
  pay-per-token billing.
- If Grok reports a quota/rate-limit/usage-limit error, a 24h local cooldown is written to
  `.agent-runs/grok/cooldown.json` and subsequent calls fail fast until it expires. Clear it with
  `pnpm dfc:grok-build --clear-cooldown`, or bypass once with `--force`.
- If `grok` is missing or unauthenticated, the wrapper fails cleanly with install/`grok login`
  guidance — it never hangs waiting for interactive input.
- Grok occasionally cancels a turn outright (intermittent, observed live — not fully root-caused
  beyond fixing the most common trigger). The wrapper retries up to twice automatically before
  giving up; the run summary's `retries` field shows how many it took.
- Run summaries land under `.agent-runs/grok/runs/<session>.json` (gitignored, redacted/capped).
  **Always read the summary's `stopReason` and `textPreview` before reporting a result.** Exit
  code `0` means the wrapper subprocess ran cleanly — it does **not** mean Grok finished the
  task. A `Cancelled` stop reason with empty `textPreview` (after retries) means the run was
  genuinely interrupted; report it as incomplete, never present it as a successful answer.
