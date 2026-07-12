# Nox Memory and Nox Studio MVP Specification (v2 — canonical)

> Superseded: the native shell is now Tauri (`studio-tauri/`) and the daemon owns PTY sessions — see README.

> Working names. “Nox” is a placeholder. The important split is between the drop-in memory/query engine and the power-user orchestration studio.

> **Adopted 2026-07-05.** Supersedes [`nox-and-nox-studio-mvp.md`](nox-and-nox-studio-mvp.md)
> where they disagree (notably: worktrees, integrated terminal, and the native app move
> from "Part 3 design docs" into the Studio MVP itself). Decisions locked with the owner:
>
> 1. **Packaging:** same repo, separated internally — pnpm workspace with
>    `packages/nox-memory` (engine) while the plugin + Studio stay at the root.
>    A tracked issue covers the eventual multi-repo split.
> 2. **Distribution:** local-only for now — `npm pack` tarball installed into a fresh
>    repo is the acceptance test. No registry publish (repo is private); the package
>    name (`nox-memory` placeholder) will likely be renamed.
> 3. **Studio build approach:** hybrid SwiftUI shell — native sidebar, Tasks, Worktrees,
>    Runs, and terminal (SwiftTerm); Context-pack/Memory/Repo panels embed the existing
>    dashboard views via WKWebView against the local daemon (the extended
>    `dfc-dashboard.ts` server). Panels go fully native post-MVP.
> 4. **Timeline:** Nox Memory MVP today (2026-07-05); Nox Studio MVP tomorrow (2026-07-06).

---

## Product Split

| Product | Role | Primary user | Install expectation |
|---|---|---|---|
| **Nox Memory** | Drop-in local memory and repo query engine for AI coding agents | Anyone using Claude Code, Codex, Gemini CLI, Grok CLI, Cursor, OpenCode, or custom agents | `npm install`, works in minutes |
| **Nox Studio** | Native/local power-user cockpit for launching, isolating, routing, and observing agents | Power users running multiple coding agents across repos | Native app / local daemon, optimized for Apple Silicon |

### Boundary rule

If it **indexes, remembers, searches, embeds, queries, or generates context packs**, it belongs in **Nox Memory**.

If it **launches, routes, isolates, observes, approves, terminals, manages worktrees, or integrates GitHub/Vercel/providers**, it belongs in **Nox Studio**.

---

# MVP 1: Nox Memory

## One-line description

**Drop-in local memory and repo query engine for AI coding agents.**

## Product goal

Nox Memory provides a near-zero-pain local repo memory and retrieval layer. It should let a user install one npm package, index a repo, and generate useful context packs for AI coding agents without requiring cloud accounts, Docker, Python, Rust, manual database setup, or an API key.

The user should be able to install and use it in a few minutes. Radical, yes. Apparently software can respect time when threatened.

## MVP promise

A user can run:

```bash
npm install -D <package>
npx nox init
npx nox ingest
npx nox context "fix the dashboard route issue"
npx nox serve
```

and get:

- local repo index
- local embeddings by default
- optional OpenAI-compatible embedding endpoint
- graph/search/vector hybrid retrieval
- memory store
- context pack output
- small self-hosted local info/search page
- lightweight agent/plugin integration

Target setup time: **under 5 minutes**.

## Core user flow

```text
install package
→ init repo
→ ingest files
→ build local index and embeddings
→ search/query repo
→ generate context pack
→ paste/use context in agent
→ optionally remember decisions/lessons
→ inspect via local info page
```

## MVP scope

### 1. Install and init

Required:

- npm package with CLI binary
- `nox init`
- creates `.nox/config.json`
- adds runtime storage to `.gitignore`
- detects repo root
- detects basic language stack
- asks minimal setup questions only if needed

Default setup:

- local embeddings
- embedded/local DB
- no external API key
- no GitHub token
- no Vercel token
- no cloud account
- no Docker
- no manual model download

### 2. Local embedded storage

Required:

- embedded SurrealDB or equivalent local storage adapter
- local runtime files ignored by Git
- stores files, chunks, embeddings, graph nodes/edges, memories, query events, and context packs
- schema versioning
- migration command

Commands:

```bash
nox db status
nox db migrate
nox doctor
```

MVP does **not** need raw DB versioning. Runtime DB state stays local. Durable exports can be added later.

### 3. Repo ingestion

Required:

- respect `.gitignore`
- support `.noxignore`
- skip generated/vendor folders by default:
  - `node_modules`
  - `.next`
  - `dist`
  - `build`
  - `.git`
  - `coverage`
