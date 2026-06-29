# dev-flow-control

A Claude Code plugin pack for **subscription-first, token-efficient, higher-autonomy,
higher-accuracy** autonomous development. It turns Claude Code into a development
*supervisor* instead of a terminal janitor: Claude reasons and routes, while specialized
tools handle Git state, repo indexing, current docs, web extraction, verification, security
checks, async branch work, and workflow visibility.

> Context windows are not landfill. This plugin makes a large tool ecosystem *available*
> without loading all of it into every session.

## Goals

1. **Lower token usage** — skills stay available but unloaded until needed; noisy repo
   exploration moves to subagents; a repo graph precedes raw file reads; Git plumbing is
   offloaded to GitKraken/Kepler; GitHub MCP stays read-only; docs/web stay gated.
2. **Higher safe autonomy** — GSD drives the phase loop; scoped subagents and Jules execute;
   hooks enforce deterministic safety; runs and approvals are logged.
3. **Higher accuracy** — repo-graph lookup before broad reads; Context7 for version-sensitive
   docs; deterministic tests/lint/typecheck/build/CI/security; PR + security review before Ship.
4. **Subscription-first** — flat-rate product surfaces by default. Paid/gateway routes
   (API gateways, `ANTHROPIC_BASE_URL`, Bedrock/Vertex/OpenRouter, paid Firecrawl, automated
   Jules API sessions) require explicit user approval.

## Status

**v0.1.0 — feature-complete build.** Ships the manifest, 7 skills, 9 agents, 7 hooks, the
read-only GitHub MCP config, the `CLAUDE.md`/`AGENTS.md` templates, 9 flow docs, optional MCP
examples, and this README.

> **Implementation-hardening pass (current):** GitKraken MCP/CLI write gating, scoped approval
> records (replacing broad flags), fail-closed security hooks, `--force-with-lease` gating, explicit
> graph integration, session-scoped markers, richer observability fields, optional MCP examples, and
> tightened read-only agent Bash wording. **These changes were NOT tested, validated, or run in any
> live session — by instruction.** Verify before relying on them; the plugin is not validated.

## Shared dev-memory (agent-neutral SurrealDB `dfc` CLI)

`dev-flow-control` remains the canonical **Claude Code plugin** repo. Alongside the plugin it
ships a shared, **agent-neutral** dev-memory CLI (`pnpm dfc:*`) backed by **hosted SurrealDB** —
one per-repo dev-memory database that every agent reads and writes:

- **Claude Code** compatibility is supported through
  [`.claude/skills/dfc-context/SKILL.md`](.claude/skills/dfc-context/SKILL.md) (the `/dfc-context`
  skill) and the plugin docs.
- **Codex and future agents** use the same CLI, wired through [`AGENTS.md`](AGENTS.md) and the
  `pnpm dfc:*` scripts.
- The dev-memory layer is **agent-neutral**: nothing about the Claude plugin depends on Codex; the
  CLI is the common interface and SurrealDB is the single shared backend.

Architecture and rationale: [`docs/dev-flow-control-spec.md`](docs/dev-flow-control-spec.md),
[`docs/spec-delta-surrealdb.md`](docs/spec-delta-surrealdb.md), and
[`docs/dev-memory-surreal-first-round.md`](docs/dev-memory-surreal-first-round.md).

### Quickstart

```bash
pnpm install
cp .dfc/surreal.example.env .dfc/surreal.env
pnpm dfc:db:check
pnpm dfc:db:migrate
pnpm dfc:ingest --agent claude
pnpm dfc:context --task "Inspect the plugin architecture" --agent claude
```

`.dfc/surreal.env` is gitignored — never commit real credentials, and never print or commit
`DFC_SURREAL_PASS`. Canonical defaults: `DFC_SURREAL_NS=dev_flow_control`,
`DFC_SURREAL_DB=repo_dev_flow_control`, `DFC_REPO_ID=dev-flow-control`.

### Dev-memory status

**Implemented and validated:**

- The SurrealDB memory slice was built and live-validated in the temporary
  `dev-flow-control-codex` fork.
- Imported into this canonical repo by this PR after adapting it to canonical naming.

**Still pending:**

- Live Claude Code plugin install test and hook-payload validation.
- Graph / vector / document memory expansion (planned, not implemented).
- Full efficiency benchmark before any token-savings claim.

## Architecture

```
User / issue / PR / backlog item
  → GitKraken Kepler        task, worktree, branch/session, diff, stage/commit/PR
  → Claude Code supervisor  GSD routing, intent/architecture/risk, executor choice, approvals
  → Context & planning      graphify repo graph · repo-explorer · Context7 · Firecrawl (gated)
  → Execution               implementation-worker · test-debugger · Jules (async PR)
  → Verification            tests/lint/typecheck/build/CI · pr-reviewer · security-reviewer
  → Observability+approval  .agent-runs logs · session report · rollback · human approval
```

