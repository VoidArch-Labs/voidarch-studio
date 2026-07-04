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

**v0.3.0 — drop-in development-control plugin.** Ships the manifest, 17 skills (7 workflow +
10 `/dfc-*` dev-memory/dashboard/setup), 10 agents, 7 fail-closed hooks, a **per-repo web
dashboard** (`pnpm dfc:dashboard`), a one-shot target-repo scaffold (`pnpm dfc:init`), the
read-only GitHub MCP config, `CLAUDE.md`/`AGENTS.md` templates, 9 flow docs, and optional MCP
examples. Manifest validation (`claude plugin validate`), typecheck, hook harness, and
dashboard/init smoke tests pass; see the roadmap for what is still only partially
live-validated.

## Shared dev-memory (agent-neutral SurrealDB `dfc` CLI)

`dev-flow-control` remains the canonical **Claude Code plugin** repo. Alongside the plugin it
ships a shared, **agent-neutral** dev-memory CLI (`pnpm dfc:*`) backed by **SurrealDB** —
embedded SurrealKV inside the repo by default (zero config), or a hosted instance for
shared multi-machine memory. One per-repo dev-memory database that every agent reads and writes:

- **Claude Code** compatibility is supported through
  [`skills/dfc-context/SKILL.md`](skills/dfc-context/SKILL.md) (the `/dfc-context`
  skill) and the plugin docs.
- **Codex and future agents** use the same CLI, wired through [`AGENTS.md`](AGENTS.md) and the
  `pnpm dfc:*` scripts.
- The dev-memory layer is **agent-neutral**: nothing about the Claude plugin depends on Codex; the
  CLI is the common interface and SurrealDB is the single shared backend.

Architecture and rationale: [`docs/dev-flow-control-spec.md`](docs/dev-flow-control-spec.md),
[`docs/spec-delta-surrealdb.md`](docs/spec-delta-surrealdb.md), and
[`docs/dev-memory-surreal-first-round.md`](docs/dev-memory-surreal-first-round.md).

### Quickstart (zero config — embedded SurrealKV)

The default backend is an **embedded SurrealDB (SurrealKV)** database at
`.dfc/dev-memory/` inside the repo — no server, no credentials, nothing to copy:

```bash
pnpm install
pnpm dfc:db:migrate
pnpm dfc:ingest --agent claude
pnpm dfc:context --task "Inspect the plugin architecture" --agent claude
```

One constraint: SurrealKV allows **one process at a time** (a `LOCK` file in the data
directory). Never run two `dfc` commands concurrently against the same embedded database —
a second command waits, then fails with a lock-timeout error. A killed process can leave
the database briefly locked.

**Hosted alternative** (shared multi-machine memory): copy
`.dfc/surreal.example.env` to `.dfc/surreal.env`, uncomment the `wss://` block, and fill
in real values. `.dfc/surreal.env` is gitignored — never commit real credentials, and
never print or commit `DFC_SURREAL_PASS`. Canonical defaults: `DFC_SURREAL_NS=dev_flow_control`,
`DFC_SURREAL_DB=repo_dev_flow_control`, `DFC_REPO_ID=dev-flow-control`.

### Target repo mode

The `dfc` CLI can run from the plugin package while targeting another repository:

```bash
pnpm --dir /path/to/dev-flow-control dfc:context \
  --task "Inspect this app" \
  --agent claude \
  --repo-root /path/to/target-repo
```

Resolution order for the target root is:

1. `--repo-root <path>`
2. `DFC_TARGET_REPO_ROOT`
3. `CLAUDE_PROJECT_DIR`
4. current shell working directory
5. the plugin repo itself

Config file precedence is:

```text
process.env > target .dfc/*.env > plugin .dfc/*.env/templates
```

This lets one installed plugin serve many repos while each repo keeps its own
database identity:

| Repo | `DFC_REPO_ID` | `DFC_SURREAL_DB` |
| --- | --- | --- |
| `dev-flow-control` | `dev-flow-control` | `repo_dev_flow_control` |
| `career-ops` | `career-ops` | `repo_career_ops` |
| `my-app` | `my-app` | `repo_my_app` |

Target repos should ignore local memory config and generated state:

```gitignore
.dfc/*.env
!.dfc/*.example.env
.dfc/dev-memory/
graphify-out/
.agent-runs/
```