- chunk source and documentation files
- hash files and chunks
- incremental re-ingest based on hashes
- Tree-sitter or lightweight syntax extraction for supported languages
- fallback text chunking for unsupported files

MVP language/file support:

- TypeScript / JavaScript
- Markdown
- JSON / YAML / TOML
- Python optional but useful

### 4. Embeddings

Required:

- local default embedding model
- automatic first-use model download and cache
- OpenAI-compatible embedding provider option

Default local path:

```text
provider = local
model = small sentence embedding model
runtime = Transformers.js / ONNX-style runtime
cache = ~/.cache/<tool>/models
```

Remote OpenAI-compatible config:

```env
NOX_EMBED_PROVIDER=openai-compatible
NOX_EMBED_BASE_URL=https://api.openai.com/v1
NOX_EMBED_MODEL=text-embedding-3-small
NOX_EMBED_API_KEY=...
NOX_EMBED_DIMENSIONS=optional
```

Commands:

```bash
nox models status
nox models install
nox embed
nox config embedding local
nox config embedding openai-compatible
```

The npm package should not physically bundle a giant model in the tarball. First ingest can download the local model automatically and cache it. Giant install packages are how goodwill goes to die.

### 5. Hybrid retrieval

Required modes:

- text/keyword search
- vector search
- graph neighborhood search
- hybrid context-pack generation

Commands:

```bash
nox search "approval gate"
nox query "where is repo indexing handled?"
nox context "fix failed PDF render"
```

MVP query routing can be simple:

| Query type | Retrieval path |
|---|---|
| exact file/symbol-ish query | text + graph |
| fuzzy task query | vector + graph |
| context pack request | hybrid with token cap |

### 6. Memory

MVP memory kinds:

- `decision`
- `lesson`
- `repo_fact`
- `snippet`
- `task_note`

Required fields:

- id
- kind
- text
- source
- repo id/path
- related files/chunks if known
- created timestamp
- updated timestamp
- optional confidence

Commands:

```bash
nox remember --kind decision "Use embedded SurrealDB for local state."
nox memory list
nox memory search "SurrealDB"
nox memory delete <id>
```

MVP memory management is basic. Advanced lifecycle features belong to v0.2+.

### 7. Context packs

This is the main feature.

`nox context "<task>"` should output:

- relevant files
- relevant chunks
- relevant memories
- relevant graph nodes/edges
- token estimate
- optional suggested verification commands
- compact Markdown by default
- JSON output option

Required options:

```bash
nox context "fix route issue" --format markdown
nox context "fix route issue" --format json
nox context "fix route issue" --max-tokens 5000
nox context "fix route issue" --include-memory
nox context "fix route issue" --include-graph
```

Context packs should be small enough to paste into any agent and structured enough to be used by plugin wrappers.

### 8. Local info page

Command:

```bash
nox serve
```

Local page:

```text
http://127.0.0.1:<port>
```

Required panels:

- status
- indexed files
- chunks
- embedding status
- memory search
- repo search
- context pack builder
- DB health
- setup/config view

This is **not** Nox Studio. It is a small inspector/info page, closer to Graphify-style self-hosted output but more operational.

### 9. Plugin and agent wrappers

Required:

- generic CLI output
- Claude Code slash-command snippets
- AGENTS.md snippet
- optional simple MCP server

Agent-facing capabilities:

```text
search
query
context
remember
status
```

No provider orchestration. No terminal. No tool gateway. That is Studio.

## Nox Memory non-goals

Nox Memory MVP must not include:

- worktree management
- agent launching
- integrated terminal
- provider quota tracking
- GitHub write integration
- Vercel integration
- full observability timeline
- MCP security gateway
- hook emulation
- workflow orchestration
- SwiftUI
- MLX
- native macOS app

## Nox Memory acceptance criteria

Nox Memory MVP is done when:

- fresh repo setup works in under 5 minutes
- no external API key is required
- local embedding works
- ingest works incrementally
- search/query/context work from CLI
- local info page works
- basic memory CRUD works
- generated context pack is useful to an agent
- DB survives restart
- runtime files are ignored correctly
- docs explain setup in one short page

---

# MVP 2: Nox Studio

## One-line description

**Native Apple Silicon cockpit for launching, isolating, routing, and observing AI coding agents.**

## Product goal

