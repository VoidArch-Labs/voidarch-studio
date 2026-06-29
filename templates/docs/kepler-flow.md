# Kepler / GitKraken Flow

GitKraken/Kepler owns Git and workflow state so Claude doesn't burn tokens operating plumbing.

## GitKraken/Kepler handles

task creation · issue/PR entry · worktree creation · branch creation · session tracking · agent
status · diff visibility · file staging · commit creation · PR creation/draft · the Launchpad review
queue · Automations (labels/reviewers/checklists/risk flags) · cleanup.

## Claude should NOT routinely run

`git status` · `git branch` · `git log` · `git diff --stat` · `git diff` · `git add` · `git commit`
· `gh pr create` · `gh pr checks`.

Prefer GitKraken MCP (`mcp__GitKraken__*`) for structured Git state and diffs.

## GitKraken owns workflow state — but writes still need approval

GitKraken/Kepler owns Git workflow state, **but write-like GitKraken actions still require
approval.** The `mcp-write-gate` hook gates write-like GitKraken/Kepler MCP tools (commit, push,
merge, create_pr/open_pr, stage, discard, reset, cleanup, work_end, checkout, stash, worktree,
resolve, ...), and `block-dangerous-shell` gates write-like `gk` CLI commands. Read-only GitKraken
tools (status, branch graph, log, diff, blame, list) stay allowed. To authorize a specific write,
add a scoped approval record under `.agent-runs/approvals/` whose `tool_pattern` matches the tool
(see `approval-gates.md`). This keeps the "GitKraken removes Git toil from Claude" benefit without
handing it unreviewed write authority.

**Allowed exceptions:** GitKraken unavailable · a tiny read-only Git fact is needed · a hook/
validation requires a deterministic command · explicit user approval exists.

## The task-brief handoff

1. After Discuss/Plan, run the `kepler-task-brief` skill (manual) to produce a Kepler-ready brief.
2. Hand the brief to GitKraken/Kepler (or `mcp__GitKraken__*`). Kepler creates the worktree/branch
   and tracks the session.
3. Execute (local subagent or Jules). Review diffs in Kepler/GitKraken, not by re-running raw git.
4. Stage/commit/PR through Kepler. Gate any protected-branch push or merge through `approval-request`.

## Automations (PR governance)

Use Automations to offload: label PRs touching auth/security/db files · assign reviewers by path ·
add a PR checklist · flag large/stale PRs · flag failing CI · first-pass PR summaries · risk/
complexity hints · escalate blocked PRs. Automations must **not** merge, deploy, or approve
security-sensitive changes without human approval.

## Launchpad

Use Launchpad as the human review dashboard (PRs, issues, tasks, builds, WIP, CI status, merge
readiness). Call Claude for reasoning-heavy review — not for dashboard polling.

## Fallback (no GitKraken)

Claude may run minimal read-only git facts and, with approval, the necessary writes. The
`block-dangerous-shell` hook still blocks force pushes, hard resets, and history destruction; the
`approval-request` skill still gates protected-branch pushes and merges.
