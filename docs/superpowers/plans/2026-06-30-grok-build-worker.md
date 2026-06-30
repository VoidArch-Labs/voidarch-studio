# Grok Build Worker Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Grok Build (xAI's local coding-agent CLI) as a manual, least-privilege external
worker integration: a `pnpm dfc:grok-build` wrapper, a manual `/dfc-grok-build` Claude skill, a
dispatchable Grok worker agent, an env template, docs, and a 24h local cooldown on quota/rate-limit
errors.

**Architecture:** A single TypeScript wrapper (`scripts/dfc-grok-build.ts`) is the only thing that
spawns the `grok` binary. It builds a mode-specific prompt, strips `XAI_API_KEY` from the child
env (forces cached subscription login, never pay-per-token billing), enforces a `--repo-root`-scoped
cooldown file when Grok reports quota/rate-limit errors, and writes a redacted run summary under
`.agent-runs/grok/runs/`. The Claude skill and the new agent are both thin callers of this one
wrapper — same shape as the existing seven `.claude/skills/dfc-*` skills wrapping `pnpm dfc:*`.

**Tech Stack:** TypeScript (NodeNext/ESM, `tsx` runner, `strict` tsc), Node `child_process.spawnSync`,
Node `crypto.randomUUID`, the repo's existing `src/memory/{agents,runs,surreal}.ts` helpers.

## Global Constraints

- Node script style: ESM, `NodeNext` resolution → relative imports end in `.js` even though the
  source is `.ts` (verbatim across every existing `scripts/dfc-*.ts`).
- `tsconfig.json` already includes `scripts/**/*.ts` and `src/**/*.ts` — no tsconfig change needed.
- `.gitignore` already ignores `.agent-runs/` wholesale — no gitignore change needed for run
  summaries or the cooldown file, **except** a new exception line for `.dfc/grok.example.env`
  (the existing `.dfc/*.env` ignore rule would otherwise swallow it — see Task 4).
- `SourceAgent` (`src/memory/types.ts:4`) is a closed union consumed by
  `normalizeSourceAgent()` (`src/memory/agents.ts`) across every `dfc:*` script. Must add
  `"grok-build"` so `--agent grok-build` doesn't throw (user spec: "source-agent value
  grok-build if typing requires it" — confirmed it does).
- Safety posture from `AGENTS.md` "External agent rules" applies to this worker: open PRs only,
  never deploy, never touch secrets, never widen scope, verify before claiming done, report
  changed files/checks/risks. The wrapper and the new agent definition must say this explicitly.
- **Two verified deviations from the literal spec wording** (both confirmed empirically against
  the locally installed `grok` CLI 0.2.77 before writing any code — see Task 1):
  1. `--no-auto-update` **is not a real flag** on `grok` or `grok agent` (checked `--help` on
     both). There is no auto-update-on-launch behavior to suppress in this version, so the flag
     is **omitted** rather than passed through broken. Documented inline in the wrapper and
     called out in the skill/PR description.
  2. The spec's flag list doesn't mention a permission mode, but the user's own global
     `~/.grok/config.toml` defaults to `permission_mode = "always-approve"` — relying on that
     ambient config would let Grok write files during a `review`-mode call. Added
     `--permission-mode plan` for non-write modes and `--permission-mode acceptEdits` only when
     `--allow-writes` is set (both verified headless-safe in Task 1: clean single-shot JSON,
     exit 0, no hang). This matches the repo's least-privilege/"never widen scope silently" rule.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/memory/types.ts` | Extend `SourceAgent` union with `"grok-build"`. |
| `src/memory/agents.ts` | Extend `VALID_SOURCE_AGENTS` + error message. |
| `scripts/dfc-grok-build.ts` | **New.** The wrapper: cooldown gate, availability/auth checks, mode→prompt, spawn `grok` (API key stripped), quota detection → cooldown write, redacted run summary. |
| `package.json` | Add `"dfc:grok-build": "tsx scripts/dfc-grok-build.ts"`. |
| `.claude/skills/dfc-grok-build/SKILL.md` | **New.** Manual (`disable-model-invocation: true`) `/dfc-grok-build` skill, thin wrapper over the pnpm script — same shape as `dfc-status`. |
| `agents/grok-build-worker.md` | **New.** Dispatchable Claude subagent whose job is to drive the wrapper for a bounded task and report results — same shape as `implementation-worker.md`. |
| `.dfc/grok.example.env` | **New.** Template for `DFC_TARGET_REPO_ROOT` / `DFC_SOURCE_AGENT` defaults, loaded the same way `surreal.example.env`/`embed.example.env` are. |
| `.gitignore` | Add `!.dfc/grok.example.env` exception (mirrors the two existing exceptions). |
| `README.md` | Add a row to the Skills table and the Agents table; one sentence in the External-worker context. |
| `AGENTS.md` | Add a short "Grok Build" subsection next to "Codex" / "Claude Code", and mention it in "External agent rules". |