Nox Studio is the orchestration layer built on top of Nox Memory. It lets a power user run coding agents through controlled worktrees, prompt profiles, provider/model routing, integrated terminal sessions, observable run traces, and eventually GitHub/Vercel/MCP integrations.

Nox Memory answers:

```text
What context does the agent need?
```

Nox Studio answers:

```text
Which agent should do the work, where, with what tools, under what policy, and what happened?
```

## MVP promise

A user opens Nox Studio and can:

1. register a local repo
2. see Nox Memory index/status
3. create/select a task
4. create an isolated Git worktree
5. choose provider/model/prompt profile
6. generate and preview a context pack
7. launch an interactive agent in an integrated terminal
8. track run output and changed files
9. inspect the result
10. clean up or keep the worktree

That loop is the MVP. Everything else waits outside, sulking.

## Platform and architecture

Primary platform:

- macOS Apple Silicon

Preferred frontend:

- SwiftUI native app

Backend:

- local Nox Studio daemon
- manages PTY/terminal sessions
- manages worktrees
- manages provider launch profiles
- records run state
- calls Nox Memory for indexing/search/context

Optional acceleration:

- MLX-based embedding worker for Studio
- app-managed local embedding model cache
- remote OpenAI-compatible embeddings as override

Important boundary:

Studio may accelerate embeddings with MLX, but Nox Memory must stay easy and cross-platform. The memory package should not require SwiftUI, MLX, Apple Silicon, or a native app.

## Core user flow

```text
open Studio
→ register repo
→ create task
→ create worktree
→ generate context pack
→ choose provider/profile
→ launch agent in terminal
→ stream transcript
→ inspect changed files
→ mark done/blocked/failed
→ clean up or keep worktree
```

## MVP scope

### 1. Native app shell

Required panels:

- Dashboard
- Repos
- Tasks
- Context Pack
- Worktrees
- Terminal
- Runs
- Providers
- Settings

Do not build every dream panel yet. The first Studio should be a cockpit, not a space station with unresolved childhood issues.

### 2. Repo registration

Required:

- add local repo path
- detect `.nox`
- run or trigger `nox init`
- show index status
- show memory status
- show current branch
- show current commit
- show dirty Git state

Nox Studio delegates indexing/query/memory to Nox Memory.

### 3. Task creation

Required task fields:

- id
- title
- description
- priority
- status
- linked repo
- linked worktree
- linked run
- linked context pack

Statuses:

```text
planned
running
blocked
done
failed
```

Task is the center of Studio. Not chat. Not graph art. Task.

### 4. Worktree management

Required:

- create worktree for task
- list worktrees
- show branch
- show base commit
- show dirty state
- show changed files
- remove worktree
- open worktree in terminal

Underlying operations:

```bash
git worktree add
git worktree list
git status
git diff
```

MVP does not need GitHub PR creation yet.

### 5. Integrated terminal

Required:

- PTY-backed terminal panel
- session cwd bound to selected worktree
- launch shell
- launch configured agent command
- stream output
- save transcript
- kill session
- mark run finished/failed

This replaces AppleScript/oscript launch flows. A small mercy in a world full of permission dialogs.

### 6. Provider/model launch profiles

MVP providers:

- Claude Code
- Codex CLI
- generic shell command

Provider profile fields:

- provider id
- display name
- command template
- args template
- default model
- effort/reasoning setting if supported
- env vars
- max runtime
- supports interactive mode
- supports append system prompt
- supports MCP config
- allowed worktree path
- prompt injection mode

MVP does not need live quota API integration. It only needs manual/default quota notes and cooldown status.

### 7. Prompt profile preview

Required:

- prompt profile registry
- simple templates
- final prompt preview before launch
- provider-specific rendering
- prompt hash/version recorded on run

MVP prompt sections:

- role
- task
- repo context pack
- allowed files/actions
- forbidden actions
- verification command
- output expectation

Nox Studio records:

- prompt profile id
- prompt version/hash
- rendered prompt
- provider/model used
- task/run id

No invisible prompt soup. We are trying to govern the chaos, not garnish it.

### 8. Context pack integration

Required:

- call Nox Memory context generator
- preview included files/chunks/memories
- show token estimate
- regenerate context pack
- copy/export context
- attach context pack to run

Context-pack preview fields:

- task input
- selected repo
- token cap
- included files
- included chunks
- included memories
- included graph items
- reason/evidence if available

### 9. Run tracking

Required run fields:

- run id
- task id
- provider
- model
- prompt profile
- worktree
- terminal transcript path
- started timestamp
- finished timestamp
- status
- changed files
- exit code
- notes