The bundled Claude memory skills already run from `CLAUDE_PLUGIN_ROOT` and pass
`--repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"`, so `/dfc-context`, `/dfc-ingest`,
`/dfc-status`, `/dfc-search`, `/dfc-graph`, `/dfc-remember`, and
`/dfc-session-recap` target the active Claude project.

New repo setup checklist: [`docs/adding-to-new-repo.md`](docs/adding-to-new-repo.md).

For large repos or small hosted SurrealDB instances, use bounded resumable writes:

```bash
pnpm dfc:ingest --repo-root /path/to/target-repo --limit 50
pnpm dfc:docs:ingest --repo-root /path/to/target-repo --limit 10
```

`dfc:ingest` skips unchanged file hashes and reports how many changed files remain
limited. Both file and docs discovery skip generated agent worktrees such as
`.claude/worktrees/`, `.codex/worktrees/`, and `.agent-worktrees/`.

### Memory channels

SurrealDB is the **single** shared backend. Each channel is a *retrieval* lane folded
into one token-budgeted context pack — none replaces BM25 or the graph:

| Channel | Tables | Ingest | Query | State |
| --- | --- | --- | --- | --- |
| Repo files (BM25) | `file` | `pnpm dfc:ingest` | via `/dfc-context` | implemented |
| Document chunks (BM25) | `document`, `doc_chunk` | `pnpm dfc:docs:ingest` | `pnpm dfc:docs:query` | implemented |
| Graph (direct, Rust) | `graph_snapshot/node/edge/hyperedge` | `pnpm dfc:graph:build` (graphify-surreal → SurrealDB, no JSON step) | `pnpm dfc:graph:query`, `dfc:graph:status`, `dfc:graph:build --query` | implemented |
| Graph (legacy JSON import) | same tables | `pnpm dfc:graph:import` (graphify graph.json) | same | implemented (fallback) |
| Vectors (embeddings) | `embedding_model`, `embedding_chunk` | `pnpm dfc:embed` | folded into `/dfc-context` | scaffolding — **approval-gated**, off by default |
| Memories (5 kinds) | `decision`, `evidence_item`, `lesson`, `snippet`, `repo_fact` | `pnpm dfc:remember`, `pnpm dfc:memory` | `pnpm dfc:memory search`, via `/dfc-context` | implemented |
| Task / blocker state | `task`, `blocker` | `pnpm dfc:task`, `pnpm dfc:blocker` | same CLIs; open items appear in `/dfc-context` `state` | implemented |
| Runs | `agent_run`, `tool_event` | `pnpm dfc:import-runs` | via `/dfc-context` | implemented |

`pnpm dfc:context` fuses all available channels (files + symbols + graph neighborhood +
document chunks + vector matches + decisions/evidence + recent runs) with deterministic
scoring and a token budget; any unavailable channel degrades to an empty array.

Two utility commands round out the CLI:

- `pnpm dfc:metrics [--days 30] [--json]` — summary of memory and run metrics.
- `pnpm dfc:sync --to <url>` / `--from <url>` — one-way copy of the repo-scoped tables
  between the embedded database and a hosted SurrealDB instance (supports `--dry-run`).
  Use it to promote local memory to a shared hosted instance, or pull it back down.

**Claude memory skills** (manual-invoke, bundled in the plugin under `skills/`): `/dfc-context`,
`/dfc-remember`, `/dfc-memory`, `/dfc-search`, `/dfc-status`, `/dfc-ingest`, `/dfc-session-recap`,
`/dfc-graph`.

### Dev-memory status

**Implemented now (typecheck + dry-run validated):** document, graph, and vector
**code paths**; hybrid context-pack retrieval; the Claude memory skills; migrations
`schema/0003_documents_graph_vectors.surql` and `schema/0004_state_memory_kinds.surql`
(task/blocker state + the lesson/snippet/repo_fact memory kinds).

**Dry-run only (no credentials needed):** `dfc:docs:ingest --dry-run`,
`dfc:docs:query --dry-run`, `dfc:graph:status --dry-run`, `dfc:graph:query --dry-run`,
`dfc:embed --dry-run`, `dfc:memory:doctor`, `dfc:memory:gc --dry-run`.

**Requires a database:** every live `ingest`/`import`/`query`/`status` path and
`pnpm dfc:db:migrate`. The embedded SurrealKV default needs no credentials; hosted mode
needs `.dfc/surreal.env` or `DFC_SURREAL_*`.