No file needs splitting — `dfc-grok-build.ts` lands at ~190 lines, in line with the largest
existing `scripts/dfc-*.ts` files (`dfc-import-runs.ts` is 249).

## Interfaces

- **Produces (used by the skill and the agent doc, must match exactly):**
  - CLI: `pnpm dfc:grok-build --mode <review|implement|diff-review> --task "<text>" [--repo-root <path>] [--agent <manual|codex|claude|grok-build>] [--allow-writes] [--verify] [--model <id>] [--force]`
  - Maintenance: `pnpm dfc:grok-build --clear-cooldown [--repo-root <path>]`
  - Exit codes (when run directly, e.g. `pnpm exec tsx scripts/dfc-grok-build.ts ...`): `0`
    success, `1` runtime/auth/availability/cooldown failure, `2` bad arguments. **Caveat found
    during Task 3 smoke testing:** this repo's `.npmrc` sets `reporter=silent`, which makes `pnpm
    run`/`pnpm dfc:grok-build` collapse any non-zero exit code to `1` (verified with a throwaway
    script, with and without `.npmrc` — not specific to this wrapper, and out of scope to change
    repo-wide for one script). Callers going through `pnpm dfc:grok-build` should treat **any
    non-zero** as failure and read stderr/the run summary for the reason, not branch on the exact
    code.
  - Run summary path: `<repo-root>/.agent-runs/grok/runs/<sessionId>.json`.
  - Cooldown path: `<repo-root>/.agent-runs/grok/cooldown.json`, shape `{ "until": ISO8601, "reason": string }`.
- **Consumes (from existing code, exact signatures):**
  - `normalizeSourceAgent(value?: string, fallback?: SourceAgent): SourceAgent` — `src/memory/agents.ts`. Throws on invalid value.
  - `clean(value: string | undefined, max: number): string` — `src/memory/runs.ts`. Redact + hard-cap.
  - `REPO_ROOT: string`, `parseEnvFile(path: string): Record<string,string>` — `src/memory/surreal.ts`. Used only to locate/load `.dfc/grok.env` (the dev-flow-control package's own root), **not** the target `--repo-root`.

---

### Task 1: Verify the real `grok` CLI surface (research, no code)

**Already done in this session** — recorded here so the plan is self-contained and the next
person doesn't re-derive it:

- [x] `which grok` → `/Users/davidpapp/.local/bin/grok`, version `0.2.77 [stable]`, already
  authenticated (`grok models` → "You are logged in with grok.com.").
- [x] `grok --help` and `grok agent --help`: confirmed real flags `--cwd`, `-s/--session-id`
  (must be a fresh UUID), `-m/--model`, `--output-format <plain|json|streaming-json>`,
  `-p/--single`, `--permission-mode <default|acceptEdits|auto|dontAsk|bypassPermissions|plan>`.
  Confirmed **no** `--no-auto-update` anywhere (top-level or `agent` subcommand).
- [x] Live smoke call (`env -u XAI_API_KEY grok --cwd "$PWD" -m grok-composer-2.5-fast
  --output-format json -p "Say OK and nothing else." --session-id <uuid>`) → exit 0, clean JSON:
  `{"text": "OK", "stopReason": "EndTurn", "sessionId": "...", "requestId": "...", "thought": "..."}`.
  Stderr is noisy (MCP tool-name warnings from the user's own global config bridging into Grok)
  but non-fatal — never parsed, never surfaced except capped on a failing exit code.
- [x] Re-ran the same call with `--permission-mode plan` added → identical clean exit-0 JSON, no
  hang in headless `-p` mode. Confirms it's safe to default non-write modes to `plan`.
- [x] `grok models` lists `grok-build` and `grok-composer-2.5-fast` (default) — confirms the
  spec's "default model Composer 2.5 Fast" maps to `grok-composer-2.5-fast`.

No further action for this task — it's the evidence base for the Global Constraints deviations
and for Task 3's spawn logic.

---

### Task 2: Extend `SourceAgent` to include `"grok-build"`

**Files:**
- Modify: `src/memory/types.ts:4`
- Modify: `src/memory/agents.ts:3,8`

- [ ] **Step 1: Edit the union type**

`src/memory/types.ts:4`, change:
```ts
export type SourceAgent = "manual" | "codex" | "claude";
```
to:
```ts
export type SourceAgent = "manual" | "codex" | "claude" | "grok-build";
```

- [ ] **Step 2: Edit the runtime validator**

`src/memory/agents.ts`, full new content:
```ts
import type { SourceAgent } from "./types.js";

