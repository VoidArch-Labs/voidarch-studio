# Agent Flow

dev-flow-control ships nine scoped subagents. Each runs in its own context, has least-privilege
tools, and returns a compact result to the supervisor. Read-only agents have **no** Edit/Write/Bash.

| Agent | Phase | Tools | Writes? | Role |
|---|---|---|---|---|
| `repo-explorer` | Plan | Read, Grep, Glob | no | Locate relevant files/symbols/tests; compact map. |
| `graph-navigator` | Plan | Read, Grep, Glob | no | Dependencies, call chains, impact radius via the repo graph. |
| `planner` | Plan | Read, Grep, Glob | no | Bounded plan + executor route + verification + gates. |
| `implementation-worker` | Execute | Read, Edit, Write, Bash, Grep, Glob | yes | Scoped edits + tests; no broad refactors. |
| `test-debugger` | Execute/Verify | Read, Edit, Write, Bash, Grep, Glob | yes | Reproduce → root cause → narrow patch. |
| `pr-reviewer` | Verify | Read, Grep, Glob, Bash | no (review) | Acceptance criteria, coverage, regression risk. |
| `security-reviewer` | Verify | Read, Grep, Glob | no | Auth/secrets/permissions/injection; severity-ranked. |
| `docs-researcher` | Plan/Execute | Read, Grep, Glob, Context7, Firecrawl(search/scrape) | no | Current version-correct docs; summaries only. |
| `release-checker` | Ship | Read, Grep, Glob, Bash | no (verify) | Ship readiness: verification, CI, approvals, rollback. |

## How they compose

```
Plan:    repo-explorer / graph-navigator  →  planner (chooses executor route)
Execute: implementation-worker  (or jules-handoff for async)  →  test-debugger on failures
Verify:  pr-reviewer + security-reviewer
Ship:    release-checker  →  approval-request  →  Kepler/GitKraken commit/PR
```

## Principles

- **Least privilege.** Review/exploration agents cannot edit or write. Most have no `Bash` at all
  (repo-explorer, graph-navigator, planner, security-reviewer, docs-researcher). The two review
  agents that keep `Bash` (`pr-reviewer`, `release-checker`) restrict it **in their system prompts
  to read-only inspection** — `pwd`, `ls`, `find`, `grep`, `git status`, `git diff --stat`,
  `git log`, read-only CI checks, package-script discovery, and (for pr-reviewer) running the test
  suite. They must not modify files, install packages, change Git state, deploy, or write external
  state. This is the primary control; the safety hooks are defense-in-depth.
- **Compact returns.** Agents return summaries and minimal read sets, not file dumps — this is
  where the token savings come from.
- **Escalate, don't widen.** An agent that hits architectural scope reports and stops; it does not
  refactor its way out.
- **Supervisor decides.** Agents propose; Claude (the supervisor) routes, reviews, and gates.

## Invocation

The supervisor dispatches these via the Task tool (or the host's subagent mechanism). They are also
selectable automatically by description match. `docs-researcher`'s Firecrawl access is limited to
`search` and `scrape` — crawl/extract/agent modes are gated by the `mcp-write-gate` hook.
