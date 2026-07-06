# Voidarch

**Local-first memory and orchestration for AI coding agents.**

Voidarch is two products in one monorepo:

- **[Voidarch Context](packages/voidarch-context/README.md)** (`@voidarch/context`) — a standalone, drop-in **repo memory / query / context-pack engine**. Index a repo, remember decisions, and hand any agent a token-budgeted context pack — one npm install, no Docker, no Python, no API key.
- **Voidarch Studio** — a power-user **agent orchestration control room**: worktrees, terminal/PTY, agent launching, prompt/provider routing, safety hooks, observability, a per-repo web dashboard, and a native SwiftUI shell.

The boundary rule: *if it retrieves, remembers, indexes, searches, or explains repo context, it's **Context**; if it launches, routes, controls, observes, approves, or manages agents, it's **Studio***. Studio builds on Context; Context never needs Studio.

> Context windows are not landfill. Voidarch makes a large tool ecosystem *available* to your agent without loading all of it into every session.

*(Formerly `dev-flow-control` / Nox. `dfc` survives only as a legacy internal command prefix — see [Legacy naming](#legacy-naming--compatibility).)*

---

## Table of contents

- [Why Voidarch](#why-voidarch)
- [Repository layout](#repository-layout)
- [Voidarch Context — the memory engine](#voidarch-context--the-memory-engine)
  - [Quickstart](#quickstart-3-minutes)
  - [CLI surface](#cli-surface)
  - [Memory channels](#memory-channels)
  - [Embeddings](#embeddings)
  - [Using it from Claude Code, Codex, and other agents](#using-it-from-claude-code-codex-and-other-agents)
  - [Target-repo mode & hosted backend](#target-repo-mode--hosted-backend)
- [Voidarch Studio — the control room](#voidarch-studio--the-control-room)
  - [Web dashboard](#web-dashboard)
  - [Native SwiftUI app](#native-swiftui-app)
  - [Feature flags](#feature-flags)
- [The Claude Code plugin](#the-claude-code-plugin)
  - [Goals](#goals)
  - [Skills](#skills-skills)
  - [Agents](#agents-agents)
  - [Hooks](#hooks-hookshooksjson--scripts)
  - [MCP](#mcp-mcpjson)
  - [Templates & docs](#templates--docs-templates)
  - [Installation — drop into any repo](#installation--drop-into-any-repo)
  - [Safety & approval gates](#safety--approval-gates)
- [Architecture](#architecture)
- [Development](#development)
- [Legacy naming & compatibility](#legacy-naming--compatibility)
- [Roadmap](#roadmap)
- [License](#license)

---

## Why Voidarch

AI coding agents have two structural problems:

1. **Amnesia.** Every session re-discovers the same repo facts, re-reads the same files, and forgets every decision when the context window closes. That's wasted tokens and repeated mistakes.
2. **Chaos at scale.** Once you run more than one agent — local subagents, async PR workers, headless runs — you need somewhere to launch, watch, route, gate, and audit them.

Voidarch Context solves the first problem: a persistent, local, per-repo brain (indexed files, code graph, doc search, embeddings, durable memories) assembled on demand into one context pack. Voidarch Studio solves the second: a control room over agents, sessions, tokens, and approvals — with deterministic, fail-closed safety hooks rather than vibes.

Design principles across both:

- **Local-first.** Embedded database inside the repo, local embedding model, localhost-only servers, zero telemetry. Remote anything (hosted DB, paid embeddings, web extraction) is explicit and opt-in.
- **Subscription-first.** Flat-rate product surfaces by default; paid/gateway routes (API gateways, `ANTHROPIC_BASE_URL`, Bedrock/Vertex/OpenRouter, paid Firecrawl, automated Jules API sessions) require explicit approval.
- **Agent-neutral memory.** Claude Code, Codex, and future agents read and write the same per-repo database through the same CLI.
- **Honest surfaces.** Planned modules are feature-flagged and never presented as implemented until they are.

## Repository layout

```
packages/voidarch-context/   @voidarch/context — the standalone memory engine (npm package)
  bin/voidarch-context.js      CLI entrypoint
  src/                         ingest, docs, graph, vectors, scoring, context-pack, surreal
  scripts/                     one command ≈ one script (legacy dfc-*.ts filenames, internal)
  schema/                      SurrealDB migrations (auto-applied for embedded DBs)
  page/                        local info/search/context page (voidarch-context serve)
  docs/product-page.md         product copy
dashboard/                   Studio web dashboard client (single page, no deps)
scripts/                     Studio-side entrypoints (dashboard, init scaffold, flags, grok-build)
studio/                      Voidarch Studio native SwiftUI shell (macOS 14+)
skills/                      Claude Code skills (workflow + memory; legacy /dfc-* names)
agents/                      scoped subagent definitions
hooks/                       fail-closed safety + observability hooks
workflows/                   bundled multi-agent workflows (review / understand / preship)
templates/                   CLAUDE.md/AGENTS.md templates, flow docs, MCP examples
docs/                        specs, MVP boundary docs, validation reports
.claude-plugin/plugin.json   Claude Code plugin manifest (voidarch-studio)
```

---

## Voidarch Context — the memory engine

Full docs: [`packages/voidarch-context/README.md`](packages/voidarch-context/README.md) · product page: [`docs/product-page.md`](packages/voidarch-context/docs/product-page.md)

### Quickstart (3 minutes)

```bash
npm install -g @voidarch/context
cd your-repo
voidarch-context init                      # .voidarch/config.json + .gitignore entries
voidarch-context ingest                    # index the repo
voidarch-context context "fix the auth token refresh bug"
```

The third command prints a Markdown context pack — relevant files, symbols, doc excerpts, memories, open tasks/blockers — ready to paste into any agent. The backend is an **embedded SurrealDB (SurrealKV)** database at `.voidarch/db/` inside the repo: no server, no credentials, gitignored.

One constraint: SurrealKV allows **one process at a time** (a `LOCK` file in the data directory). Don't run two commands concurrently against the same embedded database; a killed process can leave it briefly locked.

### CLI surface

| Command | What it does |
|---|---|
| `init` | scaffold `.voidarch/config.json` + `.gitignore` entries |
| `ingest` | index repo text files (default-deny by extension; secrets never stored) |
| `search "..."` | rank document chunks (BM25 full-text; `--dry-run` works with no DB) |
| `query "..."` | rank code-graph nodes + neighborhood edges |
| `context "..."` | build a token-budgeted Markdown/JSON context pack across all channels |
| `remember --kind <k> "..."` | record a durable memory (`decision`, `evidence`, `lesson`, `snippet`, `repo_fact`, `task_note`) |
| `memory <add\|list\|search\|get\|update\|delete>` | full CRUD over memories |
| `task` / `blocker` | lightweight task + blocker state (shows up in context packs) |
| `status` | counts + freshness across all channels |
| `serve` | local info/search/context page (default `http://localhost:4950`) |
| `doctor` | health report across DB, ingest, docs, graph, vectors, memory |
| `embed` | embed indexed content for semantic retrieval (approval-gated when paid) |
| `docs` / `graph` / `db` / `models` / `config` / `metrics` / `sync` / `snippets` | see `voidarch-context help` |

### Memory channels

SurrealDB is the **single** shared backend. Each channel is a *retrieval* lane folded into one token-budgeted context pack — none replaces BM25 or the graph:

| Channel | Tables | Ingest | Query |
| --- | --- | --- | --- |
| Repo files (BM25) | `file` | `ingest` | via `context` |
| Document chunks (BM25) | `document`, `doc_chunk` | `docs ingest` | `search` / `docs query` |
| Graph (built-in, native TS) | `graph_snapshot/node/edge/hyperedge` | `graph build` (files + symbols + import edges, no external tools) | `query` / `graph query` / `graph status` |
| Graph (deep, Rust — optional) | same tables | `graph build --engine graphify-surreal` (external binary, AST/semantic) | same |
| Graph (JSON import fallback) | same tables | `graph import` (graph.json) | same |
| Vectors (embeddings) | `embedding_model`, `embedding_chunk` | `embed` | folded into `context` |
| Memories (6 kinds) | `decision`, `evidence_item`, `lesson`, `snippet`, `repo_fact`, `task_note` | `remember`, `memory` | `memory search`, via `context` |
| Task / blocker state | `task`, `blocker` | `task`, `blocker` | same CLIs; open items appear in `context` |
| Runs | `agent_run`, `tool_event` | run importers | via `context` |

`context "<task>"` fuses all available channels (files + symbols + graph neighborhood + doc chunks + vector matches + memories + recent runs) with deterministic scoring and a token budget; any unavailable channel degrades to an empty section.

Utility commands: `metrics [--days 30] [--json]` (memory/run metrics) and `sync --to/--from <url>` (one-way copy of repo-scoped tables between the embedded database and a hosted instance; supports `--dry-run`).

### Embeddings

- **Local, keyless (default):** ONNX `all-MiniLM-L6-v2` via `@huggingface/transformers`, auto-downloaded and cached (~90 MB, one-time). Manage with `models status` / `models install`.
- **OpenAI-compatible (optional):** `config embedding openai-compatible`, then `VOIDARCH_EMBED_BASE_URL`, `VOIDARCH_EMBED_MODEL`, `VOIDARCH_EMBED_API_KEY` (or `OPENAI_API_KEY`), optional `VOIDARCH_EMBED_DIMENSIONS`. **Paid calls are approval-gated** — they run only with `--approve` or `VOIDARCH_EMBED_APPROVED=1`. Paid APIs are never called silently.

### Using it from Claude Code, Codex, and other agents

`voidarch-context snippets` prints both integrations ready to paste:

- **Claude Code:** a slash command for `.claude/commands/voidarch-context.md` — `/voidarch-context <task>` builds and injects a context pack. This repo's bundled plugin also ships the equivalent memory skills (legacy `/dfc-*` names, see [Skills](#skills-skills)).
- **Codex / AGENTS.md agents:** an `AGENTS.md` block instructing agents to run `npx voidarch-context context "<task>"` before non-trivial work and `remember --kind <k> "..."` to record durable facts.

If `--agent` is omitted, writes default to `manual`; supported source agents are `manual`, `codex`, `claude`.

### Target-repo mode & hosted backend

The CLI can run from one install while targeting another repository. Target-root resolution order:

1. `--repo-root <path>`
2. `DFC_TARGET_REPO_ROOT` (legacy env name)
3. `CLAUDE_PROJECT_DIR`
4. current working directory

Config precedence: `process.env` > target repo `.dfc/*.env` (legacy) > `.voidarch/config.json`. Each repo keeps its own database identity (`DFC_REPO_ID`, `DFC_SURREAL_DB`), so one install serves many repos without cross-contamination.

**Hosted alternative** (shared multi-machine memory): point `DFC_SURREAL_URL`/`_USER`/`_PASS` at a hosted SurrealDB (`wss://`). Credentials belong in env vars or gitignored `.dfc/*.env` files — never commit them, never print `DFC_SURREAL_PASS`. Use `sync` to promote local memory to the hosted instance or pull it back down.

---

## Voidarch Studio — the control room

### Web dashboard

```bash
pnpm dfc:dashboard --repo-root /path/to/repo     # http://127.0.0.1:4949 (or /dfc-dashboard in-session)
```

Local-only (binds 127.0.0.1), zero extra dependencies. A single-page aurora-dark control room with collapsible panels: **Control Room** (live agents + needs-attention), **Agents** (deploy headless `claude -p` runs with streamed output and a kill button, plus hooked-session history), **Workflows**, **Code Map** (interactive force graph with search/focus), **Memory & Retrieval**, **Metrics**, **Token Usage** (real per-model/per-day/per-session tokens from Claude Code transcripts + context-pack estimates), **Sync & Backend** (embedded/hosted, LOCK state), **Observability**, and **Plugin Health** — plus a **Mercury-powered read-only assistant** drawer that answers repo/system questions from the graph, dev-memory, and live state.

Everything degrades gracefully: no DB → memory panel reads "off"; no graph → prompt to build one; no transcripts → tokens panel reads "off"; no Mercury key → assistant explains how to configure it. Full guide: [`docs/studio-dashboard.md`](docs/studio-dashboard.md).

### Native SwiftUI app

```bash
cd studio
swift run VoidarchStudio     # macOS 14+, Apple Silicon primary
```

Hybrid shell ([`studio/README.md`](studio/README.md)): native SwiftUI owns orchestration (Tasks, Worktrees, Terminal via SwiftTerm PTY, Runs, Providers with launch profiles persisted to `~/.voidarch-studio/providers.json`), WKWebView panels reuse the daemon's dashboard pages until they go native. The daemon is the extended dashboard server above — start it first.

### Feature flags

Planned Studio modules are registered in [`src/flags.ts`](src/flags.ts) and printed by `pnpm dfc:flags`. Statuses stay truthful: nothing is presented as implemented until it is.

---

## The Claude Code plugin

This repo doubles as a drop-in Claude Code plugin (`voidarch-studio` in [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json)) for **subscription-first, token-efficient, higher-autonomy, higher-accuracy** autonomous development. It turns Claude Code into a development *supervisor*: Claude reasons and routes while specialized tools handle Git state, repo indexing, current docs, web extraction, verification, security checks, async branch work, and workflow visibility.

### Goals

1. **Lower token usage** — skills stay available but unloaded until needed; noisy repo exploration moves to subagents; a repo graph precedes raw file reads; Git plumbing is offloaded to GitKraken/Kepler; GitHub MCP stays read-only; docs/web stay gated.
2. **Higher safe autonomy** — GSD drives the phase loop; scoped subagents and Jules execute; hooks enforce deterministic safety; runs and approvals are logged.
3. **Higher accuracy** — repo-graph lookup before broad reads; Context7 for version-sensitive docs; deterministic tests/lint/typecheck/build/CI/security; PR + security review before Ship.
4. **Subscription-first** — paid/gateway routes require explicit user approval.

### Skills (`skills/`)

| Skill | Auto-invocable | Purpose |
|---|---|---|
| `dev-flow-routing` | yes | Maps each GSD phase → skills/agents/tools/gates. The routing spine. |
| `graph-context-scan` | yes | Query the repo graph before broad file reads. |
| `observability-report` | yes | Summarize run/session state from `.agent-runs/`. |
| `approval-request` | yes | Standard human approval request before irreversible actions. |
| `kepler-task-brief` | **manual** | Convert a request/issue/Plan into a Kepler-ready task brief. |
| `jules-handoff` | **manual** | Convert a Plan into a bounded, approval-gated Jules task packet. |
| `firecrawl-research` | **manual** | Bounded external web extraction; crawl/extract gated. |
| `dfc-dashboard` | **manual** | Start the Voidarch Studio dashboard. |
| `dfc-init` | **manual** | Scaffold the current repo (templates, .gitignore, CLAUDE/AGENTS.md). |
| `dfc-context` / `dfc-remember` / `dfc-search` / `dfc-status` / `dfc-ingest` / `dfc-graph` / `dfc-session-recap` / `dfc-grok-build` | **manual** | Voidarch Context memory + external-worker skills (legacy `/dfc-*` names). |

"Auto-invocable" maps to the `disable-model-invocation` frontmatter field (`false` = the model may auto-select it; `true` = manual/user-invoked only).

### Agents (`agents/`)

Ten scoped subagents, least-privilege tools (read-only agents have **no** Edit/Write/Bash):

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
| `grok-build-worker` | Execute | yes | Manual external build worker (`pnpm dfc:grok-build`). |

See [`templates/docs/agent-flow.md`](templates/docs/agent-flow.md) for tool sets and composition.

### Hooks (`hooks/hooks.json` + scripts)

A shared helper `hooks/dfc-common.sh` (sourced, not a hook) provides fail-closed parsing, scoped approvals, and session-scoped markers.

| Hook | Event | Behavior |
|---|---|---|
| `block-protected-files` | PreToolUse `Write\|Edit` | Blocks `.env`, keys/certs, credentials, prod config, `.git/*`, lockfiles. **Fails closed** on bad payloads. |
| `block-dangerous-shell` | PreToolUse `Bash` | Blocks `rm -rf`, `git reset --hard`, **force push AND `--force-with-lease`**, `curl\|sh`, deploy/publish, DB drops, write-like `gk` CLI ops. **Fails closed.** |
| `mcp-write-gate` | PreToolUse `mcp__.*` | Blocks GitHub writes, Firecrawl crawl/extract/agent, Jules/Copilot control, write-like GitKraken MCP actions. **Fails closed.** |
| `enforce-repo-graph-first` | PreToolUse `Read\|Grep\|Glob` | Warns once per session after N raw reads with no graph scan. Never blocks. |
| `require-verification-before-ship` | Stop | Warns (or blocks under `.strict-verify`) if files changed with no session-scoped verification recorded. |
| `log-agent-run` | PostToolUse `*` | Appends a rich JSON line per tool call to `.agent-runs/sessions/<id>/tools.jsonl`. Never blocks. |
| `log-compact-recap` | PreCompact | Logs compaction and prompts a recap before context is compacted. |

**Fail-closed:** the three security hooks exit 2 (block) on empty/malformed payloads or when `jq` is unavailable (`DFC_ALLOW_NO_JQ=1` opts out, unsafely). Pure logging hooks never block.

**Approvals = scoped records, not broad flags.** Overrides are JSON files under `.agent-runs/approvals/` whose `tool_pattern` matches the specific tool/command, with expiry and `single_use` consumption. See [`templates/approval.example.json`](templates/approval.example.json) and [`approval-gates.md`](templates/docs/approval-gates.md). Hard blocks with no override: `.git/*` and private key material. The old broad flags (`.allow-mcp-writes` etc.) are **deprecated and unsafe** — honored only with `DFC_ALLOW_LEGACY_FLAGS=1`.

Tunables: `DFC_GRAPH_READ_THRESHOLD` (default `4`); `GRAPH_INDEX_TOOL` / `GRAPH_INDEX_COMMAND` / `GRAPH_INDEX_OUTPUT_DIR` / `GRAPH_INDEX_FRESHNESS_MINUTES`; `.strict-verify` makes the verification gate block.

### MCP (`.mcp.json`)

Ships **one** server: GitHub, **read-only** (`X-MCP-Readonly: true`, scoped toolsets), authed via `GITHUB_MCP_PAT`. If unset, the server simply won't connect (non-fatal). GitKraken, Context7, Firecrawl, and `agent-cli` (Jules/Copilot) servers are expected from your host environment and are **not** redefined here.

**Optional MCP examples** live in [`templates/mcp.examples/`](templates/mcp.examples/) — copyable, not active by default; each documents its approval requirements.

### Templates & docs (`templates/`)

- `CLAUDE.md.template`, `AGENTS.md.template` — copy into your project to encode the workflow and the rules external executors must follow.
- `templates/docs/` — nine flow docs: `agent-flow`, `gsd-skill-routing`, `kepler-flow`, `jules-flow`, `graph-index-flow`, `observability`, `approval-gates`, `efficiency-benchmark`, `research-gaps`.
- `templates/approval.example.json` — the scoped approval-record shape.

### Installation — drop into any repo

```bash
# 1. One-time: install plugin deps
cd /path/to/voidarch && pnpm install

# 2. Scaffold the target repo (per-repo DB identity, .gitignore, bundled workflows)
pnpm dfc:init --repo-root /path/to/your-repo    # --copy-credentials reuses a hosted instance
                                                # with an isolated per-repo database

# 3. Load the plugin when working in that repo
cd /path/to/your-repo && claude --plugin-dir /path/to/voidarch

# 4. Inside the session: /dfc-init (if you skipped step 2), /dfc-context, /dfc-dashboard …
```

Hooks load at session start — restart Claude Code after enabling. Use `claude --debug` to see hook execution. Full checklist: [`docs/adding-to-new-repo.md`](docs/adding-to-new-repo.md).

For the *Anthropic/GSD* skills the workflow routes to, apply `skillOverrides` in **your own** `.claude/settings.json` (a plugin cannot apply these for you) — see [`docs/adding-to-new-repo.md`](docs/adding-to-new-repo.md).

### Safety & approval gates

Never done without explicit approval: deploy to production · merge PRs · push protected branches · write production data · access/expose secrets · send messages · submit forms/applications · purchases · public posts · change billing/model/provider routes · change security settings · destructive shell · enable paid Firecrawl/API modes · start Jules API sessions. The `approval-request` skill presents action, risk, diff/payload preview, and rollback before proceeding; the hooks above enforce it deterministically.

## Architecture

```
User / issue / PR / backlog item
  → GitKraken Kepler        task, worktree, branch/session, diff, stage/commit/PR
  → Claude Code supervisor  GSD routing, intent/architecture/risk, executor choice, approvals
  → Context & planning      Voidarch Context (graph/memory/context packs) · repo-explorer · Context7 · Firecrawl (gated)
  → Execution               implementation-worker · test-debugger · Jules (async PR)
  → Verification            tests/lint/typecheck/build/CI · pr-reviewer · security-reviewer
  → Observability+approval  .agent-runs logs · Studio dashboard · rollback · human approval
```

Operating rule: **GSD controls phases · Karpathy rules constrain coding · Kepler/GitKraken controls Git state · the repo graph controls discovery · Claude supervises · subagents execute local · Jules executes async PRs · Context7 = docs · Firecrawl = gated web · hooks = safety · observability = audit · the user approves irreversible actions.**

## Development

```bash
pnpm install                     # workspace: root + packages/voidarch-context
npx tsc --noEmit                 # typecheck everything
bash scripts/dfc-validate-hooks.sh   # hook harness (39 checks)
claude plugin validate .         # plugin manifest
cd packages/voidarch-context && npm pack --dry-run   # package contents
cd studio && swift build         # native app (macOS 14+, Xcode 26.6 verified)
```

The `pnpm dfc:*` root scripts are thin aliases into `packages/voidarch-context/scripts/` and `scripts/`; the hook and skill layers call them, so they stay stable. Smoke-test the packed CLI end-to-end by installing the tarball into a scratch repo and running `init → ingest → search → context → remember → status → doctor → serve`.

Historical specs (pre-rename naming, kept as history): [`docs/mvp/`](docs/mvp/), [`docs/dev-flow-control-spec.md`](docs/dev-flow-control-spec.md), [`docs/spec-delta-surrealdb.md`](docs/spec-delta-surrealdb.md), [`docs/postmerge-validation-and-roadmap.md`](docs/postmerge-validation-and-roadmap.md).

## Legacy naming & compatibility

This project was built as **dev-flow-control** (`dfc`), then split as **Nox / Nox Studio**, and is now **Voidarch Context / Voidarch Studio**. Compatibility is deliberate and minimal:

| Legacy | Status |
|---|---|
| `.nox/config.json`, `.dfc/dev-memory/`, `.noxignore` | read as fallbacks; new writes go to `.voidarch/` and `.voidarchignore` |
| `NOX_EMBED_*` env vars | deprecated aliases for `VOIDARCH_EMBED_*` |
| `DFC_*` env vars | legacy internal config keys; still canonical in code, win over aliases |
| `pnpm dfc:*` scripts, `dfc-*.ts` filenames | legacy internal aliases/filenames; hooks/skills depend on them |
| `/dfc-*` skill names | kept for muscle memory; may be renamed in a later major |
| `nox` bin, `dfc:` CLI prefix | removed — use `voidarch-context`; `page` is a deprecated alias of `serve` |
| `graphify-surreal` | not a remnant — the real name of the external, optional Rust graph producer |

## Roadmap

- **Voidarch Context:** Tree-sitter upgrade for the built-in graph builder (today: regex-level TS/JS/Python), auto-embed on ingest + hybrid ranking, first-class Claude Code plugin package, memory sync/export between machines.
- **Voidarch Studio:** module framework + subscription-first provider routing (tracked in issues), deeper native panels in the SwiftUI shell, context packs attached to agent runs, future MLX-powered local assistance.
- **Validation:** live plugin-session testing across repos, and the efficiency benchmark (`templates/docs/efficiency-benchmark.md`) before any token-savings claim.

## License

MIT