Operating rule: **GSD controls phases · Karpathy rules constrain coding · Kepler/GitKraken
controls Git state · graphify controls repo discovery · Claude supervises · subagents execute
local · Jules executes async PRs · Context7 = docs · Firecrawl = gated web · hooks = safety ·
observability = audit · the user approves irreversible actions.**

## What's in this plugin

### Skills (`skills/`)

| Skill | Auto-invocable | Purpose |
|---|---|---|
| `dev-flow-routing` | yes | Maps each GSD phase → skills/agents/tools/gates. The routing spine. |
| `graph-context-scan` | yes | Query the repo graph (graphify) before broad file reads. |
| `observability-report` | yes | Summarize run/session state from `.agent-runs/`. |
| `approval-request` | yes | Standard human approval request before irreversible actions. |
| `kepler-task-brief` | **manual** | Convert a request/issue/Plan into a Kepler-ready task brief. |
| `jules-handoff` | **manual** | Convert a Plan into a bounded, approval-gated Jules task packet. |
| `firecrawl-research` | **manual** | Bounded external web extraction; crawl/extract gated. |

"Auto-invocable" maps to the `disable-model-invocation` frontmatter field (`false` = the model
may auto-select it; `true` = manual/user-invoked only).

### Agents (`agents/`)

Nine scoped subagents, least-privilege tools (read-only agents have **no** Edit/Write/Bash):

| Agent | Phase | Writes? | Role |
|---|---|---|---|
| `repo-explorer` | Plan | no | Locate relevant files/symbols/tests; compact map. |
| `graph-navigator` | Plan | no | Dependencies, call chains, impact radius via the repo graph. |
| `planner` | Plan | no | Bounded plan + executor route + verification + gates. |
| `implementation-worker` | Execute | yes | Scoped edits + tests; no broad refactors. |
| `test-debugger` | Execute/Verify | yes | Reproduce → root cause → narrow patch. |
| `pr-reviewer` | Verify | no | Acceptance criteria, coverage, regression risk. |
| `security-reviewer` | Verify | no | Auth/secrets/permissions/injection; severity-ranked. |
| `docs-researcher` | Plan/Execute | no | Current version-correct docs (Context7/gated Firecrawl). |
| `release-checker` | Ship | no | Ship readiness: verification, CI, approvals, rollback. |

See [`templates/docs/agent-flow.md`](templates/docs/agent-flow.md) for tool sets and composition.

### Hooks (`hooks/hooks.json` + scripts)

A shared helper `hooks/dfc-common.sh` (sourced, not a hook) provides fail-closed parsing, scoped
approvals, and session-scoped markers.

| Hook | Event | Behavior |
|---|---|---|
| `block-protected-files` | PreToolUse `Write\|Edit` | Blocks `.env`, keys/certs, credentials, prod config, `.git/*`, lockfiles. **Fails closed** on bad payloads. |
| `block-dangerous-shell` | PreToolUse `Bash` | Blocks `rm -rf`, `git reset --hard`, **force push AND `--force-with-lease`**, `curl\|sh`, deploy/publish, DB drops, write-like `gk` CLI ops. **Fails closed.** |
| `mcp-write-gate` | PreToolUse `mcp__.*` | Blocks GitHub writes, Firecrawl crawl/extract/agent, Jules/Copilot control, **and write-like GitKraken MCP actions** (case-insensitive). **Fails closed.** |
| `enforce-repo-graph-first` | PreToolUse `Read\|Grep\|Glob` | **Warns once per session** after N raw reads with no graph scan. Never blocks. Session-scoped markers. |
| `require-verification-before-ship` | Stop | Warns (or blocks under `.strict-verify`) if files changed with no **session-scoped** verification recorded. |
| `log-agent-run` | PostToolUse `*` | Appends a rich JSON line per tool call to `.agent-runs/sessions/<id>/tools.jsonl` (+ aggregate). Never blocks. |
| `log-compact-recap` | PreCompact | Logs compaction and prompts a recap before context is compacted. |

**Fail-closed:** the three security hooks exit 2 (block) on empty/malformed payloads or when `jq`
is unavailable (`jq` is required for safe parsing; `DFC_ALLOW_NO_JQ=1` opts out, unsafely). Pure
logging hooks never block — they record a parse error instead.

**Approvals = scoped records, not broad flags.** Overrides are now **scoped approval records** —
JSON files under `.agent-runs/approvals/` (or `.agent-runs/sessions/<id>/approvals/`) whose
`tool_pattern` matches the specific tool/command, with expiry and `single_use` consumption. See
[`templates/approval.example.json`](templates/approval.example.json) and
[`approval-gates.md`](templates/docs/approval-gates.md). Hard blocks with no override: `.git/*` and
private key material.

> The old broad flags (`.allow-mcp-writes`, `.allow-destructive-shell`, `.allow-protected-edits`,
> `.allow-dependency-changes`) are **deprecated and unsafe** — honored only when
> `DFC_ALLOW_LEGACY_FLAGS=1`, with a deprecation warning. Migrate to scoped approval records.

