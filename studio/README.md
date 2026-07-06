# Voidarch Studio — hybrid SwiftUI shell (scaffold)

Spec: [`docs/mvp/nox-memory-and-studio-mvp-v2.md`](../docs/mvp/nox-memory-and-studio-mvp-v2.md)
(MVP 2). Hybrid rule: native SwiftUI owns orchestration (Tasks, Worktrees, Terminal,
Runs, Providers); WKWebView panels reuse the daemon's existing dashboard/Voidarch Context pages
(Repos/memory, Context Pack) until they go native post-MVP.

```bash
cd studio
swift run VoidarchStudio       # macOS 14+, Apple Silicon primary
```

> **Status: scaffold, compile-verified.** `swift build` succeeds with Xcode 26.6
> (verified 2026-07-05). Remaining MVP work is tracked as sequenced GitHub issues
> under #19 — see "MVP work remaining" below.

The daemon is the extended `pnpm dfc:dashboard` server (default `http://127.0.0.1:4949`)
— start it before launching the app. Settings panel can point at another port.

## Works in the scaffold today

- App shell with the nine MVP panels in a `NavigationSplitView` sidebar.
- Daemon health + refresh (`/api/state`), native Tasks panel (list/add/mark-done via
  `/api/tasks/*`), native Runs list, integrated SwiftTerm terminal running the login shell.
- WKWebView embeds for the dashboard memory view and the Voidarch Context context-pack page.

## MVP work remaining (2026-07-06)

Tracked as sequenced issues: #22 → #23 → #24 → #25 → #26 → #27 (evaluation + #19 close after all six).

Daemon (extend `scripts/dfc-dashboard.ts`):

- `POST /api/worktrees` (create for task), `GET /api/worktrees` (branch/base/dirty/changed),
  `GET /api/worktrees/:id/diff`, `DELETE /api/worktrees/:id` — thin wrappers over
  `git worktree add/list`, `git status`, `git diff`.
- `POST /api/runs` accepting a provider profile + worktree, recording run rows
  (prompt hash/profile id/transcript path) — extends the existing spawned-agent registry.

App:

- Worktrees panel: list/create/diff/cleanup against the endpoints above.
- Terminal: bind session cwd to the selected worktree; launch provider profile command;
  save transcript to `.agent-runs/studio/<run-id>.txt`; mark run finished/failed on exit.
- Providers panel: profile registry (Claude Code, Codex CLI, generic shell) with command
  template, model, effort, env, prompt-injection mode; final-prompt preview + hash
  recorded on the run (spec §6–§7).
- Context Pack panel: keep the WKWebView embed; add "attach pack to run".
- Basic diff review: changed files + diff text from `/api/worktrees/:id/diff`;
  mark task done/blocked/failed.

## Non-goals (spec)

Vercel, GitHub PR automation, auto-merge, MCP gateway, hook emulation, quota scraping,
multi-agent scheduling, local LLM inference, cloud sync, team features.