**Requires an explicit embedding provider** (`DFC_EMBED_PROVIDER=ollama|openai`): `dfc:embed`
live. The paid path (`openai`) **also** needs `OPENAI_API_KEY` **and** approval
(`DFC_EMBED_APPROVED=1` or `--approve`) — paid APIs are never called silently.

**Live-validated (2026-06-30):** against the canonical hosted SurrealDB instance —
`db:migrate` (incl. `schema/0003`), `ingest` (91 files), `docs:ingest` (40 docs / 239
chunks), `graph:import` (663 nodes / 1122 edges), `context` (hybrid pack: files + symbols +
graph + doc chunks), `status`, `memory:doctor`, `memory:gc`. See
[`docs/postmerge-validation-and-roadmap.md`](docs/postmerge-validation-and-roadmap.md) §3b.

**External target validation (2026-06-30):** installed plugin cache validated against
`/opt/career-ops` with target `.dfc/*.env`, isolated database `repo_career_ops`,
bounded file/doc writes, docs query, local graph dry-run, context pack, status,
doctor, and GC dry-run. Full graph/doc/vector imports should be chunked or run on a
larger SurrealDB instance; Free-tier instances can time out on full-repo loads.

**Still pending:** interactive plugin-session test (`claude --plugin-dir .`, blocked here by
the nested-session guard); efficiency benchmark before any token-savings claim.

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
| `dfc-dashboard` | **manual** | Start the per-repo web dashboard (health, sessions, memory, graph). |
| `dfc-init` | **manual** | Scaffold the current repo (.dfc templates, .gitignore, CLAUDE/AGENTS.md). |
| `dfc-context` / `dfc-remember` / `dfc-search` / `dfc-status` / `dfc-ingest` / `dfc-graph` / `dfc-session-recap` / `dfc-grok-build` | **manual** | SurrealDB dev-memory + external-worker skills (see below). |

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

## Per-repo dashboard

```bash
pnpm dfc:dashboard --repo-root /path/to/repo     # http://127.0.0.1:4949 (or /dfc-dashboard in-session)
```

Local-only (binds 127.0.0.1), read-only, no extra dependencies. Four tabs:

- **Overview** — live health checks: plugin manifest, hook scripts present, `jq`, bundled
  skills/agents counts, repo-graph freshness, `.agent-runs/` observability, dev-memory config.
- **Development** — SurrealDB dev-memory (table counts; recent tasks, blockers, decisions,
  evidence, lessons, snippets, repo facts, and agent runs; metrics summary;
  60s cache + manual refresh) and scoped approval records.
- **Sessions** — `.agent-runs/sessions/` per-session tool activity, verification and
  graph-scan markers, recent tool events.
- **Graph** — graphify node/edge counts and the interactive `graph.html`.

Everything degrades gracefully: no SurrealDB creds → memory panel reads "off"; no graph →
prompt to run `/graphify`; no `.agent-runs/` → appears after the first hooked session.

## Installation — drop into any repo

```bash
# 1. One-time: install plugin deps
cd /path/to/dev-flow-control && pnpm install

# 2. Scaffold the target repo (.dfc templates with per-repo DB identity, .gitignore,
#    and the bundled multi-agent workflows dfc-review / dfc-understand / dfc-preship
#    into .claude/workflows/)
pnpm dfc:init --repo-root /path/to/your-repo            # add --copy-credentials to reuse
                                                        # the plugin's SurrealDB instance
                                                        # with an isolated per-repo database

# 3. Load the plugin when working in that repo
cd /path/to/your-repo && claude --plugin-dir /path/to/dev-flow-control

# 4. Inside the session: /dfc-init (if you skipped step 2), /dfc-context, /dfc-dashboard …
```

Hooks load at session start — restart Claude Code after enabling. Use `claude --debug` to see
hook execution and `/hooks` to review loaded hooks. Full checklist:
[`docs/adding-to-new-repo.md`](docs/adding-to-new-repo.md).

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
- **Cross-repo validation.** Exercise `--repo-root` against multiple real repos and keep each
  repo on its own `DFC_SURREAL_DB`.
- **Run the efficiency benchmark.** Execute `templates/docs/efficiency-benchmark.md` Tasks A/B/C
  (baseline vs plugin) and record real token/accuracy deltas before claiming improvement.
- **Close the research gaps.** Work through `templates/docs/research-gaps.md` (GitKraken/Kepler
  plan capabilities, Jules quota/auth, graphify language/output specifics, telemetry env-vars).
- **Publish.** Add a marketplace entry once live-tested.

## License

MIT
