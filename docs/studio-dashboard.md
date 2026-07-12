# Voidarch Studio dashboard — agent control room

This dashboard is the **Voidarch Studio MVP surface** (product split + feature flags:
[`mvp/nox-and-nox-studio-mvp.md`](mvp/nox-and-nox-studio-mvp.md)).

`pnpm dfc:dashboard [--repo-root /path/to/repo] [--port 4949]` → http://127.0.0.1:4949

For the small Voidarch Context setup/status page, use `voidarch-context serve`.
That page is intentionally limited to setup, counts, embeddings, graph freshness, search,
and context-pack preview. It is not this Studio control room.

Single-page, aurora-dark control room for a repo's AI development workflow. Local-only
(binds 127.0.0.1). Frontend lives in [`dashboard/`](../dashboard/) (plain HTML/CSS/JS,
no dependencies); the server is [`scripts/dfc-dashboard.ts`](../scripts/dfc-dashboard.ts).

## Panels (collapsible, `Jump to…` in the header)

| Panel | Shows | Source |
| --- | --- | --- |
| Control Room | repo/branch state, live agents, needs-attention list (blockers, stale tasks, failing health, stale graph, unverified sessions, dirty tree) | all of the below |
| Agents | **launcher** (headless `claude -p`), run history that survives restarts, per-run inspect/retry/resume/kill, cost/turns/duration/session-id, run-comparison table, clickable hooked-session detail | spawned processes + `.agent-runs/dashboard-agents/` + `.agent-runs/sessions/` |
| Workflows | expandable cards: steps, run history (status/turns/cost/result), **Run ▸** launches a headless agent that executes the workflow | `workflows/*.js`, `.claude/workflows/*.js` meta blocks + workflow-tagged agent runs |
| Code Map | **visual**: canvas force graph (search, click-to-focus, community colors, drag/pan/zoom, ⛶ fullscreen). **systems**: node-based architecture map — communities drawn as system bubbles sized by content, edges weighted by cross-system dependency counts; click a system for partners + key members, click a member for full node detail (file facts, uses/used-by, siblings, related memory, related vectors). Copy-ref and delegate-to-launcher on every card | `graphify-out/graph.json` + `/api/node` |
| Tasks | expandable todo cards: status, agent, tags, timestamps, linked blockers, related runs, copy-ref, delegate | dev-memory `task` + `blocker` tables |
| Vectors | embedding provider/model/approval status, chunk coverage (embedded vs pending), per-file coverage worst-first, Embed-now action | `resolveEmbedConfig` + `doc_chunk`/`embedding_chunk` |
| Config | edit assistant (key/base URL/model/tool rounds), embeddings (provider/model/dimension/approval/key), launch + routing defaults — saved to gitignored `.dfc/{mercury,embed,nox}.env`; secrets shown as presence only | `/api/config` |
| Memory & Retrieval | table counts, open tasks/blockers, recent decisions/lessons/repo facts/snippets/evidence/agent runs | SurrealDB dev-memory |
| Metrics | runs/tasks/blockers, memory growth, retrieval usage, staleness, tool activity | `collectMetrics()` |
| Token Usage | real input/output/cache tokens by model/day/session + retrieval context-pack estimates | Claude Code transcripts (`~/.claude/projects/<munged repo or parent>/`) + `context_pack` rows |
| Sync & Backend | embedded vs hosted mode, database identity, SurrealKV LOCK state, hosted-sync availability, `dfc:sync` commands | `.dfc` config + data dir |
| Observability | tri-state status (hooks not attached / configured-no-data / flowing) with the concrete next action, recent tool events, scoped approvals | `.agent-runs/` |
| Plugin Health | manifest/hooks/jq/skills/agents/graph/memory/Mercury checks | plugin files |

Token sources: transcripts are matched for the repo root **and its direct parent only**
(workspace layouts); override with `DFC_TRANSCRIPTS_DIR`.

## Deploying agents

The Agents panel spawns headless CLI agents in the target repo across five providers:

