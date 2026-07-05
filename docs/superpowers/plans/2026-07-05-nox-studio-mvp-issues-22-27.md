# Nox Studio MVP Issues 22-27 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use native subagents for bounded exploration and disjoint implementation slices. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Nox Studio MVP chain from GitHub issues #22 through #27 without closing the tracking issue #19.

**Architecture:** Extend the existing local `dfc-dashboard.ts` daemon with thin git-backed worktree endpoints and SurrealDB-backed Studio run records, then make the SwiftUI shell consume those endpoints through `DaemonClient`. Keep Nox Memory as the context source and Nox Studio as the orchestration layer.

**Tech Stack:** TypeScript/tsx local HTTP daemon, Node.js `git` process wrappers, SwiftPM macOS SwiftUI app, SwiftTerm terminal view, repo-local `pnpm dfc:*` verification.

---

## File Structure

- Modify `scripts/dfc-dashboard.ts`: add `/api/worktrees`, `/api/worktrees/:id/diff`, `/api/runs`, and `/api/runs/:id/finish` helpers and routes, keeping route/error style local to this file.
- Modify `scripts/dfc-init.ts`: make new target repos ignore `.dfc/worktrees/`.
- Modify `.gitignore`: ignore `.dfc/worktrees/`.
- Modify `src/flags.ts`: truthfully move Studio flags as each issue becomes functional.
- Modify `studio/Sources/NoxStudio/DaemonClient.swift`: add Codable models and client methods for worktrees, runs, providers, context packs, and task status.
- Modify `studio/Sources/NoxStudio/Panels.swift`: replace placeholder panels with native Worktrees, Providers, Terminal run loop, Runs review, and Context Pack controls.
- Modify `studio/Sources/NoxStudio/NoxStudioApp.swift`: add native context-pack routing if the panel stops being only WKWebView-backed.
- Create/update `script/build_and_run.sh` and `.codex/environments/environment.toml` if absent, following the macOS build/run skill.

## Task 1: Issue #22 Daemon Worktree API

**Files:**
- Modify: `scripts/dfc-dashboard.ts`
- Modify: `scripts/dfc-init.ts`
- Modify: `.gitignore`
- Modify: `src/flags.ts`

- [x] Add safe slug helpers: task-derived slug fallback, git branch validation, and `^[a-z0-9-]+$` id validation.
- [x] Add `POST /api/worktrees` with body `{ taskId, branch?, baseRef? }`, running `git worktree add .dfc/worktrees/<slug> -b <branch> <baseRef|HEAD>`.
- [x] Add `GET /api/worktrees` using `git worktree list --porcelain`, `git status --porcelain`, and changed-file counts per worktree.
- [x] Add `GET /api/worktrees/:id/diff` returning `{ files, diff }` from `git status --porcelain`, unstaged `git diff`, and staged `git diff --cached`.
- [x] Add `DELETE /api/worktrees/:id` that refuses dirty worktrees unless `force=1`.
- [x] Ignore `.dfc/worktrees/` in this repo and future `dfc:init` target repos.
- [x] Set `studio.worktrees` to `"scaffolded"` after daemon endpoints pass curl smoke tests.
- [x] Verify with `pnpm exec tsc --noEmit` and curl create/list/diff/delete.
- [x] Verify with `pnpm dfc:validate-hooks`.

## Task 2: Issue #23 Run Records

**Files:**
- Modify: `scripts/dfc-dashboard.ts`

- [x] Add `studio_run` records in the same SurrealDB backend used by dashboard task state, with transcripts stored under `.agent-runs/studio/<run-id>.txt`.
- [x] Add `POST /api/runs` for `{ taskId, worktreeId?, provider, model?, promptProfileId?, promptHash?, transcriptPath? }`.
- [x] Add `POST /api/runs/:id/finish` for status, exit code, changed files, and notes.
- [x] Add `GET /api/runs` newest first and `GET /api/runs/:id` full record.
- [x] Include Studio runs in `/api/state` separately from existing spawned dashboard agents.
- [x] Verify create/get/finish/get across daemon restart and `pnpm exec tsc --noEmit`.