const VALID_SOURCE_AGENTS = new Set<SourceAgent>(["manual", "codex", "claude", "grok-build"]);

export function normalizeSourceAgent(value?: string, fallback: SourceAgent = "manual"): SourceAgent {
  const raw = (value || process.env.DFC_SOURCE_AGENT || fallback).trim().toLowerCase();
  if (VALID_SOURCE_AGENTS.has(raw as SourceAgent)) return raw as SourceAgent;
  throw new Error('--agent must be one of "manual", "codex", "claude", or "grok-build"');
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors (this is a pure union-widening change; every existing `source_agent: SourceAgent`
field stays valid).

- [ ] **Step 4: Commit**

```bash
git add src/memory/types.ts src/memory/agents.ts
git commit -m "feat(memory): add grok-build to SourceAgent union"
```

---

### Task 3: `scripts/dfc-grok-build.ts` wrapper

**Files:**
- Create: `scripts/dfc-grok-build.ts`
- Modify: `package.json` (add the `dfc:grok-build` script)

**Interfaces:** see "Interfaces" above. Consumes `normalizeSourceAgent`, `clean`, `REPO_ROOT`,
`parseEnvFile` from existing modules.

- [ ] **Step 1: Write the wrapper**

Create `scripts/dfc-grok-build.ts`:
```ts
// dfc:grok-build — manual external worker integration: drive a local Grok CLI
// session (subscription/cached-login mode) for review, implementation, or
// diff-review tasks, with a 24h local cooldown on quota/rate-limit errors.
//
//   pnpm dfc:grok-build --task "review the auth module"
//   pnpm dfc:grok-build --mode implement --task "add input validation" --allow-writes
//   pnpm dfc:grok-build --mode diff-review --task "review my uncommitted changes"
//   pnpm dfc:grok-build --clear-cooldown
//   pnpm dfc:grok-build --task "..." --force
//
// Spawns the local `grok` CLI with XAI_API_KEY stripped from its environment so it
// always uses the cached grok.com subscription login, never pay-per-token billing.
// Writes a concise, redacted run summary under <repo-root>/.agent-runs/grok/runs/.
//
// Deviations from a naive flag-for-flag spec (verified against grok 0.2.77, see
// docs/superpowers/plans/2026-06-30-grok-build-worker.md Task 1):
//   - `--no-auto-update` does not exist on this CLI (checked --help) — omitted.
//   - `--permission-mode` was added (plan / acceptEdits) since this CLI's own global
//     config can default to always-approve, which would let a "review" call write files.

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { normalizeSourceAgent } from "../src/memory/agents.js";
import { clean } from "../src/memory/runs.js";
import { parseEnvFile, REPO_ROOT } from "../src/memory/surreal.js";

const MODES = ["review", "implement", "diff-review"] as const;
type Mode = (typeof MODES)[number];

const DEFAULT_MODEL = "grok-composer-2.5-fast";
const COOLDOWN_HOURS = 24;
const QUOTA_PATTERN = /\b(quota|rate[\s-]?limit(?:ed)?|usage[\s-]?limit(?:ed)?)\b/i;

interface Args {
  mode?: string;
  task?: string;
  "repo-root"?: string;
  agent?: string;
  "allow-writes"?: string;
  verify?: string;
  model?: string;
  "clear-cooldown"?: string;
  force?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a && a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = "true";
      else {
        out[key] = next;
        i++;
      }
    }
  }
  return out as Args;
}

/** `.dfc/grok.env` (gitignored) over `.dfc/grok.example.env`, both relative to this package's own root. */
function loadGrokFileEnv(): Record<string, string> {
  const dfcDir = join(REPO_ROOT, ".dfc");
  return {
    ...parseEnvFile(join(dfcDir, "grok.example.env")),
    ...parseEnvFile(join(dfcDir, "grok.env")),
  };
}

function resolveTargetRepoRoot(args: Args, fileEnv: Record<string, string>): string {
  const raw = args["repo-root"] || process.env.DFC_TARGET_REPO_ROOT || fileEnv.DFC_TARGET_REPO_ROOT || process.cwd();
  return resolve(raw);
}

function withoutApiKey(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { XAI_API_KEY, ...rest } = env;
  return rest;
}

function cooldownPath(targetRepoRoot: string): string {
  return join(targetRepoRoot, ".agent-runs", "grok", "cooldown.json");
}

function runsDir(targetRepoRoot: string): string {
  return join(targetRepoRoot, ".agent-runs", "grok", "runs");
}

interface Cooldown {
  until: string;
  reason: string;
}

function readCooldown(targetRepoRoot: string): Cooldown | null {
  const path = cooldownPath(targetRepoRoot);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Cooldown;
  } catch {
    return null;
  }
}

function writeCooldown(targetRepoRoot: string, reason: string): void {
  const path = cooldownPath(targetRepoRoot);
  mkdirSync(dirname(path), { recursive: true });
  const until = new Date(Date.now() + COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
  writeFileSync(path, `${JSON.stringify({ until, reason: clean(reason, 200) }, null, 2)}\n`);
}

function clearCooldown(targetRepoRoot: string): void {
  rmSync(cooldownPath(targetRepoRoot), { force: true });
}

function buildPrompt(mode: Mode, task: string): string {
  const header =
    mode === "implement"
      ? "You are operating in IMPLEMENT mode. Make the file changes needed to complete the task " +
        "below. Stay within the scope of the task; do not perform unrelated refactors."
      : mode === "diff-review"
        ? "You are operating in DIFF-REVIEW mode, READ-ONLY. Run `git status` and `git diff` " +
          "yourself in this repository and review the uncommitted changes. Do not modify any " +
          "files. Report bugs, risks, and missing tests."
        : "You are operating in REVIEW mode, READ-ONLY. Do not modify any files. Investigate the " +
          "repository as needed and answer the task below.";
  return `${header}\n\nTask: ${task}`;
}

function checkGrokAvailable(): { ok: true } | { ok: false; message: string } {
  const probe = spawnSync("grok", ["--version"], { encoding: "utf8", timeout: 15_000 });
  if (probe.error || probe.status !== 0) {
    return {
      ok: false,
      message:
        "Grok CLI not found on PATH. Install the Grok CLI for your platform from your " +
        "organization's distribution channel, confirm with `grok --version`, then retry.",
    };
  }
  return { ok: true };
}

function checkGrokAuthenticated(): { ok: true } | { ok: false; message: string } {
  const probe = spawnSync("grok", ["models"], {
    encoding: "utf8",
    timeout: 15_000,
    env: withoutApiKey(process.env),
  });
  if (probe.error || probe.status !== 0) {
    return {
      ok: false,
      message: "Grok CLI is not authenticated in subscription mode. Run `grok login`, then retry.",
    };
  }
  return { ok: true };
}

interface GrokResult {
  text?: string;
  stopReason?: string;
  sessionId?: string;
  requestId?: string;
}

function runGrok(opts: {
  targetRepoRoot: string;
  prompt: string;
  model: string;
  permissionMode: "plan" | "acceptEdits";
}): { exitCode: number; stdout: string; stderr: string; parsed: GrokResult | null; sessionId: string } {
  const sessionId = randomUUID();
  const result = spawnSync(
    "grok",
    [
      "--cwd", opts.targetRepoRoot,
      "--session-id", sessionId,
      "-m", opts.model,
      "--output-format", "json",
      "--permission-mode", opts.permissionMode,
      "-p", opts.prompt,
    ],
    { encoding: "utf8", env: withoutApiKey(process.env), maxBuffer: 16 * 1024 * 1024 },
  );
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  let parsed: GrokResult | null = null;
  try {
    parsed = JSON.parse(stdout) as GrokResult;
  } catch {
    parsed = null;
  }
  return { exitCode: result.status ?? 1, stdout, stderr, parsed, sessionId };
}

function writeRunSummary(targetRepoRoot: string, summary: Record<string, unknown>): string {
  const dir = runsDir(targetRepoRoot);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${summary.sessionId ?? Date.now()}.json`);
  writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`);
  return path;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const fileEnv = loadGrokFileEnv();
  const targetRepoRoot = resolveTargetRepoRoot(args, fileEnv);

  if (args["clear-cooldown"] === "true") {
    clearCooldown(targetRepoRoot);
    console.log(`dfc:grok-build — cooldown cleared for ${targetRepoRoot}`);
    return;
  }

  const mode = (args.mode || "review") as Mode;
  if (!MODES.includes(mode)) {
    console.error(`--mode must be one of ${MODES.join(", ")}`);
    process.exit(2);
  }

  const allowWrites = args["allow-writes"] === "true";
  if (mode === "implement" && !allowWrites) {
    console.error(
      "dfc:grok-build --mode implement requires --allow-writes (explicit consent to let Grok edit files).",
    );
    process.exit(2);
  }

  const task = (args.task || "").trim();
  if (!task) {
    console.error("--task is required (the prompt/goal for Grok).");
    process.exit(2);
  }

  const sourceAgent = normalizeSourceAgent(args.agent || fileEnv.DFC_SOURCE_AGENT);
  const model = args.model || DEFAULT_MODEL;
  const force = args.force === "true";

  if (!force) {
    const cooldown = readCooldown(targetRepoRoot);
    if (cooldown && new Date(cooldown.until).getTime() > Date.now()) {
      console.error(
        `dfc:grok-build — in cooldown until ${cooldown.until} (${cooldown.reason}). ` +
          `Use --force to bypass for one run, or --clear-cooldown to reset.`,
      );
      process.exit(1);
    }
  }

  const availability = checkGrokAvailable();
  if (!availability.ok) {
    console.error(`dfc:grok-build — ${availability.message}`);
    process.exit(1);
  }
  const auth = checkGrokAuthenticated();
  if (!auth.ok) {
    console.error(`dfc:grok-build — ${auth.message}`);
    process.exit(1);
  }

  const prompt = buildPrompt(mode, task);
  const startedAt = new Date().toISOString();
  const { exitCode, stdout, stderr, parsed, sessionId } = runGrok({
    targetRepoRoot,
    prompt,
    model,
    permissionMode: allowWrites ? "acceptEdits" : "plan",
  });
  const finishedAt = new Date().toISOString();

  const combined = `${stdout}\n${stderr}`;
  const quotaHit = QUOTA_PATTERN.test(combined);
  if (quotaHit) {
    writeCooldown(targetRepoRoot, "grok reported quota/rate-limit/usage-limit");
  }

  let verify: { command: string; passed: boolean } | undefined;
  if (args.verify === "true") {
    if (existsSync(join(targetRepoRoot, "tsconfig.json"))) {
      const tc = spawnSync("pnpm", ["exec", "tsc", "--noEmit"], { cwd: targetRepoRoot, encoding: "utf8" });
      verify = { command: "pnpm exec tsc --noEmit", passed: tc.status === 0 };
    } else {
      verify = { command: "pnpm exec tsc --noEmit", passed: false };
      console.log("dfc:grok-build — --verify skipped: no tsconfig.json in repo-root");
    }
  }

  const summary = {
    sessionId,
    mode,
    model,
    agent: sourceAgent,
    targetRepoRoot,
    task: clean(task, 500),
    startedAt,
    finishedAt,
    exitCode,
    grokSessionId: parsed?.sessionId ?? null,
    stopReason: parsed?.stopReason ?? null,
    textPreview: clean(parsed?.text, 2000),
    cooldownTriggered: quotaHit,
    verify: verify ?? null,
  };
  const summaryPath = writeRunSummary(targetRepoRoot, summary);

  if (exitCode !== 0) {
    console.error(`dfc:grok-build — grok exited ${exitCode}. Run summary: ${summaryPath}`);
    if (quotaHit) console.error(`dfc:grok-build — quota/rate-limit detected; cooldown set for ${COOLDOWN_HOURS}h.`);
    else console.error(clean(stderr, 1000));
    process.exit(exitCode);
  }

  console.log(`dfc:grok-build — ${mode} complete (session ${sessionId}). Run summary: ${summaryPath}`);
  if (parsed?.text) console.log(`\n${parsed.text}`);
  if (verify) console.log(`verify: ${verify.command} → ${verify.passed ? "passed" : "FAILED"}`);
}

main();
```

