# Nox and Nox Studio — MVP Specification

Status: adopted 2026-07-05. This is the canonical product-split document for the
`dev-flow-control` repository. It supersedes the accidental draft that briefly lived on
the `docs/nox-mvp-fable-prompts` branch (recovered and adapted here).

Two products are emerging from this repo:

1. **Nox** — a lightweight, plug-and-play repo **memory and query engine** for coding agents.
2. **Nox Studio** — a heavyweight, power-user **agent orchestration control room**.

The repo remains one codebase and one Claude Code plugin for now; the split is a product
and packaging boundary, not (yet) a repo split.

## Product boundary rule

Decide where every feature belongs with one rule:

- If it **retrieves, remembers, indexes, searches, or explains repo context** → **Nox**.
- If it **launches, routes, controls, observes, approves, or manages agents** → **Nox Studio**.

Nox must stay boring, small, and reusable. Studio is allowed to be ambitious, modular,
and power-user oriented. Studio calls into Nox for retrieval; it never reimplements it.

## Truthful runtime state (resolves issue #17)

- This repo is a **TypeScript/npm package**. The canonical command surface is the
  `pnpm dfc:*` scripts (tsx entrypoints in `scripts/`). There is **no Rust rewrite of the
  CLI in this repo**.
- The only Rust component is **`graphify-surreal`**, an **external, optional** graph fact
  producer (separate repo, `cargo build --release -p graphify-surreal`). `pnpm dfc:graph:build`
  locates it via `GRAPHIFY_SURREAL_BIN`, `PATH`, or `~/Dev/graphify-surreal/target/release/`,
  and prints build instructions when missing. Without it, `pnpm dfc:graph:import` (graphify
  JSON) is the fallback graph path.
- The dashboard server entrypoint is `scripts/dfc-dashboard.ts` (`pnpm dfc:dashboard`);
  the frontend is dependency-free HTML/CSS/JS in `dashboard/`.
- Package and plugin versions are aligned (see `package.json` and
  `.claude-plugin/plugin.json`).
- Smoke checks for the canonical CLI: `pnpm exec tsc --noEmit`, `pnpm dfc:memory:doctor`
  (works without a database), `pnpm dfc:validate-hooks`, `pnpm dfc:flags`.
- The Claude skills and the plugin manifest are thin wrappers — **the CLI is the contract**.

## Nox MVP (memory engine)

**Target user:** a developer on Claude Code, Codex, Cursor, Gemini CLI, or any coding
agent who wants local repo memory and context packs without an orchestration cockpit.

**User promise:** add local repo memory, search, graph, vectors, and context-pack
retrieval to an agent workflow in minutes — locally, with **no paid API key required**.

**Install goal (happy path):**

```bash
pnpm install
pnpm dfc:init          # idempotent scaffold
pnpm dfc:ingest
pnpm dfc:context --task "what do I need for this task?"
```

No Docker, no Rust, no SurrealDB server, no GitHub/Vercel token, no paid key. Embedded
SurrealKV (`.dfc/dev-memory/`) is the default backend; hosted SurrealDB is an optional
advanced configuration.

**MVP command surface** (`pnpm dfc:*` remains the compatibility contract; the `nox`
package bin aliases the Nox memory/query commands):

| Capability | Command | State |
| --- | --- | --- |
| init / scaffold | `dfc:init` | implemented |
| file ingest (BM25) | `dfc:ingest` | implemented |
| docs ingest / query | `dfc:docs:ingest`, `dfc:docs:query` | implemented |
| context pack | `dfc:context` | implemented |
| memories (5 kinds) | `dfc:remember`, `dfc:memory` | implemented |
| task / blocker state | `dfc:task`, `dfc:blocker` | implemented |
| graph | `dfc:graph:build` (Rust producer) / `dfc:graph:import` (JSON), `dfc:graph:query`, `dfc:graph:status` | implemented |
| vectors | `dfc:embed`, `nox embed` | implemented; local no-key default |
| status / doctor | `dfc:status`, `dfc:memory:doctor`, `dfc:memory:gc`, `nox status`, `nox memory doctor`, `nox memory gc` | implemented |
| metrics / sync | `dfc:metrics`, `dfc:sync` | implemented |
| minimal Nox page | `dfc:nox`, `nox page` | implemented |

