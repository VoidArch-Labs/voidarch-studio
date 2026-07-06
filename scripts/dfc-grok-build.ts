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
import { normalizeSourceAgent } from "@voidarch/context/agents";
import { clean } from "@voidarch/context/runs";
import { parseEnvFile, REPO_ROOT } from "@voidarch/context/surreal";

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
  // CLAUDE_PROJECT_DIR ranks above bare cwd: skills/agents cd into this plugin's own
  // directory so pnpm can find the dfc:grok-build script at all (the consuming project's
  // package.json doesn't have it), which would otherwise make a bare cwd() default point
  // at the plugin's own directory instead of the project actually being worked on.
  const raw =
    args["repo-root"] ||
    process.env.DFC_TARGET_REPO_ROOT ||
    fileEnv.DFC_TARGET_REPO_ROOT ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.cwd();
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

// spawnSync defaults stdin to an open, unfed pipe — grok appears to block/wait on it in some
// code paths (confirmed live: a review-mode task that wants to read a file reliably cancels
// with stdio left at its spawnSync default, and reliably completes with stdin closed). Every
// grok invocation below closes stdin explicitly rather than leaving that pipe dangling.
// spawnSync defaults stdin to an open, unfed pipe; every call below closes it explicitly.
function grokStdio(): ["ignore", "pipe", "pipe"] {
  return ["ignore", "pipe", "pipe"];
}

function checkGrokAvailable(): { ok: true } | { ok: false; message: string } {
  const probe = spawnSync("grok", ["--version"], { encoding: "utf8", timeout: 15_000, stdio: grokStdio() });
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
    stdio: grokStdio(),
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
  permissionMode: "auto" | "acceptEdits";
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
    { encoding: "utf8", env: withoutApiKey(process.env), maxBuffer: 16 * 1024 * 1024, stdio: grokStdio() },
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
  const permissionMode = allowWrites ? "acceptEdits" : "auto";
  const startedAt = new Date().toISOString();
  // Grok occasionally cancels a turn outright (stopReason "Cancelled", exit 0, no real
  // output) — observed live, intermittent, root cause not fully pinned down beyond the
  // spawnSync stdin fix above. Retries reliably succeed in practice, so retry a couple of
  // times before surfacing it as an interrupted run.
  const MAX_CANCELLED_RETRIES = 2;
  let attempt = runGrok({ targetRepoRoot, prompt, model, permissionMode });
  let retries = 0;
  while (
    attempt.exitCode === 0 &&
    attempt.parsed?.stopReason === "Cancelled" &&
    retries < MAX_CANCELLED_RETRIES
  ) {
    retries++;
    console.error(`dfc:grok-build — grok cancelled the turn, retrying (${retries}/${MAX_CANCELLED_RETRIES})...`);
    attempt = runGrok({ targetRepoRoot, prompt, model, permissionMode });
  }
  const { exitCode, stdout, stderr, parsed, sessionId } = attempt;
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
    retries,
    grokSessionId: parsed?.sessionId ?? null,
    stopReason: parsed?.stopReason ?? null,
    // Shared redact() is tuned for structured CLI/log text (KEY=value, Bearer <tok>) and can
    // over-redact common English words ("token", "key") in Grok's free-text prose. That's the
    // right tradeoff for a "safe" summary — over-redacting benign text beats missing a real secret.
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