| Provider | Command | Models | Effort |
| --- | --- | --- | --- |
| claude | `claude -p … --output-format stream-json --model <m> --effort <e>` | fable, opus, sonnet, haiku | low/medium/high |
| codex | `codex exec -m <m> -c model_reasoning_effort="<e>" …` | gpt-5.5-codex, gpt-5.5 | low/medium/high |
| grok | `grok -p … -m <m>` | composer-2.5 | — |
| gemini | `gemini -p … -m <m>` | gemini-3.5-flash, gemini-3.1-pro | — |
| copilot | `copilot -p … --model <m>` | default, gpt-5.5 | — |

The **Main agent** preset dropdown fills provider/model/effort in one click; the
`launch-preview` line shows the exact command before deploy. Non-claude providers get
the routing block prepended to the prompt (no `--append-system-prompt` equivalent) and
stream plain text (no cost/turns — duration is measured; result = output tail).

**Testing/verification runs are pinned to Haiku**: the "testing/verify" preset sends
`purpose: "verify"` and the server force-clamps provider/model to claude/haiku — a
request for fable with purpose=verify launches haiku (verified live).

Permission mode defaults to `acceptEdits`; `plan` is read-only. `bypassPermissions` is
intentionally not offered.

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

Runs survive dashboard restarts: the first JSONL line is a `dfc_meta` record (prompt,
mode, tools, workflow, started_at), and the server rehydrates history from
`.agent-runs/dashboard-agents/*.jsonl` on every listing. Per-run controls:

- **inspect** — replay the full logged activity feed (`GET /api/agents/:id/log`);
- **retry** — relaunch with the same prompt/mode/tools (`POST /api/agents/:id/retry`);
- **resume** — continue the same Claude session (`claude --resume <session_id>`) with a
  follow-up prompt (`POST /api/agents/:id/resume`);
- **kill** — running agents only.

Each finished run shows turns, cost, duration, and session id captured from the
stream-json `result` event; a comparison table summarizes the last runs. Workflow cards'
**Run ▸** posts `/api/workflows/run`, which deploys an agent instructed to execute the
workflow script via the Workflow tool — runs are tagged and listed as the card's history.

## Interactive sessions

The **Sessions** panel (backed by [`scripts/studio-sessions.ts`](../scripts/studio-sessions.ts))
runs real PTYs — via `node-pty` — for `claude`, `codex`, or a plain shell, streamed to the
browser over WebSocket and rendered with xterm.js. The daemon, not the desktop shell, owns
the child process: sessions **survive closing the Tauri app or the browser tab**, and are
only marked `orphaned` (transcript preserved) if the daemon itself restarts. Transcripts
and resume metadata live at `.agent-runs/studio-sessions/<id>/{meta.json,transcript.log}`.

Built-in provider profiles (`~/.voidarch-studio/providers.json` overrides/extends these):
`claude-code` (resume via `claude -c`), `codex-cli` (resume via `codex resume --last`),
`generic-shell`. Because the API is plain HTTP + WebSocket, **any harness can drive it** —
this isn't limited to Claude Code; it's cross-harness orchestration.

```bash
# register a repo, then launch a session
curl -s -X POST http://127.0.0.1:4949/api/sessions \
  -H 'content-type: application/json' \
  -d '{"repo":"/path/to/repo","profileId":"claude-code","prompt":"fix the flaky test"}'
# -> { "id": "s-...", "status": "running", ... }

# send keystrokes/text to a running session
curl -s -X POST http://127.0.0.1:4949/api/sessions/s-xxxx/input \
  -H 'content-type: application/json' -d '{"data":"y\n"}'

# interrupt (Ctrl-C), terminate, or force-kill
curl -s -X POST http://127.0.0.1:4949/api/sessions/s-xxxx/signal \
  -H 'content-type: application/json' -d '{"signal":"SIGINT"}'
```

Attach a terminal client to `ws://127.0.0.1:4949/ws/sessions/s-xxxx` for the live stream
(send `{"t":"i","d":"..."}` to type, `{"t":"r","cols":..,"rows":..}` to resize).

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