**Embedding rules (hard):**

- The default embedding path works **locally without paid API keys**:
  Transformers.js auto-downloads a small ONNX MiniLM model on first run and caches it
  outside the repo (override with `DFC_EMBED_CACHE_DIR` only when intentional).
- Embeddings dedupe by **content hash** (already implemented).
- An **OpenAI-compatible endpoint** (base URL + key env var + model + dimensions) is the
  optional alternative.
- **Paid embedding calls never happen silently**: explicit
  `DFC_EMBED_PROVIDER=openai`, plus `OPENAI_API_KEY` **and** approval
  (`DFC_EMBED_APPROVED=1` or `--approve`) for the paid path. This gate is live today
  and must survive every refactor.

**Local page:** Nox itself has only a minimal setup/status page (`pnpm dfc:nox` or
`nox page`): setup commands, indexed counts, embedding status, graph freshness, memory
counts, search form, and context-pack preview. The full control room is Studio, not
Nox.

**Out of scope for Nox:** agent launcher, worktree manager, terminals, provider/quota
routing, prompt registry, MCP/hook gateway, PR automation, GitHub/Vercel panels,
observability timeline, SwiftUI app, MLX requirement.

## Nox Studio MVP (agent orchestration room)

**Target user:** a power user running multiple coding agents who wants a local agent
development environment: launching, isolating, routing, observing, governing.

**User promise:** a local power-user control room for running, routing, observing, and
governing coding agents — with repo intelligence supplied by Nox.

**MVP = the existing dashboard surface, preserved and honestly labeled.** The current
Nox dashboard (`pnpm dfc:dashboard`, `docs/nox-dashboard.md`) is the Studio MVP. MVP does
not require the advanced modules to be live; it requires the working surface to be
accurately documented, feature-flagged, and never misrepresented as complete.

Current surface, honestly stated:

| Capability | State |
| --- | --- |
| Control room / needs-attention, panels, health | live |
| Agent launcher (headless `claude -p`, stream-json, kill/retry/resume/inspect, durable run history) | live-verified for claude |
| Multi-provider launch (codex/grok/gemini/copilot) | implemented; plain-text streaming; not all providers live-verified |
| Verification runs clamped to claude/haiku (`purpose: "verify"`) | live-verified |
| Tool-routing injection via `--append-system-prompt` | live-verified |
| Workflows panel (meta from `workflows/*.js`, Run ▸) | live |
| Code map (force graph + systems view + "How this repo works" narrative) | live |
| Tasks panel (add / status from UI) | implemented 2026-07-05 (endpoints smoke-tested) |
| Vectors panel + Embed-now | implemented; embedding provider approval-gated |
| Token usage from Claude transcripts | live |
| Memory / metrics / sync / observability / plugin health | live |
| Mercury read-only assistant | live-verified with key |

**Out of scope for Studio MVP:** Vercel write actions, deployment promotion, auto-merge,
full MCP federation, live quota scraping for providers without quota APIs, native SwiftUI
app, mandatory MLX pipeline, destructive Git/GitHub actions without explicit approval.

## Provider quota routing rule