Tunables: `DFC_GRAPH_READ_THRESHOLD` (default `4`); `GRAPH_INDEX_TOOL` / `GRAPH_INDEX_COMMAND` /
`GRAPH_INDEX_OUTPUT_DIR` / `GRAPH_INDEX_FRESHNESS_MINUTES` (graph integration, may be unavailable —
see [`graph-index-flow.md`](templates/docs/graph-index-flow.md)); `.strict-verify` makes the
verification gate block.

### MCP (`.mcp.json`)

Ships **one** server: GitHub, **read-only** (`X-MCP-Readonly: true`, scoped toolsets), authed
via the `GITHUB_MCP_PAT` environment variable. Set it before enabling:

```bash
export GITHUB_MCP_PAT=ghp_your_read_only_token
```

If `GITHUB_MCP_PAT` is unset the server simply won't connect (non-fatal). GitKraken, Context7,
Firecrawl, and the `agent-cli` (Jules/Copilot) servers are expected from your host
environment and are **not** redefined here, to avoid duplicate-server conflicts. `dev-flow-routing`
references them by their real tool names with generic fallbacks.

**Optional MCP examples** live in [`templates/mcp.examples/`](templates/mcp.examples/) — copyable,
**not active by default**: `github.readonly.json`, `gitkraken.optional.json`,
`context7.cli-skill-notes.md`, `context7.mcp.optional.json`, `firecrawl.gated.optional.json`,
`graphify.optional.json` (an explicit placeholder — no invented command), and `jules.notes.md`.
Each documents its approval requirements; enabling any of them is opt-in.

### Templates & docs (`templates/`)

- `CLAUDE.md.template`, `AGENTS.md.template` — copy into your project to encode the workflow and
  the rules external executors (Jules) must follow.
- `templates/docs/` — nine flow docs: `agent-flow`, `gsd-skill-routing`, `kepler-flow`,
  `jules-flow`, `graph-index-flow`, `observability`, `approval-gates`, `efficiency-benchmark`,
  `research-gaps`.
- `templates/approval.example.json` — the scoped approval-record shape (copy into `.agent-runs/approvals/`).
- `templates/mcp.examples/` — copyable, opt-in MCP server snippets (see [MCP](#mcp-mcpjson)).

## Installation

```bash
# Local test
claude --plugin-dir /path/to/dev-flow-control

# Or install from a marketplace once published
```

Hooks load at session start — restart Claude Code after enabling. Use `claude --debug` to see
hook execution and `/hooks` to review loaded hooks.

## Skill visibility strategy

The plugin's own skills set their visibility via `disable-model-invocation` (above). For the
*Anthropic/GSD* skills the workflow routes to, apply overrides in **your own**
`.claude/settings.json` (a plugin cannot apply these to your session for you):

```json
{
  "skillOverrides": {
    "product-management": "on",
    "engineering": "on",
    "pr-review-toolkit": "on",
    "session-report": "on",
    "design": "name-only",
    "frontend-design": "name-only",
    "data": "user-invocable-only",
    "mcp-server-dev": "user-invocable-only",
    "plugin-dev": "user-invocable-only",
    "hookify": "user-invocable-only"
  }
}
```

## Safety & approval gates

Never done without explicit approval: deploy to production · merge PRs · push protected
branches · write production data · access/expose secrets · send messages · submit
forms/applications · purchases · public posts · change billing/model/provider routes · change
security settings · destructive shell · enable paid Firecrawl/API modes · start Jules API
sessions. Use the `approval-request` skill to present action, risk, diff/payload preview, and
rollback before proceeding. Deterministic enforcement is provided by the hooks above.

## Notes on plugin schema (intentional deviations from the original spec)

- **No `monitors/` component.** Claude Code has no `monitors` plugin component. Observability is
  delivered via the logging hooks (`.agent-runs/current.jsonl`), the `observability-report`
  skill, and optional OpenTelemetry (env/settings based) — wired through real mechanisms.
- **No `components` map / plugin `settings.json` auto-apply.** The manifest uses the real schema
  (`name`, `version`, `description`, `author`, `keywords`). `skillOverrides` go in your own
  settings (shown above), not a plugin-root file.

## Roadmap

All spec components are built. Remaining work is validation-in-the-wild, not authoring:

- **Live session test.** Install with `--plugin-dir`, restart, and confirm skills auto-trigger,
  hooks fire (`claude --debug`), agents dispatch, and the GitHub MCP server connects with a PAT.
- **Run the efficiency benchmark.** Execute `templates/docs/efficiency-benchmark.md` Tasks A/B/C
  (baseline vs plugin) and record real token/accuracy deltas before claiming improvement.
- **Close the research gaps.** Work through `templates/docs/research-gaps.md` (GitKraken/Kepler
  plan capabilities, Jules quota/auth, graphify language/output specifics, telemetry env-vars).
- **Publish.** Add a marketplace entry once live-tested.

## License

MIT