## Task 3: Issue #24 Native Worktrees Panel

**Files:**
- Modify: `studio/Sources/NoxStudio/DaemonClient.swift`
- Modify: `studio/Sources/NoxStudio/Panels.swift`
- Modify: `src/flags.ts`

- [ ] Add Swift models for worktree list, diff files, and diff detail.
- [ ] Add daemon methods for list, create, diff, and delete.
- [ ] Replace `WorktreesPanel` placeholder with task picker, create form, worktree list, diff detail, and dirty delete confirmation.
- [ ] Set `studio.worktrees` to `"experimental"` after Swift panel smoke passes.
- [ ] Verify with `cd studio && swift build` and `pnpm exec tsc --noEmit`.

## Task 4: Issue #25 Providers Panel

**Files:**
- Modify: `studio/Sources/NoxStudio/DaemonClient.swift`
- Modify: `studio/Sources/NoxStudio/Panels.swift`
- Modify: `src/flags.ts`

- [ ] Add provider profile model fields from the issue body.
- [ ] Ship built-in Claude Code, Codex CLI, and generic shell profiles.
- [ ] Persist user edits to `~/.nox-studio/providers.json`.
- [ ] Render final prompt sections and compute SHA-256 hash.
- [ ] Set `studio.providerRouter` to `"experimental"` and `studio.promptRegistry` to `"scaffolded"`.
- [ ] Verify profile persistence and prompt hash changes with `cd studio && swift build`.

## Task 5: Issue #26 Terminal Run Loop

**Files:**
- Modify: `studio/Sources/NoxStudio/DaemonClient.swift`
- Modify: `studio/Sources/NoxStudio/Panels.swift`
- Modify: `src/flags.ts`

- [ ] Bind the terminal cwd to the selected worktree or repo root fallback.
- [ ] Launch a provider profile with task/context prompt injection.
- [ ] Create a run with `POST /api/runs` before launch and append transcript output to `.agent-runs/studio/<run-id>.txt`.
- [ ] Finish or fail the run with `/api/runs/:id/finish`, including changed files from the worktree diff endpoint.
- [ ] Add kill action that terminates the child process and marks the run failed.
- [ ] Set `studio.terminal` to `"experimental"`.
- [ ] Verify generic shell launch, transcript file, run detail, changed files, kill behavior, and `cd studio && swift build`.

## Task 6: Issue #27 Context Pack Attach and Review

**Files:**
- Modify: `studio/Sources/NoxStudio/DaemonClient.swift`
- Modify: `studio/Sources/NoxStudio/Panels.swift`
- Modify: `studio/Sources/NoxStudio/NoxStudioApp.swift` if the Context Pack panel becomes native.
- Modify: `src/flags.ts`

- [ ] Add native context-pack generation action that calls the same Nox context endpoint/command path the dashboard uses.
- [ ] Show token estimate and attach the generated pack to the pending run.
- [ ] Replace `{contextPack}` in prompt templates before launch.
- [ ] Extend Runs detail with transcript tail, changed files, diff, task status buttons, and worktree cleanup.
- [ ] Set `studio.contextPackPreview` to `"scaffolded"`.
- [ ] Verify the full MVP loop manually and run `cd studio && swift build`, `pnpm exec tsc --noEmit`, and `pnpm dfc:validate-hooks`.

## Subagent Use

- [x] Explorer subagent: daemon helper/route map for #22 and #23.
- [x] Explorer subagent: SwiftUI/SwiftTerm map for #24 through #27.
- [ ] Worker subagents may implement later Swift slices only after daemon endpoints stabilize and write scopes are disjoint.

## GitHub Closure Protocol

- [ ] For each issue #22 through #27, update checkboxes, add the verification comment requested by the issue, then close that issue only after its acceptance criteria are met and changes are ready to land.
- [ ] Do not close #19 during this chain.