Architecture defaults **prioritize subscription-based quota models** (Claude Code
desktop/CLI subscription, Codex/Copilot/Gemini subscriptions, cached-login Grok) over
API-key multi-provider billing gateways. Paid/API-backed routes (API gateways,
`ANTHROPIC_BASE_URL`, OpenRouter/Bedrock/Vertex, paid embedding APIs) are opt-in,
explicit, and approval-gated — the same "never silently paid" rule as embeddings.
The Grok 24h cooldown and the haiku verify-clamp are the existing seeds of the future
quota controller (issue #9).

## Feature flags

Registry lives in [`src/flags.ts`](../../src/flags.ts) and prints via `pnpm dfc:flags`.
Statuses: `planned` (nothing built) · `scaffolded` (code exists, off) · `experimental`
(on, unstable) · `stable`. A flag being listed is **not** a claim that it works — the
status is the claim, and it must stay truthful.

Nox flags: `memory.localEmbeddings` (stable), `memory.openaiCompatibleEmbeddings`
(stable, approval-gated), `memory.graph` (stable), `memory.contextPackExplain`
(experimental), `memory.lifecycle` (scaffolded).

Studio flags: see `src/flags.ts` — `studio.worktrees`, `studio.terminal`,
`studio.promptRegistry`, `studio.providerRouter`, `studio.quotaTracking`,
`studio.mcpGateway`, `studio.hookGateway`, `studio.github`, `studio.vercelReadonly`,
`studio.observabilityTimeline`, `studio.contextPackPreview`, `studio.memoryLifecycle`,
`studio.workflowPlaybooks`, `studio.mlxEmbeddings`, `studio.swiftuiNativeApp`,
`studio.aguiEvents`.

## Planned additions (Function / Form / Reason)

| Addition | Function | Form | Reason | Issue |
| --- | --- | --- | --- | --- |
| Worktrees | Create, track, and clean up isolated git worktrees per agent run; promote to PR | `studio.worktrees` module: server endpoints + panel; wraps `git worktree` | Agents editing the main checkout collide with the user and each other | — (Part 3) |
| Integrated terminal | Attach PTY sessions to runs/worktrees inside Studio | `studio.terminal`: node-pty backend + xterm panel | Killing/inspecting headless runs without a separate terminal app | — (Part 3) |
| GitHub read-only monitoring | Surface PR/check/review state for the repo's branches | `studio.github`: read-only API polling, links out | PR state belongs in the needs-attention loop; writes stay manual/approved | [#15](https://github.com/pappdavid/dev-flow-control/issues/15) (drift), Part 3 |
| Vercel read-only monitoring | Show deployment status/URLs for linked projects | `studio.vercelReadonly`: read-only API panel | Deploy state without granting deploy power | — (Part 3) |
| MCP gateway | Central allow/deny + observability for MCP tool traffic | `studio.mcpGateway`: proxy config + policy file | One choke point instead of per-agent MCP sprawl | [#13](https://github.com/pappdavid/dev-flow-control/issues/13) adjacent |
| Hook gateway | Serve/enforce the fail-closed hook policy for launched agents | `studio.hookGateway`: policy registry reused by launcher | Hooks are per-repo files today; launched agents should inherit them uniformly | — (Part 3) |
| Prompt registry | Versioned system prompts/presets for agent launches | `studio.promptRegistry`: DB table + panel + launcher pick | Reproducible launches; prompt drift is invisible today | [#10](https://github.com/pappdavid/dev-flow-control/issues/10) |
| Provider quota routing | Track quota windows/cooldowns/fallback chains; route subscription-first | `studio.providerRouter` + `studio.quotaTracking`: routing table consulted by launcher/CLI | Prevent burning the wrong quota or silently falling back to paid APIs | [#9](https://github.com/pappdavid/dev-flow-control/issues/9) |
| Memory lifecycle | Provenance, staleness, merge, and promotion for memories | `memory.lifecycle` in Nox; Studio panel on top | Memory that only grows becomes noise | [#12](https://github.com/pappdavid/dev-flow-control/issues/12) |
| Query planner | One planner over BM25/graph/vector/run channels | Nox: extends `context-pack.ts` scoring | Channel fusion is heuristic today; planner makes it explainable | [#11](https://github.com/pappdavid/dev-flow-control/issues/11) |
| Context pack preview & scoring feedback | Preview packs, score usefulness, feed back into ranking | `studio.contextPackPreview` panel over Nox data | Close the retrieval quality loop | [#16](https://github.com/pappdavid/dev-flow-control/issues/16) |
| Workflow playbooks | Reusable execution playbooks for agent runs | `studio.workflowPlaybooks`: extends `workflows/*.js` | Repeatable multi-step agent work beyond 3 bundled workflows | [#14](https://github.com/pappdavid/dev-flow-control/issues/14) |
| Observability timeline | Trace model + timeline UI for agent runs | `studio.observabilityTimeline` over `.agent-runs/` + DB | Post-hoc debugging of multi-agent sessions | [#13](https://github.com/pappdavid/dev-flow-control/issues/13) |
| MLX acceleration | Apple-silicon-accelerated local embeddings | `studio.mlxEmbeddings` / provider under `memory.localEmbeddings` | Faster local embedding without paid APIs; never a requirement | — (Part 2/3) |
| AG-UI event model | Standard event protocol between Studio backend and UI | `studio.aguiEvents`: event schema over current SSE/polling | Decouples future native/SwiftUI clients from the HTML frontend | — (Part 3) |
| SwiftUI native app | Native macOS Studio client | `studio.swiftuiNativeApp`, consumes AG-UI events | Power-user ergonomics beyond the browser | — (Part 3) |

## Implementation split (tracked)

Three PR-sized parts. Part 1 was executed in the 2026-07-05 consolidation run.

### Part 1 — Stabilize and document the product split (**done 2026-07-05**)

Version metadata aligned, this spec written, feature-flag registry scaffolded
(`src/flags.ts` + `pnpm dfc:flags`), branches/worktrees consolidated, README/AGENTS.md
updated, issue #17 resolved. Tracking: issue #17 (closed by this part).

### Part 2 — Nox memory-engine MVP hardening

Local no-key embedding default (auto-download, cache outside repo, content-hash dedupe),
OpenAI-compatible endpoint config polish, minimal Nox setup/status page (subset of
dashboard, no Studio panels), query planner seed, memory lifecycle seed, npm-first
packaging pass (`nox` bin alias).
Tracking: [#11](https://github.com/pappdavid/dev-flow-control/issues/11),
[#12](https://github.com/pappdavid/dev-flow-control/issues/12),
[#16](https://github.com/pappdavid/dev-flow-control/issues/16); tracking issue
[#18](https://github.com/pappdavid/dev-flow-control/issues/18).

### Part 3 — Nox Studio module framework

Feature-flag-gated module loading in the dashboard server, provider quota routing
controller (subscription-first), prompt registry, observability timeline, GitHub/Vercel
read-only panels, worktree manager design, MCP/hook gateway design.
Tracking: [#9](https://github.com/pappdavid/dev-flow-control/issues/9),
[#10](https://github.com/pappdavid/dev-flow-control/issues/10),
[#13](https://github.com/pappdavid/dev-flow-control/issues/13),
[#14](https://github.com/pappdavid/dev-flow-control/issues/14),
[#15](https://github.com/pappdavid/dev-flow-control/issues/15); tracking issue
[#19](https://github.com/pappdavid/dev-flow-control/issues/19).

## Consolidation record (2026-07-05)

- Uncommitted dashboard work (task management UI/API, systems narrative, real provider
  model ids) finished, typecheck-fixed (`db.merge` → `UPDATE … MERGE` query), committed,
  and pushed with the two pending Nox commits.
- Deleted merged/superseded branches, local and remote: `codex/docs-new-repo-onboarding`,
  `docs/full-openai-embedding-validation`, `embedding/openai-text-embedding-3-small`,
  `integration/grok-build-worker`, `memory/docs-graph-vector-substrate`,
  `postmerge/live-plugin-memory-validation`, `surrealdb/shared-dev-memory`,
  `codex/surreal-dev-memory` (fork slice superseded by PR #1's adapted merge).
- Removed both superpowers worktrees (clean).
- **Kept** local branch `feature/graphify-surreal` (400-line JSON-bridge integration,
  never pushed): superseded by `dfc:graph:build`'s direct Rust bridge on main. Safe to
  delete once confirmed nothing in it is still wanted; kept to avoid silently discarding
  local work.
- `docs/nox-mvp-fable-prompts` remote branch (net-zero diff; draft spec added then
  removed) deleted after adapting its content into this document.

## Verification commands

```bash
pnpm install
pnpm exec tsc --noEmit
pnpm dfc:validate-hooks
pnpm dfc:flags
claude plugin validate .
pnpm dfc:dashboard --port 4951   # boots; / returns 200
```
