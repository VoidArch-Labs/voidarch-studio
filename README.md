# VoidArch Studio

**Local-first orchestration, observability and safety controls for AI coding agents.**

VoidArch Studio is an active-development control room for running and supervising coding agents across repositories, worktrees and interactive terminal sessions. It combines a localhost dashboard, a daemon-owned PTY session engine, deterministic safety hooks, workflow templates, observability records and a thin Tauri desktop shell.

> **Status:** substantial working prototype in active development. The repository is suitable as an engineering reference, but it is not distributed as a stable desktop release.

## Product boundary

This monorepo contains two related layers:

- **[VoidArch Context](https://github.com/VoidArch-Labs/voidarch-context)** indexes, remembers, searches and assembles repository context. Studio consumes that standalone repository as its canonical Context implementation, pinned by commit in `package.json`.
- **VoidArch Studio** launches, routes, observes and controls coding-agent sessions. Studio uses Context, while Context does not require Studio.

## Implemented

### Studio daemon and dashboard

- Local HTTP server bound to `127.0.0.1`.
- Repository registry and repository-scoped state.
- Daemon-owned PTY sessions for Claude Code, Codex CLI and plain shell profiles.
- Session input, resize, signal, kill and respawn APIs.
- WebSocket terminal attachment through vendored xterm.js.
- Git worktree creation, diff inspection and guarded deletion.
- Run records, transcripts and persisted orphan-session metadata.
- Dashboard panels for agents, sessions, worktrees, runs, workflows, tasks, code graph, memory, vectors, metrics, tokens, synchronization, observability and health.
- Prompt-spec rendering shared by the dashboard and session engine.

Relevant implementation:

- [`scripts/dfc-dashboard.ts`](scripts/dfc-dashboard.ts)
- [`scripts/studio-sessions.ts`](scripts/studio-sessions.ts)
- [`dashboard/index.html`](dashboard/index.html)
- [`dashboard/app.js`](dashboard/app.js)

### Safety and observability hooks

The Claude Code plugin includes fail-closed hooks that:

- block protected files and private-key material;
- gate dangerous shell commands;
- gate write-capable MCP operations;
- support scoped, expiring approval records;
- record tool activity as JSONL;
- record verification and graph-scan markers;
- warn or block when changed work has not been verified.

The deterministic fixture harness is [`scripts/dfc-validate-hooks.sh`](scripts/dfc-validate-hooks.sh).

### Tauri desktop shell

[`studio-tauri/`](studio-tauri/) contains a thin Tauri v2 shell. It checks whether the daemon is running, starts it from a valid Studio checkout when possible, and opens the localhost dashboard in a native window. Agent processes remain owned by the daemon and therefore do not terminate merely because the desktop window closes.

The shell accepts `VOIDARCH_STUDIO_ROOT=/path/to/voidarch`. It no longer depends on a developer-specific filesystem path. When the daemon cannot be found or started, the bundled fallback page explains the required setup.

## Verification

The workflow at [`.github/workflows/typecheck.yml`](.github/workflows/typecheck.yml) defines three independent verification jobs:

1. **TypeScript and safety hooks**
   - frozen workspace install;
   - TypeScript compilation;
   - the complete deterministic hook harness;
   - Context package-content inspection.
2. **Daemon and Chromium GUI**
   - starts the real Studio dashboard server;
   - waits for `/api/state`;
   - loads the dashboard in headless Chromium;
   - verifies the principal panels and GUI collapse/jump interactions;
   - verifies repository, session, state and prompt-rendering API contracts;
   - saves a full-page screenshot and server log as CI artifacts.
3. **Tauri shell**
   - Rust tests;
   - Linux native-shell compilation through Tauri.

## Run the dashboard

Requirements:

- Node 22 or newer;
- pnpm 10;
- Git;
- `jq` for the fail-closed hook layer;
- `claude`, `codex` or another configured executable only when launching those profiles.

```bash
git clone https://github.com/VoidArch-Labs/voidarch-studio.git
cd voidarch
pnpm install --frozen-lockfile
pnpm typecheck
pnpm dfc:validate-hooks
pnpm dfc:dashboard --repo-root /path/to/a/repository
```

Open `http://127.0.0.1:4949`.

The dashboard degrades explicitly when optional data is unavailable. Missing memory, graph, transcript or assistant configuration is shown as unavailable rather than fabricated.

## Run the desktop shell

```bash
cd studio-tauri
pnpm install --frozen-lockfile
export VOIDARCH_STUDIO_ROOT=/path/to/voidarch
pnpm tauri dev
```

For a compile-only verification:

```bash
cargo test --manifest-path studio-tauri/src-tauri/Cargo.toml
cd studio-tauri
pnpm tauri build --debug --no-bundle
```

## Repository layout

```text
dashboard/                   static Studio web client
scripts/dfc-dashboard.ts     localhost server and Studio APIs
scripts/studio-sessions.ts   PTY session engine and WebSocket transport
studio-tauri/                native desktop shell
hooks/                       safety and observability hooks
skills/                      Claude Code skills
agents/                      scoped agent definitions
workflows/                   reusable development workflows
templates/                   project scaffolding and integration examples
docs/                        architecture, operation and validation documents
```

## Current limitations

- The desktop shell is a source build, not a signed or notarized release.
- Third-party coding-agent executables and subscriptions are supplied by the operator and are not authenticated in CI.
- The GUI test validates local dashboard behavior without launching paid or authenticated agents.
- Embedded SurrealKV is single-process for each repository database.
- Several command names retain the historical `dfc:` prefix for compatibility.
- Provider routing and optional external integrations depend on host configuration.

## Context package

Repository memory, search, graph and context-pack functionality comes from the standalone [`VoidArch-Labs/voidarch-context`](https://github.com/VoidArch-Labs/voidarch-context) package. Studio pins a verified Context commit rather than maintaining a second editable implementation.

## License

Copyright (c) 2026 VoidArch Labs. All Rights Reserved. See [`LICENSE`](LICENSE).