MVP timeline events:

- task selected
- worktree created
- prompt generated
- context pack generated
- agent launched
- terminal output saved
- process exited
- changed files detected

No full observability cathedral yet. Just enough to stop guessing what happened.

### 10. Basic Git diff review

Required:

- show changed files in worktree
- show basic diff
- open file path
- mark task done/blocked/failed
- cleanup worktree manually

MVP does not need GitHub PR creation. That belongs to the next milestone.

## Nox Studio non-goals

Nox Studio MVP must not include:

- Vercel integration
- GitHub PR automation
- auto-merge
- MCP gateway
- full hook emulation
- provider quota scraping
- multi-agent scheduling
- advanced memory lifecycle UI
- local LLM inference
- plugin marketplace
- graph animation as a core feature
- cloud sync
- team features

## Nox Studio acceptance criteria

Nox Studio MVP is done when:

- app launches on Apple Silicon macOS
- user can register a repo
- Studio detects/uses Nox Memory
- user can create a task
- user can create a Git worktree for that task
- user can generate and preview a context pack
- user can select provider/profile
- user can launch an interactive agent in integrated terminal
- transcript is saved
- changed files are shown after run
- run/task state persists
- worktree can be cleaned up

---

# Shared Boundary

| Capability | Nox Memory | Nox Studio |
|---|---:|---:|
| Repo indexing | Owns | Calls |
| Local embeddings | Owns default | May accelerate with MLX |
| Graph/query/search | Owns | Displays/uses |
| Memory storage | Owns | Displays/edits later |
| Context packs | Owns | Generates/previews/attaches |
| Worktrees | No | Owns |
| Agent launching | No | Owns |
| Integrated terminal / PTY | No | Owns |
| Prompt profiles | Minimal/optional | Owns |
| Provider routing | No | Owns |
| Quota tracking | No | Owns later |
| GitHub integration | No | Later Studio |
| Vercel integration | No | Later Studio |
| MCP gateway/hooks | No | Later Studio |
| Observability timeline | Query events only | Owns run trace |

---

# Development Order

## Phase 0: Boundary cleanup

- rename modules clearly
- define Nox Memory API
- define Nox Studio API consumer
- document ownership boundaries
- make package metadata match reality

## Phase 1: Nox Memory MVP

- npm package
- init/ingest/query/context
- local embeddings
- embedded local storage
- local info page
- basic memory
- plugin snippets

## Phase 2: Nox Studio MVP

- SwiftUI app shell
- repo registration
- worktree manager
- context pack preview
- provider launch profiles
- integrated terminal
- run tracking
- changed-file/diff view

## Phase 3: Studio control upgrades

- prompt registry v2
- provider quota/cooldown tracking
- GitHub PR/checks integration
- observability timeline
- memory lifecycle UI

## Phase 4: Advanced power-user mode

- MLX embedding optimization
- MCP gateway
- hook emulation
- Vercel deployment monitoring
- multi-agent workflow playbooks
- AG-UI-inspired event panels

---

# Immediate GitHub Issue Candidates

## Nox Memory

1. Define Nox Memory package boundary and public CLI/API
2. Add npm init flow with `.nox/config.json` and `.gitignore` setup
3. Implement local embedded storage and schema migrations
4. Add repo ingestion with hashing and incremental updates
5. Add local embedding provider with automatic model cache
6. Add OpenAI-compatible embedding provider
7. Add hybrid search/query/context pack command
8. Add basic memory CRUD and search
9. Add local info page with search and context builder
10. Add Claude/AGENTS.md/plugin snippets

## Nox Studio

1. Define Nox Studio boundary and local daemon API
2. Add SwiftUI app shell with core panels
3. Add repo registration and Nox Memory detection
4. Add task model and task panel
5. Add Git worktree manager
6. Add integrated PTY terminal panel
7. Add provider launch profiles
8. Add prompt profile preview and run prompt hashing
9. Add context pack preview from Nox Memory
10. Add run tracking and transcript persistence
11. Add changed-file and diff view after run

---

# Final Product Statements

## Nox Memory

Drop-in local memory and repo query engine for AI coding agents.

## Nox Studio

Native Apple Silicon cockpit for launching, isolating, routing, and observing AI coding agents.

The engine makes agents know the repo. The studio makes agents do work safely. Different jobs, different tools, fewer monstrous all-in-one mistakes. A suspiciously adult decision.