- [ ] **Step 2: Register the pnpm script**

`package.json`, insert after the `"dfc:memory:gc"` line and before `"dfc:validate-hooks"`:
```json
    "dfc:grok-build": "tsx scripts/dfc-grok-build.ts",
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke test (no credentials/network risk beyond the local Grok session)**

Run: `pnpm dfc:grok-build --mode review --task "Explain this repo in one paragraph" --repo-root .`
Expected: exit 0, a one-paragraph explanation printed, and a new file under
`.agent-runs/grok/runs/<uuid>.json` containing the redacted summary.

Run: `pnpm dfc:grok-build --mode implement --task "x"` (no `--allow-writes`)
Expected: exit 2, stderr `--allow-writes` requirement message, no grok process spawned.

Run: `pnpm dfc:grok-build --clear-cooldown --repo-root .`
Expected: exit 0, confirmation message, no-op if no cooldown file exists.

- [ ] **Step 5: Commit**

```bash
git add scripts/dfc-grok-build.ts package.json
git commit -m "feat: add dfc:grok-build wrapper for the Grok Build external worker"
```

---

### Task 4: `.dfc/grok.example.env` + `.gitignore` exception

**Files:**
- Create: `.dfc/grok.example.env`
- Modify: `.gitignore`

- [ ] **Step 1: Write the template**

Create `.dfc/grok.example.env`:
```bash
# Copy to .dfc/grok.env (gitignored) to override defaults for `pnpm dfc:grok-build`.
#
# Grok CLI itself authenticates via `grok login` (cached grok.com session, not an API
# key) — never put XAI_API_KEY here. dfc:grok-build strips XAI_API_KEY from the spawned
# grok process by design, so it always uses your subscription login, never pay-per-token
# billing. See AGENTS.md "External agent rules": never change billing/provider routes.

