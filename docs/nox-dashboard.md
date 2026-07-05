# Nox dashboard — agent control room

`pnpm dfc:dashboard [--repo-root /path/to/repo] [--port 4949]` → http://127.0.0.1:4949

Single-page, aurora-dark control room for a repo's AI development workflow. Local-only
(binds 127.0.0.1). Frontend lives in [`dashboard/`](../dashboard/) (plain HTML/CSS/JS,
no dependencies); the server is [`scripts/dfc-dashboard.ts`](../scripts/dfc-dashboard.ts).

## Panels (collapsible, `Jump to…` in the header)

| Panel | Shows | Source |
| --- | --- | --- |
| Control Room | repo/branch state, live agents, needs-attention list (blockers, stale tasks, failing health, stale graph, unverified sessions, dirty tree) | all of the below |
| Agents | **launcher** (headless `claude -p`), deployed-agent feeds/results/kill, hooked-session history with active state | spawned processes + `.agent-runs/sessions/` |
| Workflows | bundled + repo workflow definitions (name, phases, when-to-use) | `workflows/*.js`, `.claude/workflows/*.js` meta blocks |
| Code Map | interactive canvas force graph: search, click-to-focus neighborhood, community colors, drag/pan/zoom | `graphify-out/graph.json` |
| Memory & Retrieval | table counts, open tasks/blockers, recent decisions/lessons/repo facts/snippets/evidence/agent runs | SurrealDB dev-memory |
| Metrics | runs/tasks/blockers, memory growth, retrieval usage, staleness, tool activity | `collectMetrics()` |
| Token Usage | real input/output/cache tokens by model/day/session + retrieval context-pack estimates | Claude Code transcripts (`~/.claude/projects/<munged repo or parent>/`) + `context_pack` rows |
| Sync & Backend | embedded vs hosted mode, database identity, SurrealKV LOCK state, hosted-sync availability, `dfc:sync` commands | `.dfc` config + data dir |
| Observability | recent tool events, scoped approval records | `.agent-runs/` |
| Plugin Health | manifest/hooks/jq/skills/agents/graph/memory/Mercury checks | plugin files |

Token sources: transcripts are matched for the repo root **and its direct parent only**
(workspace layouts); override with `DFC_TRANSCRIPTS_DIR`.

## Deploying agents

The Agents panel spawns `claude -p "<prompt>" --output-format stream-json --verbose
--permission-mode <mode>` in the target repo. Defaults to `acceptEdits`; `plan` is
read-only. `bypassPermissions` is intentionally not offered.

**Tool routing:** the launcher's dropdowns (Workflow: native/Superpowers/GSD ·
Subagents: native dynamic / native pinned model+effort / Antigravity dynamic or pinned /
Codex · Search: WebSearch/Playwright/Firecrawl · Docs: web search/Context7 ·
Git: CLI/GitKraken) are composed server-side into a "Tool routing for this run" block and
injected via `--append-system-prompt`. `(agent default)` selections add nothing. The
composed prompt is shown on the agent card. Verified live: a plan-mode agent echoed the
injected block back.

Every run:

- streams a compacted activity feed + final result into the panel, with a kill button;
- appends the raw stream-json to `.agent-runs/dashboard-agents/<id>.jsonl`;
- strips `CLAUDECODE`/`CLAUDE_CODE_*` from the child env so launches work even when the
  dashboard itself was started from inside a Claude session.

Spawned agents live in server memory — restarting the dashboard clears the list (the
JSONL logs remain).

## Mercury assistant (read-only)

`✦ Assistant` opens a chat drawer backed by an OpenAI-compatible API (Inception Labs
Mercury by default). Configure by copying
[`.dfc/mercury.example.env`](../.dfc/mercury.example.env) to `.dfc/mercury.env`
(gitignored) and setting:

```bash
MERCURY_API_KEY=...                                # required
# MERCURY_BASE_URL=https://api.inceptionlabs.ai/v1 # default
# MERCURY_MODEL=mercury-2                          # default
```

Restart the dashboard after editing. The assistant runs a server-side tool loop
(max 6 rounds) with four **read-only** tools: `search_graph`, `graph_neighbors`
(graphify data), `search_memory` (BM25 over the five memory kinds + open tasks/blockers),
and `get_state` (health/sessions/sync/metrics/token snapshot). Without a key the panel
stays visible and returns a configuration hint.

## Concurrency note (embedded SurrealKV)

SurrealKV allows one process at a time. The dashboard serializes all its own DB access
through a queue and opens/closes per query, so `dfc` CLI commands can run between
refreshes — but a long CLI command can still make a refresh time out (it degrades to the
cached panel; use "Query SurrealDB now" to retry).