# Repo Grok should operate on. Overridable per-call with --repo-root.
DFC_TARGET_REPO_ROOT=

# Tag for dev-flow-control commands invoked as part of Grok-driven runs.
DFC_SOURCE_AGENT=grok-build
```

- [ ] **Step 2: Add the gitignore exception**

`.gitignore`, in the existing `.dfc/*.env` block, change:
```gitignore
# Local DFC credentials. NEVER commit real values; keep only templates.
.dfc/*.env
!.dfc/surreal.example.env
!.dfc/embed.example.env
```
to:
```gitignore
# Local DFC credentials. NEVER commit real values; keep only templates.
.dfc/*.env
!.dfc/surreal.example.env
!.dfc/embed.example.env
!.dfc/grok.example.env
```

- [ ] **Step 3: Verify it's tracked, not ignored**

Run: `git check-ignore -v .dfc/grok.example.env`
Expected: no output and a non-zero exit (means NOT ignored — `check-ignore` only prints/exits 0
for ignored paths).

- [ ] **Step 4: Commit**

```bash
git add .dfc/grok.example.env .gitignore
git commit -m "feat: add .dfc/grok.example.env template"
```

---

### Task 5: `.claude/skills/dfc-grok-build/SKILL.md`

**Files:**
- Create: `.claude/skills/dfc-grok-build/SKILL.md`

- [ ] **Step 1: Write the skill**

Create `.claude/skills/dfc-grok-build/SKILL.md`:
```markdown
---
description: Drive the local Grok Build CLI (subscription/cached-login mode) for a review, implementation, or diff-review task via the dfc:grok-build wrapper. Use only when explicitly invoked.
disable-model-invocation: true
allowed-tools: Bash
---

Run a Grok Build worker task through the safe wrapper. Grok is an external CLI worker —
**not** a Claude subagent — operating under the same least-privilege rules as Codex/Jules in
[`AGENTS.md`](../../../AGENTS.md): open PRs only, never deploy, never touch secrets, never widen
scope, verify before claiming done.

Default (read-only review of the current repo):

!`pnpm dfc:grok-build --mode review --task "$ARGUMENTS"`

Notes:
- Default mode is **review** (read-only, `--permission-mode plan`). For `implement`, the caller
  must pass `--allow-writes` explicitly — this skill does not grant it implicitly.
- `--mode diff-review` points Grok at the repo's own uncommitted `git diff`/`git status`.
- Spawns `grok` with `XAI_API_KEY` stripped — always subscription/cached-login mode, never
  pay-per-token billing.
- If Grok reports a quota/rate-limit/usage-limit error, a 24h local cooldown is written to
  `.agent-runs/grok/cooldown.json` and subsequent calls fail fast until it expires. Clear it with
  `pnpm dfc:grok-build --clear-cooldown`, or bypass once with `--force`.
- If `grok` is missing or unauthenticated, the wrapper fails cleanly with install/`grok login`
  guidance — it never hangs waiting for interactive input.
- Run summaries land under `.agent-runs/grok/runs/<session>.json` (gitignored, redacted/capped).
```

- [ ] **Step 2: Confirm directory-derived naming**

Run: `ls .claude/skills/dfc-grok-build/`
Expected: `SKILL.md` only — the skill name `/dfc-grok-build` is derived from the directory name
(matches the existing 7 `dfc-*` skills, none of which set an explicit `name:` field).

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/dfc-grok-build/SKILL.md
git commit -m "feat: add manual /dfc-grok-build Claude skill"
```

---

### Task 6: `agents/grok-build-worker.md`

**Files:**
- Create: `agents/grok-build-worker.md`

- [ ] **Step 1: Write the agent definition**

Create `agents/grok-build-worker.md`:
```markdown
---
name: grok-build-worker
description: Use this agent when you want a bounded task driven through the external Grok Build CLI worker (local subscription/cached-login mode) instead of executed directly — e.g. "have Grok review this", "delegate this implementation to Grok", or getting a second, differently-modeled opinion on a diff. Grok is NOT a Claude subagent; this agent's job is to drive it via the dfc:grok-build wrapper and report back. See "When to invoke" in the agent body for worked scenarios.
model: inherit
color: purple
tools: ["Bash", "Read"]
---

You drive the external Grok Build CLI worker through the `pnpm dfc:grok-build` wrapper — you do
not call the `grok` binary directly, and you are not Grok yourself. Grok is an external executor,
same trust tier as Codex/Jules in `AGENTS.md` "External agent rules": open PRs only, never
deploy, never touch secrets, never widen scope silently, verify before claiming done.

## When to invoke

- **Second opinion / external review.** The user wants Grok's read on a piece of code or a diff.
- **Delegated implementation.** The user explicitly wants Grok (not you) to make a bounded set of
  file changes, with explicit write consent.
- **Diff review before a PR.** Run Grok over the repo's own uncommitted changes.

**Core responsibilities:**
1. Pick the right `--mode`: `review` (default, read-only) for analysis/explanation tasks,
   `diff-review` for reviewing uncommitted changes, `implement` only when the user has clearly
   authorized Grok to write files.
2. Never add `--allow-writes` on the user's behalf — only pass it through when the user's request
   explicitly authorized Grok to make edits.
3. Run the wrapper, read its run summary, and report honestly — including failures, the
   quota/rate-limit cooldown state, and anything out of scope you noticed (do not fix it yourself
   here — report it).

**Process:**
1. `pnpm dfc:grok-build --mode <mode> --task "<bounded task>" [--repo-root <path>] [--allow-writes] [--verify]`
2. If it exits non-zero: read the printed guidance (missing/unauthenticated Grok CLI, active
   cooldown, bad arguments) and relay it plainly — do not retry blindly, and never pass `--force`
   without the user asking to bypass the cooldown.
3. Read the run summary JSON under `.agent-runs/grok/runs/` for the session ID, model, and
   redacted text preview.

**Output format:**
- Mode used + task given to Grok
- Exit code and whether a cooldown was triggered
- Grok's response (or a summary of file changes, in `implement` mode)
- Run summary path
- Anything out of scope you noticed (report, don't fix)

Do not claim a Grok-driven change is verified without actually running `--verify` (or your own
check) and reporting the result.
```

- [ ] **Step 2: Commit**

```bash
git add agents/grok-build-worker.md
git commit -m "feat: add grok-build-worker agent definition"
```

---

### Task 7: README.md + AGENTS.md updates (concise)

**Files:**
- Modify: `README.md` (Skills table ~line 134-142, Agents table ~line 151-161)
- Modify: `AGENTS.md` (new subsection after "Codex", ~line 58-62; one line in "External agent rules")

- [ ] **Step 1: README Skills table**

In the `### Skills (\`skills/\`)` table, this new skill lives under `.claude/skills/`, not
`skills/`, so add a one-line callout immediately under the table (don't conflate the two
directories) — after the `"Auto-invocable" maps to...` sentence, append:

```markdown

`.claude/skills/dfc-grok-build` follows the same manual pattern as the seven `dfc-*` skills
documented in [`AGENTS.md`](AGENTS.md#claude-code) — it wraps `pnpm dfc:grok-build`.
```

- [ ] **Step 2: README Agents table**

In the `### Agents (\`agents/\`)` table, change the header line and add a row:
```diff
-Nine scoped subagents, least-privilege tools (read-only agents have **no** Edit/Write/Bash):
+Ten scoped subagents, least-privilege tools (read-only agents have **no** Edit/Write/Bash):

 | Agent | Phase | Writes? | Role |
 |---|---|---|---|
 | `repo-explorer` | Plan | no | Locate relevant files/symbols/tests; compact map. |
 | `graph-navigator` | Plan | no | Dependencies, call chains, impact radius via the repo graph. |
 | `planner` | Plan | no | Bounded plan + executor route + verification + gates. |
 | `implementation-worker` | Execute | yes | Scoped edits + tests; no broad refactors. |
+| `grok-build-worker` | Execute/Verify | via Grok | Drives the external Grok Build CLI (subscription mode) for review/implement/diff-review tasks. |
 | `test-debugger` | Execute/Verify | yes | Reproduce → root cause → narrow patch. |
```
(keep `pr-reviewer`, `security-reviewer`, `docs-researcher`, `release-checker` rows unchanged.)

- [ ] **Step 3: AGENTS.md — new subsection + external-agent-rules mention**

After the `## Codex` section (ends at the line before `## Claude Code`), insert:
```markdown
## Grok Build

Grok Build is a **manual** external worker, driven via `pnpm dfc:grok-build` (and the
`/dfc-grok-build` Claude skill, and the `grok-build-worker` agent) — never auto-invoked. It runs
the local `grok` CLI in subscription/cached-login mode (`XAI_API_KEY` is stripped from its
environment by the wrapper, so it never bills pay-per-token). A 24h local cooldown
(`.agent-runs/grok/cooldown.json`) kicks in automatically when Grok reports a
quota/rate-limit/usage-limit error; clear it with `--clear-cooldown` or bypass once with
`--force`. `implement` mode requires explicit `--allow-writes`. See
`.claude/skills/dfc-grok-build/SKILL.md` and `agents/grok-build-worker.md`.

```
And in `## External agent rules`, change the opening line:
```diff
-External executors (Codex, Jules, future agents) operate under least privilege:
+External executors (Codex, Jules, Grok Build, future agents) operate under least privilege:
```

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: document the Grok Build worker integration"
```

---

## Self-Review

**Spec coverage:**
- pnpm dfc:grok-build wrapper → Task 3.
- manual /dfc-grok-build Claude skill → Task 5.
- Grok worker agent definition → Task 6.
- .dfc/grok.example.env → Task 4.
- concise README/AGENTS/docs update → Task 7.
- local 24h cooldown file on quota/rate-limit/usage-limit → Task 3 (`writeCooldown`/`QUOTA_PATTERN`).
- --clear-cooldown and --force flags → Task 3 (`main()`).
- source-agent value grok-build if typing requires it → Task 2 (confirmed it does).
- default mode review; modes review/implement/diff-review → Task 3 (`MODES`, `buildPrompt`).
- --task, --repo-root, --agent, --allow-writes, --verify → Task 3 (`Args`, `main()`).
- default model Composer 2.5 Fast → Task 3 (`DEFAULT_MODEL = "grok-composer-2.5-fast"`, verified
  against `grok models`).
- default repo root cwd or DFC_TARGET_REPO_ROOT → Task 3 (`resolveTargetRepoRoot`).
- spawn with XAI_API_KEY removed → Task 3 (`withoutApiKey`, used on every `grok` spawn).
- run grok with --no-auto-update/--cwd/--session-id/-m/--output-format json/-p → Task 3
  (`runGrok`; `--no-auto-update` deliberately omitted — see Global Constraints deviation #1).
- implementation mode requires allow-writes → Task 3 (`main()` early exit, code 2).
- write concise safe run summary under .agent-runs/grok/ → Task 3 (`writeRunSummary`, `clean()`).
- fail cleanly if Grok missing/unauthenticated → Task 3 (`checkGrokAvailable`/`checkGrokAuthenticated`).
- Validate: tsc, dfc:validate-hooks, claude plugin validate, smoke test → covered in "Final
  Validation" below (not a file-producing task, so it's not a numbered Task).
- Commit/push/PR → handled after Task 7, outside this plan (interactive git/PR step).

**Placeholder scan:** none — every step above has literal file content, not "TBD"/"similar to".

**Type consistency:** `Mode` (Task 3) used identically in `MODES`, `buildPrompt`, `main`.
`SourceAgent` (Task 2) flows unchanged through `normalizeSourceAgent` into Task 3's `sourceAgent`
field. `Cooldown` shape (`{until, reason}`) is identical between `writeCooldown` and `readCooldown`.

---

## Final Validation (run after all tasks, before commit/push/PR)

```bash
pnpm exec tsc --noEmit
pnpm dfc:validate-hooks
claude plugin validate .
pnpm dfc:grok-build --mode review --task "Explain this repo in one paragraph" --repo-root .
```

All four must pass/succeed before opening the PR. `claude plugin validate .` runs from the
worktree root (the plugin manifest lives at `.claude-plugin/plugin.json`, unaffected by this
change but worth a fresh check since new skill/agent files were added).
