// dfc:dashboard — Voidarch Studio: per-repo agent control room. Local-only live server (127.0.0.1).
//
//   pnpm dfc:dashboard [--repo-root /path/to/repo] [--port 4949]
//
// Local-first: works with no SurrealDB credentials (memory panel degrades to "off").
// Sources: .agent-runs/ observability logs, graphify-out/ repo graph, plugin health
// (manifest/hooks/skills/agents), git state, Claude Code transcripts (~/.claude/projects,
// token usage), bundled workflow definitions, and — when configured — SurrealDB
// dev-memory (table counts, open tasks/blockers, recent memories, deep metrics).
//
// Control surfaces (all local, never exposed off-loopback):
//   POST /api/agents/launch   spawn a headless `claude -p` run (stream-json, logged)
//   POST /api/agents/:id/kill terminate a spawned run
//   POST /api/assistant       Mercury (OpenAI-compatible) read-only repo assistant

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, extname, join, normalize } from "node:path";
import { parseArgs, repoRootFromArgs } from "@voidarch/context/cli";
import { type DfcMetrics, collectMetrics } from "@voidarch/context/metrics";
import {
  REPO_ROOT,
  embeddedDataDir,
  isEmbeddedUrl,
  loadConfig,
  parseEnvFile,
  queryResult,
  withDb,
} from "@voidarch/context/surreal";
import { buildContextPack, formatContextPackMarkdown } from "@voidarch/context/context-pack";
import { embedChunks, gatherDbTargets, listEmbeddingModels, queryVectors, resolveEmbedConfig } from "@voidarch/context/vectors";
import { detectRiskTerms, tokenize } from "@voidarch/context/scoring";
import { StringRecordId, Table } from "surrealdb";
import {
  addRepo, createSession, deleteSession, getSession, handleSessionUpgrade,
  initRepoRegistry, listProfiles, listSessions, loadPersistedSessions,
  removeRepo, renderPrompt, reposPayload, resolveRepoParam, respawnSession,
  resizeSession, saveProfiles, sessionTail, signalSession, writeSession,
  type ProviderProfile,
} from "./studio-sessions.js";

// Short timeouts for an interactive dashboard (only if the user has not overridden).
process.env.DFC_SURREAL_CONNECT_TIMEOUT_MS ??= "8000";
process.env.DFC_SURREAL_CONNECT_ATTEMPTS ??= "1";
process.env.DFC_SURREAL_QUERY_TIMEOUT_MS ??= "15000";

const MAX_JSONL_BYTES = 2 * 1024 * 1024;

// Embedded SurrealKV is single-process; serialize every DB touch from this server
// so a state refresh and an assistant tool call never fight over the LOCK file.
let dbQueue: Promise<unknown> = Promise.resolve();
function withDbSerial<T>(fn: Parameters<typeof withDb<T>>[0], repoRoot: string): Promise<T> {
  const run = () => withDb(fn, { repoRoot });
  const next = dbQueue.then(run, run);
  dbQueue = next.catch(() => {});
  return next;
}

interface Health {
  name: string;
  status: "ok" | "warn" | "fail" | "off";
  detail: string;
}

function git(repoRoot: string, ...argv: string[]): string {
  try {
    return execFileSync("git", ["-C", repoRoot, ...argv], { encoding: "utf8", timeout: 5000 }).trim();
  } catch {
    return "";
  }
}

function gitRequired(repoRoot: string, ...argv: string[]): string {
  try {
    return execFileSync("git", ["-C", repoRoot, ...argv], { encoding: "utf8", timeout: 15_000 }).trim();
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const stderr = Buffer.isBuffer(e.stderr) ? e.stderr.toString("utf8") : String(e.stderr ?? "");
    throw new Error((stderr || e.message || "git command failed").trim());
  }
}

/** Untrimmed git output — porcelain status lines start with a significant space
 *  (" M file"), which the trimming helpers above would eat on the first line. */
function gitRaw(repoRoot: string, ...argv: string[]): string {
  try {
    return execFileSync("git", ["-C", repoRoot, ...argv], { encoding: "utf8", timeout: 15_000 });
  } catch {
    return "";
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** Parse a JSONL file, tolerating a truncated first line when tailing big files. */
function readJsonl(path: string): Array<Record<string, unknown>> {
  try {
    const size = statSync(path).size;
    let text = readFileSync(path, "utf8");
    if (size > MAX_JSONL_BYTES) text = text.slice(text.length - MAX_JSONL_BYTES);
    const out: Array<Record<string, unknown>> = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        /* truncated/garbled line — skip */
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ---- Studio worktrees (git is the source of truth) ----------------------------------

interface StudioWorktree {
  id: string;
  path: string;
  branch: string;
  baseCommit: string;
  dirty: boolean;
  changedFiles: number;
}

interface WorktreeDiffFile {
  path: string;
  status: string;
}

const WORKTREE_ID_RE = /^[a-z0-9-]+$/;

function worktreesRoot(repoRoot: string): string {
  return join(repoRoot, ".dfc", "worktrees");
}

function slugifyWorktreeId(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "worktree";
}

function uniqueWorktreeId(repoRoot: string, base: string): string {
  const root = worktreesRoot(repoRoot);
  const stem = slugifyWorktreeId(base);
  for (let i = 0; i < 100; i++) {
    const id = i === 0 ? stem : `${stem}-${i + 1}`;
    if (!existsSync(join(root, id))) return id;
  }
  return `${stem}-${Date.now().toString(36)}`;
}

function validateWorktreeId(id: string): string | undefined {
  const clean = id.trim();
  return WORKTREE_ID_RE.test(clean) ? clean : undefined;
}

function worktreePathForId(repoRoot: string, id: string): string | undefined {
  const clean = validateWorktreeId(id);
  if (!clean) return undefined;
  const root = normalize(worktreesRoot(repoRoot));
  const path = normalize(join(root, clean));
  return path === root || !path.startsWith(`${root}/`) ? undefined : path;
}

function parseStatusFiles(status: string): WorktreeDiffFile[] {
  return status.split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const code = line.slice(0, 2).trim() || "changed";
      const rawPath = line.slice(3).trim();
      const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) ?? rawPath : rawPath;
      return { path, status: code };
    });
}

function parseWorktreePorcelain(output: string): Array<{ path: string; branch: string; baseCommit: string }> {
  const entries: Array<{ path: string; branch: string; baseCommit: string }> = [];
  let current: { path: string; branch: string; baseCommit: string } | undefined;
  const flush = () => {
    if (current?.path) entries.push(current);
    current = undefined;
  };
  for (const line of `${output}\n`.split("\n")) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");
    if (key === "worktree") current = { path: value, branch: "(detached)", baseCommit: "" };
    else if (current && key === "HEAD") current.baseCommit = value;
    else if (current && key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
  }
  return entries;
}

function listStudioWorktrees(repoRoot: string): StudioWorktree[] {
  const root = normalize(worktreesRoot(repoRoot));
  const raw = git(repoRoot, "worktree", "list", "--porcelain");
  if (!raw) return [];
  return parseWorktreePorcelain(raw)
    .filter((w) => normalize(w.path).startsWith(`${root}/`))
    .map((w) => {
      const status = gitRaw(w.path, "status", "--porcelain");
      const files = parseStatusFiles(status);
      return {
        id: basename(w.path),
        path: w.path,
        branch: w.branch,
        baseCommit: w.baseCommit,
        dirty: files.length > 0,
        changedFiles: files.length,
      };
    })
    .filter((w) => WORKTREE_ID_RE.test(w.id));
}

function createStudioWorktree(
  repoRoot: string,
  body: { taskId?: string; branch?: string; baseRef?: string },
): Record<string, unknown> {
  try {
    const taskId = String(body.taskId ?? "").trim();
    if (!taskId) return { error: "taskId required" };
    const baseRef = String(body.baseRef ?? "HEAD").trim() || "HEAD";
    const id = uniqueWorktreeId(repoRoot, String(body.branch ?? taskId));
    const branch = String(body.branch ?? `studio/${id}`).trim();
    if (!git(repoRoot, "check-ref-format", "--branch", branch)) return { error: "invalid branch" };
    const root = worktreesRoot(repoRoot);
    const path = join(root, id);
    mkdirSync(root, { recursive: true });
    const baseCommit = gitRequired(repoRoot, "rev-parse", baseRef);
    gitRequired(repoRoot, "worktree", "add", path, "-b", branch, baseRef);
    return { id, path, branch, baseCommit };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

function diffStudioWorktree(repoRoot: string, id: string): Record<string, unknown> {
  try {
    const path = worktreePathForId(repoRoot, id);
    if (!path || !existsSync(path)) return { error: "unknown worktree" };
    const status = gitRaw(path, "status", "--porcelain");
    const unstaged = git(path, "diff", "--");
    const staged = git(path, "diff", "--cached", "--");
    return {
      id,
      path,
      files: parseStatusFiles(status),
      diff: [unstaged, staged].filter(Boolean).join("\n"),
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

function deleteStudioWorktree(repoRoot: string, id: string, force: boolean): Record<string, unknown> {
  try {
    const path = worktreePathForId(repoRoot, id);
    if (!path || !existsSync(path)) return { error: "unknown worktree" };
    const files = parseStatusFiles(gitRaw(path, "status", "--porcelain"));
    if (files.length && !force) {
      return { error: "worktree is dirty; retry with force=1", dirty: true, changedFiles: files.length };
    }
    gitRequired(repoRoot, "worktree", "remove", ...(force ? ["--force"] : []), path);
    return { id, removed: true };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

// ---- Studio runs (records only; the native app owns process execution) ---------------

type StudioRunStatus = "running" | "done" | "failed";

interface StudioRunRecord {
  id: string;
  taskId: string;
  provider: string;
  model?: string;
  promptProfileId?: string;
  promptHash?: string;
  worktreeId?: string;
  transcriptPath: string;
  startedAt: string;
  finishedAt?: string;
  status: StudioRunStatus;
  changedFiles: string[];
  exitCode?: number;
  notes?: string;
}

const studioRunCache = new Map<string, StudioRunRecord>();

function studioRunsDir(repoRoot: string): string {
  return join(repoRoot, ".agent-runs", "studio");
}

function newStudioRunId(): string {
  return `studio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeStudioRun(row: Record<string, unknown>): StudioRunRecord {
  return {
    id: String(row.studio_run_id ?? row.id ?? ""),
    taskId: String(row.taskId ?? ""),
    provider: String(row.provider ?? ""),
    model: row.model ? String(row.model) : undefined,
    promptProfileId: row.promptProfileId ? String(row.promptProfileId) : undefined,
    promptHash: row.promptHash ? String(row.promptHash) : undefined,
    worktreeId: row.worktreeId ? String(row.worktreeId) : undefined,
    transcriptPath: String(row.transcriptPath ?? ""),
    startedAt: String(row.startedAt ?? row.started_at ?? ""),
    finishedAt: row.finishedAt ? String(row.finishedAt) : undefined,
    status: row.status === "done" || row.status === "failed" ? row.status : "running",
    changedFiles: Array.isArray(row.changedFiles) ? row.changedFiles.map(String) : [],
    exitCode: typeof row.exitCode === "number" ? row.exitCode : undefined,
    notes: row.notes ? String(row.notes) : undefined,
  };
}

async function listStudioRuns(repoRoot: string): Promise<StudioRunRecord[]> {
  if (!memoryConfigured(repoRoot)) return [];
  try {
    return await withDbSerial(async (db, c) => {
      const rows = await queryResult<Array<Record<string, unknown>>>(
        db,
        `SELECT * FROM studio_run
         WHERE repo_id = $repo
         ORDER BY startedAt DESC LIMIT 50`,
        { repo: c.repoId },
      );
      const byId = new Map<string, StudioRunRecord>(studioRunCache);
      for (const row of rows) {
        const run = normalizeStudioRun(row);
        byId.set(run.id, run);
      }
      const runs = [...byId.values()].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).slice(0, 50);
      for (const run of runs) studioRunCache.set(run.id, run);
      return runs;
    }, repoRoot);
  } catch {
    return [...studioRunCache.values()].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).slice(0, 50);
  }
}

async function getStudioRun(repoRoot: string, id: string): Promise<StudioRunRecord | undefined> {
  const cached = studioRunCache.get(id);
  if (cached) return cached;
  if (!memoryConfigured(repoRoot)) return undefined;
  try {
    return await withDbSerial(async (db, c) => {
      const rows = await queryResult<Array<Record<string, unknown>>>(
        db,
        `SELECT * FROM studio_run
         WHERE repo_id = $repo AND studio_run_id = $id
         LIMIT 1`,
        { repo: c.repoId, id },
      );
      const run = rows[0] ? normalizeStudioRun(rows[0]) : undefined;
      if (run) studioRunCache.set(run.id, run);
      return run;
    }, repoRoot);
  } catch {
    return undefined;
  }
}

async function createStudioRun(
  repoRoot: string,
  body: {
    taskId?: string;
    worktreeId?: string;
    provider?: string;
    model?: string;
    promptProfileId?: string;
    promptHash?: string;
    transcriptPath?: string;
  },
): Promise<Record<string, unknown>> {
  if (!memoryConfigured(repoRoot)) return { error: "dev-memory not configured" };
  const taskId = String(body.taskId ?? "").trim();
  const provider = String(body.provider ?? "").trim();
  if (!taskId) return { error: "taskId required" };
  if (!provider) return { error: "provider required" };
  const id = newStudioRunId();
  const now = new Date().toISOString();
  const transcriptPath = String(body.transcriptPath ?? join(studioRunsDir(repoRoot), `${id}.txt`));
  mkdirSync(studioRunsDir(repoRoot), { recursive: true });
  try {
    return await withDbSerial(async (db, c) => {
      const doc = {
        repo_id: c.repoId,
        studio_run_id: id,
        taskId,
        worktreeId: body.worktreeId ? String(body.worktreeId) : undefined,
        provider,
        model: body.model ? String(body.model) : undefined,
        promptProfileId: body.promptProfileId ? String(body.promptProfileId) : undefined,
        promptHash: body.promptHash ? String(body.promptHash) : undefined,
        transcriptPath,
        startedAt: now,
        started_at: now,
        status: "running",
        changedFiles: [],
        created_at: now,
      };
      await db.create(new Table("studio_run")).content(doc);
      studioRunCache.set(id, normalizeStudioRun(doc));
      return { id, status: "running", transcriptPath };
    }, repoRoot);
  } catch (err) {
    return { error: (err as Error).message };
  }
}

async function finishStudioRun(
  repoRoot: string,
  id: string,
  body: { status?: string; exitCode?: unknown; changedFiles?: unknown; notes?: string },
): Promise<Record<string, unknown>> {
  if (!memoryConfigured(repoRoot)) return { error: "dev-memory not configured" };
  const status = String(body.status ?? "").trim();
  if (status !== "done" && status !== "failed") return { error: "status must be done or failed" };
  const changedFiles = Array.isArray(body.changedFiles) ? body.changedFiles.map(String) : [];
  const exitCode = typeof body.exitCode === "number" ? body.exitCode : undefined;
  const now = new Date().toISOString();
  try {
    return await withDbSerial(async (db, c) => {
      const patch: Record<string, unknown> = {
        status,
        finishedAt: now,
        ended_at: now,
        changedFiles,
        notes: body.notes ? String(body.notes) : undefined,
      };
      if (exitCode !== undefined) patch.exitCode = exitCode;
      const rows = await queryResult<Array<Record<string, unknown>>>(
        db,
        `UPDATE studio_run MERGE $patch
         WHERE repo_id = $repo AND studio_run_id = $id
         RETURN AFTER`,
        { repo: c.repoId, id, patch },
      );
      if (!rows[0]) return { error: "unknown run" };
      const run = normalizeStudioRun(rows[0]);
      studioRunCache.set(run.id, run);
      return { ...run };
    }, repoRoot);
  } catch (err) {
    return { error: (err as Error).message };
  }
}

function collectHealth(repoRoot: string): Health[] {
  const checks: Health[] = [];
  const manifestPath = join(REPO_ROOT, ".claude-plugin", "plugin.json");
  const manifest = readJson(manifestPath) as { name?: string; version?: string } | undefined;
  checks.push(
    manifest?.name
      ? { name: "Plugin manifest", status: "ok", detail: `${manifest.name} v${manifest.version ?? "?"}` }
      : { name: "Plugin manifest", status: "fail", detail: `unreadable: ${manifestPath}` },
  );

  const hooksJson = readJson(join(REPO_ROOT, "hooks", "hooks.json")) as
    | { hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>> }
    | undefined;
  if (!hooksJson?.hooks) {
    checks.push({ name: "Hooks", status: "fail", detail: "hooks/hooks.json unreadable" });
  } else {
    const commands = Object.values(hooksJson.hooks)
      .flat()
      .flatMap((m) => m.hooks ?? [])
      .map((h) => h.command ?? "");
    const missing = commands
      .map((c) => /\$\{CLAUDE_PLUGIN_ROOT\}\/(\S+?)"/.exec(c)?.[1])
      .filter((rel): rel is string => Boolean(rel))
      .filter((rel) => !existsSync(join(REPO_ROOT, rel)));
    checks.push(
      missing.length
        ? { name: "Hooks", status: "fail", detail: `missing scripts: ${missing.join(", ")}` }
        : { name: "Hooks", status: "ok", detail: `${commands.length} hook commands, all scripts present` },
    );
  }

  try {
    execFileSync("jq", ["--version"], { timeout: 3000 });
    checks.push({ name: "jq (hooks parser)", status: "ok", detail: "available" });
  } catch {
    checks.push({ name: "jq (hooks parser)", status: "warn", detail: "missing — security hooks fail closed" });
  }

  const skills = existsSync(join(REPO_ROOT, "skills"))
    ? readdirSync(join(REPO_ROOT, "skills")).filter((d) => existsSync(join(REPO_ROOT, "skills", d, "SKILL.md")))
    : [];
  checks.push({ name: "Skills", status: skills.length ? "ok" : "warn", detail: `${skills.length} bundled` });

  const agents = existsSync(join(REPO_ROOT, "agents"))
    ? readdirSync(join(REPO_ROOT, "agents")).filter((f) => f.endsWith(".md"))
    : [];
  checks.push({ name: "Agents", status: agents.length ? "ok" : "warn", detail: `${agents.length} bundled` });

  const graphJson = join(repoRoot, "graphify-out", "graph.json");
  if (existsSync(graphJson)) {
    const ageDays = (Date.now() - statSync(graphJson).mtimeMs) / 86_400_000;
    checks.push({
      name: "Repo graph",
      status: ageDays > 7 ? "warn" : "ok",
      detail: `graphify-out/graph.json, ${ageDays.toFixed(1)}d old`,
    });
  } else {
    checks.push({ name: "Repo graph", status: "off", detail: "no graphify-out/graph.json — run /graphify" });
  }

  checks.push(
    existsSync(join(repoRoot, ".agent-runs"))
      ? { name: "Observability", status: "ok", detail: ".agent-runs/ present" }
      : { name: "Observability", status: "off", detail: "no .agent-runs/ yet — created on first hooked session" },
  );

  const cfg = loadConfig({ repoRoot });
  const placeholder = /<[^>]+>/;
  const memoryConfigured = Boolean(cfg.url) && !placeholder.test(cfg.url) &&
    (isEmbeddedUrl(cfg.url) ||
      (Boolean(cfg.username && cfg.password) && !placeholder.test(cfg.username + cfg.password)));
  checks.push(
    memoryConfigured
      ? { name: "Dev-memory config", status: "ok", detail: `${cfg.database} @ ${cfg.url.replace(/^wss?:\/\//, "")}` }
      : { name: "Dev-memory config", status: "off", detail: "no SurrealDB credentials (.dfc/surreal.env) — memory panel disabled" },
  );

  const mercury = loadMercuryConfig(repoRoot);
  checks.push(
    mercury.key
      ? { name: "Mercury assistant", status: "ok", detail: `${mercury.model} @ ${mercury.baseUrl}` }
      : { name: "Mercury assistant", status: "off", detail: "no MERCURY_API_KEY (.dfc/mercury.env) — assistant disabled" },
  );
  return checks;
}

interface SessionSummary {
  id: string;
  events: number;
  first: string;
  last: string;
  top_tools: string;
  verified: boolean;
  graph_scanned: boolean;
  active: boolean;
}

const ACTIVE_WINDOW_MS = 10 * 60_000;

function collectSessions(repoRoot: string): SessionSummary[] {
  const dir = join(repoRoot, ".agent-runs", "sessions");
  if (!existsSync(dir)) return [];
  const sessions: SessionSummary[] = [];
  for (const id of readdirSync(dir)) {
    const log = join(dir, id, "tools.jsonl");
    if (!existsSync(log)) continue;
    const events = readJsonl(log);
    if (!events.length) continue;
    const counts = new Map<string, number>();
    for (const e of events) {
      const t = String(e.tool ?? "?");
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([t, n]) => `${t}×${n}`).join("  ");
    const last = String(events[events.length - 1]?.timestamp ?? "");
    sessions.push({
      id,
      events: events.length,
      first: String(events[0]?.timestamp ?? ""),
      last,
      top_tools: top,
      verified: existsSync(join(dir, id, "verification.json")),
      graph_scanned: existsSync(join(dir, id, "graph-scanned.json")),
      active: Date.now() - Date.parse(last) < ACTIVE_WINDOW_MS,
    });
  }
  return sessions.sort((a, b) => (a.last < b.last ? 1 : -1)).slice(0, 20);
}

function collectApprovals(repoRoot: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const dirs = [join(repoRoot, ".agent-runs", "approvals")];
  const sessionsDir = join(repoRoot, ".agent-runs", "sessions");
  if (existsSync(sessionsDir)) {
    for (const id of readdirSync(sessionsDir)) dirs.push(join(sessionsDir, id, "approvals"));
  }
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((f) => f.endsWith(".json"))) {
      const rec = readJson(join(d, f));
      if (rec && typeof rec === "object") out.push({ file: f, ...(rec as Record<string, unknown>) });
    }
  }
  return out;
}

function collectGraph(repoRoot: string): Record<string, unknown> {
  const path = join(repoRoot, "graphify-out", "graph.json");
  if (!existsSync(path)) return { present: false };
  const g = readJson(path) as { nodes?: unknown[]; links?: unknown[]; built_at_commit?: string } | undefined;
  return {
    present: true,
    nodes: g?.nodes?.length ?? 0,
    edges: g?.links?.length ?? 0,
    built_at_commit: g?.built_at_commit ?? "",
    html: existsSync(join(repoRoot, "graphify-out", "graph.html")),
    updated_at: new Date(statSync(path).mtimeMs).toISOString(),
  };
}

// ---- Workflows (definitions from workflows/*.js meta blocks) ---------------------

interface WorkflowInfo {
  name: string;
  description: string;
  when_to_use: string;
  phases: string[];
  file: string;
  source: string;
}

function parseWorkflowMeta(path: string, source: string): WorkflowInfo | undefined {
  try {
    const text = readFileSync(path, "utf8");
    const meta = /export const meta = \{([\s\S]*?)\n\}/.exec(text)?.[1] ?? "";
    const str = (key: string) => new RegExp(`${key}:\\s*'((?:[^'\\\\]|\\\\.)*)'`).exec(meta)?.[1] ?? "";
    const phases = [...meta.matchAll(/title:\s*'([^']+)'/g)].map((m) => m[1]);
    const name = str("name") || basename(path, ".js");
    return { name, description: str("description"), when_to_use: str("whenToUse"), phases, file: path, source };
  } catch {
    return undefined;
  }
}

function collectWorkflows(repoRoot: string): WorkflowInfo[] {
  const out: WorkflowInfo[] = [];
  const dirs = [
    { dir: join(REPO_ROOT, "workflows"), source: "plugin" },
    { dir: join(repoRoot, ".claude", "workflows"), source: "repo" },
  ];
  const seen = new Set<string>();
  for (const { dir, source } of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
      const info = parseWorkflowMeta(join(dir, f), source);
      if (info && !seen.has(info.name)) {
        seen.add(info.name);
        out.push(info);
      }
    }
  }
  return out;
}

// ---- Sync / backend status --------------------------------------------------------

function collectSync(repoRoot: string): Record<string, unknown> {
  const cfg = loadConfig({ repoRoot });
  const embedded = isEmbeddedUrl(cfg.url);
  const dataDir = embedded ? embeddedDataDir(cfg.url) : null;
  let lock: { present: boolean; age_seconds?: number } = { present: false };
  if (dataDir && existsSync(join(dataDir, "LOCK"))) {
    lock = { present: true, age_seconds: Math.round((Date.now() - statSync(join(dataDir, "LOCK")).mtimeMs) / 1000) };
  }
  // Hosted target on file: a wss:// URL in any .dfc env file means dfc:sync has somewhere to go.
  const hostedConfigured = [".dfc/surreal.env", ".dfc/surreal.hosted.env"]
    .flatMap((rel) => [join(repoRoot, rel), join(REPO_ROOT, rel)])
    .some((p) => /^DFC_SURREAL_URL=wss?:\/\//m.test(existsSync(p) ? readFileSync(p, "utf8") : ""));
  return {
    mode: embedded ? "embedded" : "hosted",
    url: cfg.url.replace(/:\/\/[^@]*@/, "://***@"),
    database: cfg.database,
    namespace: cfg.namespace,
    repo_id: cfg.repoId,
    data_dir: dataDir,
    lock,
    hosted_configured: hostedConfigured,
  };
}

// ---- Token usage (Claude Code transcripts + context packs) -------------------------

interface TokenAgg {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
  messages: number;
}

interface TokensPanel {
  available: boolean;
  transcript_dirs: string[];
  totals: TokenAgg;
  by_model: Record<string, TokenAgg>;
  by_day: Record<string, TokenAgg>; // last 14 days, ISO date → agg
  sessions: Array<{ session: string; last: string; model: string } & TokenAgg>;
  retrieval?: { total_packs: number; avg_estimated_tokens: number | null };
}

interface FileTokenCache {
  mtimeMs: number;
  size: number;
  agg: { models: Record<string, TokenAgg>; days: Record<string, TokenAgg>; total: TokenAgg; last: string; topModel: string };
}

const tokenFileCache = new Map<string, FileTokenCache>();
let tokensCache: { at: number; value: TokensPanel } | undefined;
const TOKENS_TTL_MS = 60_000;

function emptyAgg(): TokenAgg {
  return { input: 0, output: 0, cache_read: 0, cache_creation: 0, messages: 0 };
}

function addAgg(into: TokenAgg, from: TokenAgg): void {
  into.input += from.input;
  into.output += from.output;
  into.cache_read += from.cache_read;
  into.cache_creation += from.cache_creation;
  into.messages += from.messages;
}

/** Claude Code project transcript dirs that could cover this repo (repo root or any parent). */
function transcriptDirs(repoRoot: string): string[] {
  const override = process.env.DFC_TRANSCRIPTS_DIR;
  if (override) return existsSync(override) ? [override] : [];
  const base = join(homedir(), ".claude", "projects");
  if (!existsSync(base)) return [];
  const munge = (p: string) => p.replace(/[^A-Za-z0-9]/g, "-");
  // Repo root + its direct parent (workspace root) only — walking further up
  // would sweep in transcripts from unrelated projects (e.g. ~/Dev sessions).
  const out: string[] = [];
  for (const dir of [repoRoot, dirname(repoRoot)]) {
    const candidate = join(base, munge(dir));
    if (existsSync(candidate) && !out.includes(candidate)) out.push(candidate);
  }
  return out;
}

function parseTranscriptFile(path: string): FileTokenCache["agg"] {
  const models: Record<string, TokenAgg> = {};
  const days: Record<string, TokenAgg> = {};
  const total = emptyAgg();
  let last = "";
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { models, days, total, last, topModel: "" };
  }
  for (const line of text.split("\n")) {
    if (!line.includes('"usage"')) continue;
    let entry: { timestamp?: string; message?: { model?: string; usage?: Record<string, unknown> } };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const usage = entry.message?.usage;
    if (!usage) continue;
    const one: TokenAgg = {
      input: Number(usage.input_tokens ?? 0) || 0,
      output: Number(usage.output_tokens ?? 0) || 0,
      cache_read: Number(usage.cache_read_input_tokens ?? 0) || 0,
      cache_creation: Number(usage.cache_creation_input_tokens ?? 0) || 0,
      messages: 1,
    };
    addAgg(total, one);
    const model = entry.message?.model ?? "unknown";
    addAgg((models[model] ??= emptyAgg()), one);
    const day = (entry.timestamp ?? "").slice(0, 10);
    if (day) addAgg((days[day] ??= emptyAgg()), one);
    if (entry.timestamp && entry.timestamp > last) last = entry.timestamp;
  }
  const topModel = Object.entries(models).sort((a, b) => b[1].output - a[1].output)[0]?.[0] ?? "";
  return { models, days, total, last, topModel };
}

function collectTokens(repoRoot: string, retrieval?: TokensPanel["retrieval"]): TokensPanel {
  if (tokensCache && Date.now() - tokensCache.at < TOKENS_TTL_MS) {
    if (retrieval) tokensCache.value.retrieval = retrieval;
    return tokensCache.value;
  }
  const dirs = transcriptDirs(repoRoot);
  const panel: TokensPanel = {
    available: dirs.length > 0,
    transcript_dirs: dirs,
    totals: emptyAgg(),
    by_model: {},
    by_day: {},
    sessions: [],
    retrieval,
  };
  const cutoffDay = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  for (const dir of dirs) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
      const path = join(dir, f);
      let st: { mtimeMs: number; size: number };
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      let cached = tokenFileCache.get(path);
      if (!cached || cached.mtimeMs !== st.mtimeMs || cached.size !== st.size) {
        cached = { mtimeMs: st.mtimeMs, size: st.size, agg: parseTranscriptFile(path) };
        tokenFileCache.set(path, cached);
      }
      const { models, days, total, last, topModel } = cached.agg;
      addAgg(panel.totals, total);
      for (const [m, a] of Object.entries(models)) addAgg((panel.by_model[m] ??= emptyAgg()), a);
      for (const [d, a] of Object.entries(days)) {
        if (d >= cutoffDay) addAgg((panel.by_day[d] ??= emptyAgg()), a);
      }
      if (total.messages) {
        panel.sessions.push({ session: basename(f, ".jsonl"), last, model: topModel, ...total });
      }
    }
  }
  panel.sessions = panel.sessions.sort((a, b) => (a.last < b.last ? 1 : -1)).slice(0, 12);
  tokensCache = { at: Date.now(), value: panel };
  return panel;
}

// ---- SurrealDB memory panel (optional, cached) --------------------------------

interface MemoryPanel {
  available: boolean;
  error?: string;
  counts?: Record<string, number>;
  decisions?: Array<Record<string, unknown>>;
  evidence?: Array<Record<string, unknown>>;
  agent_runs?: Array<Record<string, unknown>>;
  open_tasks?: Array<Record<string, unknown>>;
  open_blockers?: Array<Record<string, unknown>>;
  lessons?: Array<Record<string, unknown>>;
  repo_facts?: Array<Record<string, unknown>>;
  snippets?: Array<Record<string, unknown>>;
  metrics?: DfcMetrics;
}

let memoryCache: { at: number; value: MemoryPanel } | undefined;
const MEMORY_TTL_MS = 60_000;

function memoryConfigured(repoRoot: string): boolean {
  const cfg = loadConfig({ repoRoot });
  const placeholder = /<[^>]+>/;
  const embedded = cfg.url ? isEmbeddedUrl(cfg.url) : false;
  return Boolean(
    cfg.url &&
      !placeholder.test(cfg.url) &&
      (embedded || (cfg.username && cfg.password && !placeholder.test(cfg.username + cfg.password))),
  );
}

async function collectMemory(repoRoot: string, fresh: boolean): Promise<MemoryPanel> {
  if (!fresh && memoryCache && Date.now() - memoryCache.at < MEMORY_TTL_MS) return memoryCache.value;
  if (!memoryConfigured(repoRoot)) return { available: false, error: "not configured" };
  let value: MemoryPanel;
  try {
    value = await withDbSerial<MemoryPanel>(async (db, c) => {
      const counts: Record<string, number> = {};
      for (const table of ["file", "doc_chunk", "decision", "evidence_item", "agent_run", "tool_event", "graph_node", "embedding_chunk", "task", "blocker", "lesson", "snippet", "repo_fact"]) {
        try {
          const rows = await queryResult<Array<{ c?: number }>>(
            db, "SELECT count() AS c FROM type::table($t) GROUP ALL", { t: table });
          counts[table] = rows[0]?.c ?? 0;
        } catch {
          counts[table] = 0;
        }
      }
      const recent = async (table: string): Promise<Array<Record<string, unknown>>> => {
        try {
          return await queryResult<Array<Record<string, unknown>>>(
            db,
            `SELECT summary, tags, source_agent, created_at FROM type::table($t) WHERE repo_id = $repo ORDER BY created_at DESC LIMIT 5`,
            { t: table, repo: c.repoId },
          );
        } catch {
          return [];
        }
      };
      const decisions = await recent("decision");
      const evidence = await recent("evidence_item");
      const lessons = await recent("lesson");
      const repo_facts = await recent("repo_fact");
      const snippets = await recent("snippet");
      let agent_runs: Array<Record<string, unknown>> = [];
      try {
        agent_runs = await queryResult<Array<Record<string, unknown>>>(
          db,
          "SELECT source_agent, task_goal, status, summary, created_at FROM agent_run WHERE repo_id = $repo ORDER BY created_at DESC LIMIT 5",
          { repo: c.repoId },
        );
      } catch { /* degrade to empty */ }
      let open_tasks: Array<Record<string, unknown>> = [];
      try {
        open_tasks = await queryResult<Array<Record<string, unknown>>>(
          db,
          "SELECT goal, status, created_at FROM task WHERE repo_id = $repo AND status IN ['open', 'in_progress', 'blocked'] ORDER BY created_at ASC LIMIT 20",
          { repo: c.repoId },
        );
      } catch { /* degrade to empty */ }
      let open_blockers: Array<Record<string, unknown>> = [];
      try {
        open_blockers = await queryResult<Array<Record<string, unknown>>>(
          db,
          "SELECT text, summary, created_at FROM blocker WHERE repo_id = $repo AND status = 'open' ORDER BY created_at ASC LIMIT 20",
          { repo: c.repoId },
        );
      } catch { /* degrade to empty */ }
      let metrics: DfcMetrics | undefined;
      try {
        metrics = await collectMetrics(db, c.repoId);
      } catch { /* metrics panel degrades to absent */ }
      return {
        available: true, counts, decisions, evidence, agent_runs,
        open_tasks, open_blockers, lessons, repo_facts, snippets, metrics,
      } satisfies MemoryPanel;
    }, repoRoot);
  } catch (err) {
    value = { available: false, error: (err as Error).message };
  }
  memoryCache = { at: Date.now(), value };
  return value;
}

// ---- Providers (headless CLI registry) ---------------------------------------------

interface ProviderDef {
  cmd: string;
  models: string[]; // first = default
  efforts: string[]; // empty = no effort control
  stream: "claude-json" | "plain";
  /** Build argv. systemPrompt is a routing preamble; providers without an
   *  append-system-prompt flag get it prepended to the prompt text. */
  buildArgs(o: { prompt: string; model?: string; effort?: string; mode: string; systemPrompt?: string }): string[];
}

const PROVIDERS: Record<string, ProviderDef> = {
  claude: {
    cmd: "claude",
    models: ["fable", "opus", "sonnet", "haiku"],
    efforts: ["low", "medium", "high"],
    stream: "claude-json",
    buildArgs: (o) => [
      "-p", o.prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", o.mode,
      ...(o.model ? ["--model", o.model] : []),
      ...(o.effort ? ["--effort", o.effort] : []),
      ...(o.systemPrompt ? ["--append-system-prompt", o.systemPrompt] : []),
    ],
  },
  codex: {
    cmd: "codex",
    models: ["gpt-5.5-codex", "gpt-5.5"],
    efforts: ["low", "medium", "high", "xhigh"],
    stream: "plain",
    buildArgs: (o) => [
      "exec",
      ...(o.model ? ["-m", o.model] : []),
      ...(o.effort ? ["-c", `model_reasoning_effort="${o.effort}"`] : []),
      o.systemPrompt ? `${o.systemPrompt}\n\n${o.prompt}` : o.prompt,
    ],
  },
  grok: {
    cmd: "grok",
    // Ids from the live grok CLI model registry (~/.grok/models_cache.json).
    models: ["grok-composer-2.5-fast", "grok-build"],
    efforts: [],
    stream: "plain",
    buildArgs: (o) => [
      "-p", o.systemPrompt ? `${o.systemPrompt}\n\n${o.prompt}` : o.prompt,
      ...(o.model ? ["-m", o.model] : []),
    ],
  },
  gemini: {
    cmd: "gemini",
    models: ["gemini-3.5-flash", "gemini-3.1-pro"],
    efforts: [],
    stream: "plain",
    buildArgs: (o) => [
      "-p", o.systemPrompt ? `${o.systemPrompt}\n\n${o.prompt}` : o.prompt,
      ...(o.model ? ["-m", o.model] : []),
    ],
  },
  copilot: {
    cmd: "copilot",
    // Ids from `copilot help config` model list.
    models: ["default", "gpt-5.5", "claude-sonnet-4.6", "claude-opus-4.8"],
    efforts: [],
    stream: "plain",
    buildArgs: (o) => [
      "-p", o.systemPrompt ? `${o.systemPrompt}\n\n${o.prompt}` : o.prompt,
      ...(o.model && o.model !== "default" ? ["--model", o.model] : []),
    ],
  },
};

/** Sanitize a provider/model/effort triple against the registry. */
function resolveProvider(provider?: string, model?: string, effort?: string): { provider: string; model?: string; effort?: string } {
  const p = PROVIDERS[provider ?? ""] ? String(provider) : "claude";
  const def = PROVIDERS[p];
  const m = model && def.models.includes(model) ? model : undefined;
  const e = effort && def.efforts.includes(effort) ? effort : undefined;
  return { provider: p, model: m, effort: e };
}

// ---- Launch defaults (legacy .dfc/nox.env — default provider/model/effort + routing) -----------

interface NoxDefaults {
  provider: string;
  model: string;
  effort: string;
  assistant_rounds: number;
  routes: { workflow: string; subagents: string; search: string; docs: string; git: string };
}

function loadNoxDefaults(repoRoot: string): NoxDefaults {
  const fileEnv = {
    ...parseEnvFile(join(REPO_ROOT, ".dfc", "nox.env")),
    ...parseEnvFile(join(repoRoot, ".dfc", "nox.env")),
  };
  const get = (k: string, d: string): string => (process.env[k] ?? fileEnv[k] ?? d).trim() || d;
  return {
    provider: get("NOX_DEFAULT_PROVIDER", "claude"),
    model: get("NOX_DEFAULT_MODEL", "fable"),
    effort: get("NOX_DEFAULT_EFFORT", "medium"),
    assistant_rounds: Number.parseInt(get("NOX_ASSISTANT_ROUNDS", "10"), 10) || 10,
    routes: {
      workflow: get("NOX_ROUTE_WORKFLOW", "native"),
      subagents: get("NOX_ROUTE_SUBAGENTS", "native-dynamic"),
      search: get("NOX_ROUTE_SEARCH", "firecrawl"),
      docs: get("NOX_ROUTE_DOCS", "context7"),
      git: get("NOX_ROUTE_GIT", "git-cli"),
    },
  };
}

// ---- Config read/write (gitignored .dfc/*.env, whitelisted keys) ---------------------

const CONFIG_FILES: Record<string, string[]> = {
  mercury: ["MERCURY_API_KEY", "MERCURY_BASE_URL", "MERCURY_MODEL"],
  embed: ["DFC_EMBED_PROVIDER", "DFC_EMBED_MODEL", "DFC_EMBED_DIMENSION", "DFC_EMBED_APPROVED", "OPENAI_API_KEY"],
  nox: [
    "NOX_DEFAULT_PROVIDER", "NOX_DEFAULT_MODEL", "NOX_DEFAULT_EFFORT", "NOX_ASSISTANT_ROUNDS",
    "NOX_ROUTE_WORKFLOW", "NOX_ROUTE_SUBAGENTS", "NOX_ROUTE_SEARCH", "NOX_ROUTE_DOCS", "NOX_ROUTE_GIT",
  ],
};

function writeConfigFile(repoRoot: string, file: string, values: Record<string, string>): { saved: string[] } {
  const allowed = CONFIG_FILES[file];
  if (!allowed) throw new Error(`unknown config file: ${file}`);
  const path = join(repoRoot, ".dfc", `${file}.env`);
  const current = parseEnvFile(path);
  const saved: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    if (!allowed.includes(k)) continue;
    const val = String(v).trim();
    if (!val) continue; // blank = keep existing (so masked key fields don't wipe keys)
    current[k] = val;
    saved.push(k);
  }
  mkdirSync(join(repoRoot, ".dfc"), { recursive: true });
  const body = `# Managed by the Voidarch Studio dashboard config page. Gitignored — never commit.\n${
    Object.entries(current).map(([k, v]) => `${k}=${v}`).join("\n")}\n`;
  writeFileSync(path, body);
  return { saved };
}

/** Config snapshot for the UI — presence booleans only, never key values. */
function collectConfig(repoRoot: string): Record<string, unknown> {
  const mercury = loadMercuryConfig(repoRoot);
  const embed = resolveEmbedConfig({ repoRoot });
  const defaults = loadNoxDefaults(repoRoot);
  return {
    mercury: { configured: Boolean(mercury.key), base_url: mercury.baseUrl, model: mercury.model },
    embed: {
      provider: embed.provider, model: embed.model, dimension: embed.dimension,
      approved: embed.approved, key_present: embed.apiKeyPresent, available: embed.available, reason: embed.reason,
    },
    defaults,
    providers: Object.fromEntries(Object.entries(PROVIDERS).map(([k, p]) => [k, { models: p.models, efforts: p.efforts }])),
  };
}

// ---- Spawned agents (headless CLI runs launched from the dashboard) ------------------

/** Tool-routing config chosen in the launcher; composed into --append-system-prompt. */
interface AgentTools {
  workflow?: string;   // default | native | superpowers | gsd
  subagents?: string;  // default | native-dynamic | native-specific | antigravity-dynamic | antigravity-specific | codex
  model?: string;      // for native-specific / antigravity-specific
  effort?: string;     // for native-specific
  search?: string;     // default | native | playwright | firecrawl
  docs?: string;       // default | search | context7
  git?: string;        // default | git-cli | gitkraken
}

const AGENT_MODELS = new Set(["sonnet", "opus", "haiku", "fable"]);
const AGENT_EFFORTS = new Set(["low", "medium", "high", "max"]);

function buildAgentSystemPrompt(t: AgentTools): string | undefined {
  const lines: string[] = [];
  const model = AGENT_MODELS.has(t.model ?? "") ? t.model : "sonnet";
  const effort = AGENT_EFFORTS.has(t.effort ?? "") ? t.effort : "medium";
  const W: Record<string, string> = {
    native: "Workflows: for multi-step/multi-agent work use the native Workflow tool (definitions in workflows/ and .claude/workflows/).",
    superpowers: "Workflows: follow the Superpowers skills — invoke superpowers:brainstorming before any creative work, superpowers:writing-plans before multi-step tasks, superpowers:test-driven-development while coding, and superpowers:verification-before-completion before claiming done. Load them with the Skill tool.",
    gsd: "Workflows: structure the work with GSD skills (gsd-plan-phase → gsd-execute-phase, gsd-quick for small tasks, gsd-progress to check state). Load them with the Skill tool.",
  };
  const S: Record<string, string> = {
    "native-dynamic": "Subagents: delegate parallel or exploratory work through the native Agent tool; choose the agent type per task (Explore for search, general-purpose otherwise).",
    "native-specific": `Subagents: delegate through the native Agent tool and always pass model="${model}" and effort="${effort}" when spawning.`,
    "antigravity-dynamic": "Subagents: delegate execution through Antigravity agents; let Antigravity pick the agent per task.",
    "antigravity-specific": `Subagents: delegate execution through Antigravity agents pinned to model "${model}".`,
    codex: "Subagents: delegate implementation tasks to Codex (headless `codex exec` via Bash, or the agent-cli MCP tools when available); keep review and integration yourself.",
  };
  const SE: Record<string, string> = {
    native: "Web search: use the native WebSearch/WebFetch tools.",
    playwright: "Web search/browsing: use the Playwright MCP browser tools (browser_navigate, browser_snapshot, …) instead of plain fetch.",
    firecrawl: "Web search: use the Firecrawl MCP tools (firecrawl_search first, firecrawl_scrape for pages); do not use built-in web search.",
  };
  const D: Record<string, string> = {
    search: "Library/framework docs: find current docs via web search.",
    context7: "Library/framework docs: always use Context7 MCP (resolve-library-id, then query-docs) before answering from memory.",
  };
  const G: Record<string, string> = {
    "git-cli": "Git: use the git CLI directly via Bash.",
    gitkraken: "Git: use the GitKraken MCP tools (git_status, git_log_or_diff, git_add_or_commit, git_push, …) instead of raw git commands.",
  };
  if (t.workflow && W[t.workflow]) lines.push(W[t.workflow]);
  if (t.subagents && S[t.subagents]) lines.push(S[t.subagents]);
  if (t.search && SE[t.search]) lines.push(SE[t.search]);
  if (t.docs && D[t.docs]) lines.push(D[t.docs]);
  if (t.git && G[t.git]) lines.push(G[t.git]);
  if (!lines.length) return undefined;
  return "Tool routing for this run (configured from the Voidarch Studio dashboard):\n- " + lines.join("\n- ");
}

interface SpawnedAgent {
  id: string;
  prompt: string;
  permission_mode: string;
  tools?: AgentTools;
  system_prompt?: string;
  provider?: string; // claude | codex | grok | gemini | copilot
  model?: string;
  effort?: string;
  purpose?: string; // "verify" forces claude/haiku
  workflow?: string; // set when launched from a workflow card
  resumed_from?: string; // session_id this run resumed
  status: "running" | "done" | "failed" | "killed";
  started_at: string;
  ended_at?: string;
  exit_code?: number | null;
  session_id?: string; // Claude session id (enables --resume)
  cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
  historical?: boolean; // rehydrated from a JSONL log, not launched by this server
  lines: string[]; // ring buffer of parsed activity lines
  result?: string; // final assistant text
  proc?: ChildProcess;
}

const spawnedAgents = new Map<string, SpawnedAgent>();
const AGENT_LINE_LIMIT = 200;
const ALLOWED_PERMISSION_MODES = new Set(["acceptEdits", "plan", "default"]);

function agentLogPath(repoRoot: string, id: string): string {
  const dir = join(repoRoot, ".agent-runs", "dashboard-agents");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${id}.jsonl`);
}

function pushLine(agent: SpawnedAgent, line: string): void {
  agent.lines.push(line);
  if (agent.lines.length > AGENT_LINE_LIMIT) agent.lines.splice(0, agent.lines.length - AGENT_LINE_LIMIT);
}

/** Compact one stream-json event into a human line for the dashboard feed. */
function describeStreamEvent(evt: Record<string, unknown>): string | undefined {
  const type = String(evt.type ?? "");
  if (type === "system") {
    // hook_started/hook_response etc. are noise in a 200-line feed; init is the useful one
    return evt.subtype === "init" ? `system: init (model ${String(evt.model ?? "?")})` : undefined;
  }
  if (type === "result") {
    return `result: ${String(evt.subtype ?? "")} · ${String(evt.num_turns ?? "?")} turns · $${Number(evt.total_cost_usd ?? 0).toFixed(4)}`;
  }
  if (type === "assistant" || type === "user") {
    const msg = evt.message as { content?: Array<Record<string, unknown>> } | undefined;
    for (const block of msg?.content ?? []) {
      if (block.type === "text" && String(block.text ?? "").trim()) {
        return `${type}: ${String(block.text).trim().slice(0, 160)}`;
      }
      if (block.type === "tool_use") {
        const input = block.input as Record<string, unknown> | undefined;
        const hint = String(input?.command ?? input?.file_path ?? input?.pattern ?? "").slice(0, 90);
        return `tool: ${String(block.name ?? "?")} ${hint}`;
      }
    }
  }
  return undefined;
}

interface LaunchOptions {
  tools?: AgentTools;
  workflow?: string;
  resumeSessionId?: string;
  provider?: string;
  model?: string;
  effort?: string;
  purpose?: string; // "verify" → forced claude/haiku
}

function launchAgent(repoRoot: string, prompt: string, permissionMode: string, opts: LaunchOptions = {}): SpawnedAgent {
  const tools = opts.tools ?? {};
  // Testing/verification agents MUST run on Haiku, never Fable.
  const wanted = opts.purpose === "verify"
    ? { provider: "claude", model: "haiku", effort: opts.effort }
    : resolveProvider(opts.provider, opts.model, opts.effort);
  const def = PROVIDERS[wanted.provider];
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 7)}`;
  const mode = ALLOWED_PERMISSION_MODES.has(permissionMode) ? permissionMode : "acceptEdits";
  const systemPrompt = buildAgentSystemPrompt(tools);
  // Strip the nested-session guard vars so a dashboard launched from inside a Claude
  // session can still spawn headless workers (the guard is for interactive nesting).
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_")) delete env[k];
  }
  const agent: SpawnedAgent = {
    id, prompt, permission_mode: mode, tools, system_prompt: systemPrompt,
    provider: wanted.provider, model: wanted.model, effort: wanted.effort, purpose: opts.purpose,
    workflow: opts.workflow, resumed_from: opts.resumeSessionId, status: "running",
    started_at: new Date().toISOString(), lines: [],
  };
  const logPath = agentLogPath(repoRoot, id);
  // First log line: our own metadata, so history survives server restarts.
  try {
    appendFileSync(logPath, `${JSON.stringify({
      type: "dfc_meta", id, prompt, permission_mode: mode, tools,
      provider: wanted.provider, model: wanted.model, effort: wanted.effort, purpose: opts.purpose,
      workflow: opts.workflow, resumed_from: opts.resumeSessionId, started_at: agent.started_at,
    })}\n`);
  } catch { /* history is best-effort */ }
  const argv = def.buildArgs({ prompt, model: wanted.model, effort: wanted.effort, mode, systemPrompt });
  if (wanted.provider === "claude" && opts.resumeSessionId) argv.push("--resume", opts.resumeSessionId);
  const plainTail: string[] = [];
  const proc = spawn(def.cmd, argv, { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  agent.proc = proc;
  let buffer = "";
  proc.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let nl = buffer.indexOf("\n");
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
      if (!line) continue;
      try {
        appendFileSync(logPath, `${line}\n`);
      } catch { /* logging must never kill the run */ }
      if (def.stream === "plain") {
        pushLine(agent, line.slice(0, 200));
        plainTail.push(line);
        if (plainTail.length > 40) plainTail.shift();
        continue;
      }
      try {
        const evt = JSON.parse(line) as Record<string, unknown>;
        if (!agent.session_id && typeof evt.session_id === "string") agent.session_id = evt.session_id;
        const desc = describeStreamEvent(evt);
        if (desc) pushLine(agent, desc);
        if (evt.type === "result") {
          agent.result = String(evt.result ?? "").slice(0, 4000);
          agent.cost_usd = Number(evt.total_cost_usd ?? 0) || undefined;
          agent.num_turns = Number(evt.num_turns ?? 0) || undefined;
          agent.duration_ms = Number(evt.duration_ms ?? 0) || undefined;
          if (evt.subtype && evt.subtype !== "success") agent.status = "failed";
        }
      } catch {
        pushLine(agent, line.slice(0, 160));
      }
    }
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8").trim();
    if (text) pushLine(agent, `stderr: ${text.slice(0, 200)}`);
  });
  proc.on("error", (err) => {
    agent.status = "failed";
    agent.ended_at = new Date().toISOString();
    pushLine(agent, `spawn error: ${err.message}`);
  });
  proc.on("exit", (code) => {
    if (agent.status === "running") agent.status = code === 0 ? "done" : "failed";
    agent.exit_code = code;
    agent.ended_at = new Date().toISOString();
    agent.duration_ms ??= Date.now() - Date.parse(agent.started_at);
    if (def.stream === "plain" && !agent.result && plainTail.length) {
      agent.result = plainTail.join("\n").slice(-4000);
    }
    agent.proc = undefined;
  });
  spawnedAgents.set(id, agent);
  return agent;
}

/** Rebuild past runs from .agent-runs/dashboard-agents/*.jsonl (server-restart survivors). */
function loadHistoricalAgents(repoRoot: string): SpawnedAgent[] {
  const dir = join(repoRoot, ".agent-runs", "dashboard-agents");
  if (!existsSync(dir)) return [];
  const out: SpawnedAgent[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
    const id = basename(f, ".jsonl");
    if (spawnedAgents.has(id)) continue; // live registry wins
    const agent: SpawnedAgent = {
      id, prompt: "(prompt not recorded)", permission_mode: "?",
      status: "failed", started_at: "", lines: [], historical: true,
    };
    for (const evt of readJsonl(join(dir, f))) {
      if (evt.type === "dfc_meta") {
        agent.prompt = String(evt.prompt ?? agent.prompt);
        agent.permission_mode = String(evt.permission_mode ?? "?");
        agent.tools = evt.tools as AgentTools | undefined;
        agent.provider = evt.provider ? String(evt.provider) : undefined;
        agent.model = evt.model ? String(evt.model) : undefined;
        agent.effort = evt.effort ? String(evt.effort) : undefined;
        agent.purpose = evt.purpose ? String(evt.purpose) : undefined;
        agent.workflow = evt.workflow ? String(evt.workflow) : undefined;
        agent.resumed_from = evt.resumed_from ? String(evt.resumed_from) : undefined;
        agent.started_at = String(evt.started_at ?? "");
      }
      if (!agent.session_id && typeof evt.session_id === "string") agent.session_id = evt.session_id;
      if (evt.type === "result") {
        agent.status = evt.subtype === "success" ? "done" : "failed";
        agent.result = String(evt.result ?? "").slice(0, 4000);
        agent.cost_usd = Number(evt.total_cost_usd ?? 0) || undefined;
        agent.num_turns = Number(evt.num_turns ?? 0) || undefined;
        agent.duration_ms = Number(evt.duration_ms ?? 0) || undefined;
      }
    }
    if (!agent.started_at) {
      // fall back to the timestamp encoded in the id: 2026-07-05T10-52-34-415Z-xxxxx
      const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(id);
      if (m) agent.started_at = `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
    }
    out.push(agent);
  }
  return out;
}

function serializeAgents(repoRoot?: string): Array<Omit<SpawnedAgent, "proc">> {
  const live = [...spawnedAgents.values()].map(({ proc: _proc, ...rest }) => rest);
  const historical = repoRoot ? loadHistoricalAgents(repoRoot) : [];
  return [...live, ...historical]
    .sort((a, b) => (a.status === "running" ? -1 : b.status === "running" ? 1 : a.started_at < b.started_at ? 1 : -1))
    .slice(0, 30);
}

/** Readable log lines for one run (live buffer or full JSONL replay). */
function agentLog(repoRoot: string, id: string): string[] {
  if (!/^[\w.-]+$/.test(id)) return [];
  const path = join(repoRoot, ".agent-runs", "dashboard-agents", `${id}.jsonl`);
  if (!existsSync(path)) return spawnedAgents.get(id)?.lines ?? [];
  const lines: string[] = [];
  for (const evt of readJsonl(path)) {
    if (evt.type === "dfc_meta") {
      lines.push(`meta: mode=${String(evt.permission_mode)} workflow=${String(evt.workflow ?? "-")}`);
      continue;
    }
    const desc = describeStreamEvent(evt);
    if (desc) lines.push(desc);
  }
  return lines.slice(-300);
}

/** Full detail for one hooked session (.agent-runs/sessions/<id>/). */
function sessionDetail(repoRoot: string, id: string): Record<string, unknown> | undefined {
  if (!/^[\w.-]+$/.test(id)) return undefined;
  const dir = join(repoRoot, ".agent-runs", "sessions", id);
  if (!existsSync(dir)) return undefined;
  const events = readJsonl(join(dir, "tools.jsonl"));
  return {
    id,
    verified: existsSync(join(dir, "verification.json")),
    graph_scanned: existsSync(join(dir, "graph-scanned.json")),
    verification: readJson(join(dir, "verification.json")),
    event_count: events.length,
    events: events.slice(-120).map((e) => ({
      timestamp: e.timestamp, tool: e.tool,
      detail: String(e.command ?? e.file ?? e.pattern ?? "").slice(0, 140),
    })),
  };
}

/** Practical node inspector: file facts + grouped edges + related memory/state. */
async function nodeDetail(repoRoot: string, nodeId: string): Promise<Record<string, unknown>> {
  const g = loadGraphData(repoRoot);
  if (!g) return { error: "no repo graph" };
  const node = g.nodes.find((n) => String(n.id) === nodeId);
  if (!node) return { error: "unknown node" };
  const labels = new Map(g.nodes.map((n) => [String(n.id), n]));
  const inbound: Record<string, string[]> = {};
  const outbound: Record<string, string[]> = {};
  for (const l of g.links) {
    if (String(l.source) === nodeId) {
      const t = labels.get(String(l.target));
      (outbound[String(l.relation)] ??= []).push(String(t?.label ?? l.target));
    } else if (String(l.target) === nodeId) {
      const s = labels.get(String(l.source));
      (inbound[String(l.relation)] ??= []).push(String(s?.label ?? l.source));
    }
  }
  const sourceFile = String(node.source_file ?? "");
  let file: Record<string, unknown> | undefined;
  if (sourceFile) {
    const abs = join(repoRoot, sourceFile);
    if (existsSync(abs) && statSync(abs).isFile()) {
      const st = statSync(abs);
      let lineCount = 0;
      try {
        lineCount = readFileSync(abs, "utf8").split("\n").length;
      } catch { /* binary or unreadable */ }
      file = { path: sourceFile, size: st.size, lines: lineCount, mtime: new Date(st.mtimeMs).toISOString() };
    } else {
      file = { path: sourceFile, missing: true };
    }
    // Sibling nodes defined in the same file — "related files/modules" anchor.
  }
  const siblings = sourceFile
    ? g.nodes.filter((n) => String(n.source_file ?? "") === sourceFile && String(n.id) !== nodeId)
        .slice(0, 12).map((n) => ({ id: n.id, label: n.label }))
    : [];
  const related = await toolSearchMemory(repoRoot, String(node.label ?? nodeId));
  // Vector hits for this node (only when an embedding provider is live).
  let vectors: unknown[] = [];
  const embedCfg = resolveEmbedConfig({ repoRoot });
  if (embedCfg.available && memoryConfigured(repoRoot)) {
    try {
      vectors = await withDbSerial(
        (db, c) => queryVectors(db, embedCfg, c.repoId, `${node.label} ${sourceFile}`, 5),
        repoRoot,
      );
    } catch { /* vectors are optional garnish */ }
  }
  return {
    node: { id: node.id, label: node.label, file_type: node.file_type, community: node.community, origin: node._origin },
    file, siblings, inbound, outbound, related, vectors,
  };
}

// ---- Vectors panel (embedding status + per-file coverage) -----------------------------

async function collectVectors(repoRoot: string): Promise<Record<string, unknown>> {
  const cfg = resolveEmbedConfig({ repoRoot });
  const status = {
    provider: cfg.provider, model: cfg.model, model_key: cfg.modelKey, dimension: cfg.dimension,
    approved: cfg.approved, key_present: cfg.apiKeyPresent, available: cfg.available, reason: cfg.reason,
  };
  if (!memoryConfigured(repoRoot)) return { status, error: "dev-memory not configured" };
  try {
    return await withDbSerial(async (db, c) => {
      const chunks = await queryResult<Array<{ source_path?: string; content_hash?: string }>>(
        db, "SELECT source_path, content_hash FROM doc_chunk WHERE repo_id = $repo LIMIT 5000", { repo: c.repoId });
      const embedded = await queryResult<Array<{ content_hash?: string }>>(
        db, "SELECT content_hash FROM embedding_chunk WHERE repo_id = $repo AND embedding_model = $m LIMIT 10000",
        { repo: c.repoId, m: cfg.modelKey });
      const have = new Set(embedded.map((e) => String(e.content_hash)));
      const byFile = new Map<string, { chunks: number; embedded: number }>();
      for (const ch of chunks) {
        const f = byFile.get(String(ch.source_path)) ?? { chunks: 0, embedded: 0 };
        f.chunks++;
        if (have.has(String(ch.content_hash))) f.embedded++;
        byFile.set(String(ch.source_path), f);
      }
      const files = [...byFile.entries()]
        .map(([path, f]) => ({ path, ...f, pending: f.chunks - f.embedded }))
        .sort((a, b) => b.pending - a.pending || b.chunks - a.chunks);
      const models = await listEmbeddingModels(db, c.repoId);
      return {
        status,
        totals: { chunks: chunks.length, embedded: have.size, pending: chunks.length - files.reduce((s, f) => s + f.embedded, 0) },
        files: files.slice(0, 40),
        models: models.map((m) => ({ provider: m.provider, model: m.model, dimension: m.dimension, updated_at: m.updated_at })),
      };
    }, repoRoot);
  } catch (err) {
    return { status, error: (err as Error).message };
  }
}

async function embedPending(repoRoot: string): Promise<Record<string, unknown>> {
  const cfg = resolveEmbedConfig({ repoRoot });
  if (!cfg.available) return { error: `embedding unavailable: ${cfg.reason}` };
  if (!memoryConfigured(repoRoot)) return { error: "dev-memory not configured" };
  try {
    return await withDbSerial(async (db, c) => {
      const targets = await gatherDbTargets(db, c.repoId, cfg.modelKey, 500);
      if (!targets.length) return { embedded: 0, skipped: 0, errors: 0, note: "nothing pending" };
      return { ...(await embedChunks(db, cfg, c.repoId, targets)) } as Record<string, unknown>;
    }, repoRoot);
  } catch (err) {
    return { error: (err as Error).message };
  }
}

// ---- Tasks (expandable todo detail) ---------------------------------------------------

async function collectTasks(repoRoot: string): Promise<Array<Record<string, unknown>>> {
  if (!memoryConfigured(repoRoot)) return [];
  try {
    return await withDbSerial(async (db, c) => {
      const tasks = await queryResult<Array<Record<string, unknown>>>(
        db,
        `SELECT id, goal, status, phase, tags, source_agent, created_at, updated_at, done_at FROM task
         WHERE repo_id = $repo ORDER BY created_at DESC LIMIT 30`,
        { repo: c.repoId },
      );
      const blockers = await queryResult<Array<Record<string, unknown>>>(
        db,
        "SELECT text, summary, status, task_goal, created_at FROM blocker WHERE repo_id = $repo LIMIT 50",
        { repo: c.repoId },
      );
      return tasks.map((t) => ({
        ...t,
        id: String(t.id),
        // Legacy rows carry `phase` instead of `status`; clients require status.
        status: String(t.status ?? t.phase ?? "open"),
        blockers: blockers.filter((b) => b.task_goal && b.task_goal === t.goal),
      }));
    }, repoRoot);
  } catch {
    return [];
  }
}

const TASK_STATUSES = new Set(["open", "in_progress", "blocked", "done"]);

/** Create a task directly from the dashboard (no agent involved) — mirrors dfc:task add. */
async function addTask(repoRoot: string, goal: string): Promise<Record<string, unknown>> {
  if (!goal) return { error: "goal required" };
  if (!memoryConfigured(repoRoot)) return { error: "dev-memory not configured" };
  const now = new Date().toISOString();
  try {
    return await withDbSerial(async (db, c) => {
      const doc = {
        repo_id: c.repoId,
        source_agent: "manual",
        goal: goal.slice(0, 500),
        status: "open",
        tags: Array.from(new Set([...detectRiskTerms(goal), ...tokenize(goal).slice(0, 5)])),
        created_at: now,
        updated_at: now,
      };
      const created = await db.create(new Table("task")).content(doc);
      const row = Array.isArray(created) ? created[0] : created;
      return { id: String((row as { id?: unknown }).id ?? ""), goal: doc.goal };
    }, repoRoot);
  } catch (err) {
    return { error: (err as Error).message };
  }
}

async function setTaskStatus(repoRoot: string, id: string, status: string): Promise<Record<string, unknown>> {
  if (!/^task:[-\w⟨⟩]+$/u.test(id)) return { error: "invalid task id" };
  if (!TASK_STATUSES.has(status)) return { error: "invalid status" };
  if (!memoryConfigured(repoRoot)) return { error: "dev-memory not configured" };
  const now = new Date().toISOString();
  try {
    return await withDbSerial(async (db) => {
      const patch: Record<string, unknown> = { status, updated_at: now };
      if (status === "done") patch.done_at = now;
      await queryResult(db, "UPDATE $th MERGE $patch", { th: new StringRecordId(id), patch });
      return { id, status };
    }, repoRoot);
  } catch (err) {
    return { error: (err as Error).message };
  }
}

// ---- Mercury assistant (OpenAI-compatible, read-only tools) -------------------------

interface MercuryConfig {
  key: string;
  baseUrl: string;
  model: string;
}

function loadMercuryConfig(repoRoot: string): MercuryConfig {
  const fileEnv = {
    ...parseEnvFile(join(REPO_ROOT, ".dfc", "mercury.env")),
    ...parseEnvFile(join(repoRoot, ".dfc", "mercury.env")),
  };
  const get = (k: string): string => (process.env[k] ?? fileEnv[k] ?? "").trim();
  return {
    key: get("MERCURY_API_KEY"),
    baseUrl: (get("MERCURY_BASE_URL") || "https://api.inceptionlabs.ai/v1").replace(/\/$/, ""),
    model: get("MERCURY_MODEL") || "mercury-2",
  };
}

const ASSISTANT_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_graph",
      description: "Search the repo knowledge graph (files, modules, symbols, concepts) by name/keyword. Returns matching nodes with kind, file, and community.",
      parameters: {
        type: "object",
        required: ["query"],
        properties: { query: { type: "string", description: "substring/keyword to match node labels and file paths" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "graph_neighbors",
      description: "List edges touching a graph node id (dependencies, callers, containment). Use a node id returned by search_graph.",
      parameters: {
        type: "object",
        required: ["node_id"],
        properties: { node_id: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_memory",
      description: "Full-text search the dev-memory database: decisions, lessons, snippets, repo facts, evidence, plus open tasks and blockers.",
      parameters: {
        type: "object",
        required: ["query"],
        properties: { query: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_state",
      description: "Snapshot of the repo/system state: git branch, health checks, session activity, sync/backend mode, metrics summary, token totals.",
      parameters: { type: "object", properties: {} },
    },
  },
];

interface GraphData {
  nodes: Array<Record<string, unknown>>;
  links: Array<Record<string, unknown>>;
}

let graphDataCache: { mtimeMs: number; data: GraphData } | undefined;

function loadGraphData(repoRoot: string): GraphData | undefined {
  const path = join(repoRoot, "graphify-out", "graph.json");
  if (!existsSync(path)) return undefined;
  const mtimeMs = statSync(path).mtimeMs;
  if (graphDataCache && graphDataCache.mtimeMs === mtimeMs) return graphDataCache.data;
  const raw = readJson(path) as GraphData | undefined;
  if (!raw?.nodes) return undefined;
  graphDataCache = { mtimeMs, data: raw };
  return raw;
}

function toolSearchGraph(repoRoot: string, query: string): unknown {
  const g = loadGraphData(repoRoot);
  if (!g) return { error: "no repo graph — run /graphify" };
  const q = query.toLowerCase();
  const hits = g.nodes
    .filter((n) => String(n.label ?? "").toLowerCase().includes(q) || String(n.source_file ?? "").toLowerCase().includes(q))
    .slice(0, 12)
    .map((n) => ({ id: n.id, label: n.label, file_type: n.file_type, source_file: n.source_file, community: n.community }));
  return { matches: hits, total_nodes: g.nodes.length };
}

function toolGraphNeighbors(repoRoot: string, nodeId: string): unknown {
  const g = loadGraphData(repoRoot);
  if (!g) return { error: "no repo graph — run /graphify" };
  const labels = new Map(g.nodes.map((n) => [String(n.id), String(n.label ?? n.id)]));
  const edges = g.links
    .filter((l) => String(l.source) === nodeId || String(l.target) === nodeId)
    .slice(0, 30)
    .map((l) => ({
      relation: l.relation,
      from: labels.get(String(l.source)) ?? l.source,
      to: labels.get(String(l.target)) ?? l.target,
      source_file: l.source_file,
    }));
  return { node: labels.get(nodeId) ?? nodeId, edges };
}

async function toolSearchMemory(repoRoot: string, query: string): Promise<unknown> {
  if (!memoryConfigured(repoRoot)) return { error: "dev-memory not configured" };
  try {
    return await withDbSerial(async (db, c) => {
      const out: Record<string, unknown> = {};
      for (const table of ["decision", "lesson", "snippet", "repo_fact", "evidence_item"]) {
        try {
          out[table] = await queryResult<unknown[]>(
            db,
            `SELECT summary, tags, created_at FROM type::table($t) WHERE repo_id = $repo AND (summary @@ $q OR text @@ $q) LIMIT 5`,
            { t: table, repo: c.repoId, q: query },
          );
        } catch {
          out[table] = [];
        }
      }
      try {
        out.open_tasks = await queryResult<unknown[]>(
          db,
          "SELECT goal, status, created_at FROM task WHERE repo_id = $repo AND status IN ['open','in_progress','blocked'] LIMIT 10",
          { repo: c.repoId },
        );
        out.open_blockers = await queryResult<unknown[]>(
          db,
          "SELECT summary, status, created_at FROM blocker WHERE repo_id = $repo AND status = 'open' LIMIT 10",
          { repo: c.repoId },
        );
      } catch { /* state tables optional */ }
      return out;
    }, repoRoot);
  } catch (err) {
    return { error: (err as Error).message };
  }
}

async function toolGetState(repoRoot: string): Promise<unknown> {
  const memory = await collectMemory(repoRoot, false);
  const tokens = collectTokens(repoRoot);
  return {
    repo: {
      branch: git(repoRoot, "rev-parse", "--abbrev-ref", "HEAD"),
      head: git(repoRoot, "log", "-1", "--format=%h %s"),
    },
    health: collectHealth(repoRoot),
    sessions: collectSessions(repoRoot).slice(0, 8),
    spawned_agents: serializeAgents(repoRoot).map(({ lines: _lines, ...a }) => a).slice(0, 8),
    sync: collectSync(repoRoot),
    workflows: collectWorkflows(repoRoot).map((w) => ({ name: w.name, description: w.description })),
    memory_counts: memory.counts ?? {},
    open_tasks: memory.open_tasks ?? [],
    open_blockers: memory.open_blockers ?? [],
    tokens: { totals: tokens.totals, by_model: tokens.by_model },
  };
}

async function runAssistantTool(repoRoot: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "search_graph":
      return toolSearchGraph(repoRoot, String(args.query ?? ""));
    case "graph_neighbors":
      return toolGraphNeighbors(repoRoot, String(args.node_id ?? ""));
    case "search_memory":
      return toolSearchMemory(repoRoot, String(args.query ?? ""));
    case "get_state":
      return toolGetState(repoRoot);
    default:
      return { error: `unknown tool: ${name}` };
  }
}

const ASSISTANT_SYSTEM = (repoRoot: string): string =>
  `You are the read-only Voidarch Studio assistant of the dashboard for the repository at ${repoRoot}. ` +
  `Answer questions about the repo, its architecture, its dev-memory (decisions/lessons/snippets/repo facts/tasks/blockers), ` +
  `agents, workflows, metrics, and token usage. Use the tools to look things up before answering; prefer tool facts over guesses. ` +
  `You cannot modify anything. Be concise and concrete; cite file paths and node names when relevant.`;

interface AssistantMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

async function handleAssistant(repoRoot: string, body: { messages?: Array<{ role: string; content: string }> }): Promise<Record<string, unknown>> {
  const mercury = loadMercuryConfig(repoRoot);
  if (!mercury.key) {
    return { error: "Mercury not configured. Set MERCURY_API_KEY (and optional MERCURY_BASE_URL, MERCURY_MODEL) in .dfc/mercury.env." };
  }
  const history = (body.messages ?? []).slice(-16).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content ?? "").slice(0, 8000),
  }));
  const messages: AssistantMessage[] = [
    { role: "system", content: ASSISTANT_SYSTEM(repoRoot) },
    ...history,
  ];
  const trace: Array<{ tool: string; args: unknown }> = [];
  const MAX_ROUNDS = loadNoxDefaults(repoRoot).assistant_rounds;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    // Last round: withhold tools so the model must synthesize an answer from
    // what it has gathered instead of looping on lookups forever.
    const finalRound = round === MAX_ROUNDS - 1;
    if (finalRound) {
      messages.push({
        role: "system",
        content: "Tool budget exhausted. Answer the user's question now from the tool results above.",
      });
    }
    const res = await fetch(`${mercury.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${mercury.key}` },
      body: JSON.stringify({
        model: mercury.model,
        messages,
        ...(finalRound ? {} : { tools: ASSISTANT_TOOLS }),
        max_tokens: 1200,
      }),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 400);
      return { error: `Mercury API ${res.status}: ${text}` };
    }
    const data = (await res.json()) as { choices?: Array<{ message?: AssistantMessage }> };
    const msg = data.choices?.[0]?.message;
    if (!msg) return { error: "Mercury returned no choices" };
    messages.push(msg);
    const toolCalls = msg.tool_calls ?? [];
    if (!toolCalls.length) {
      return { reply: msg.content ?? "", trace };
    }
    for (const call of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch { /* tolerate malformed args */ }
      trace.push({ tool: call.function.name, args });
      const result = await runAssistantTool(repoRoot, call.function.name, args);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 12_000),
      });
    }
  }
  return { error: `Assistant exceeded tool-call budget (${MAX_ROUNDS} rounds) without a final answer.`, trace };
}

// ---- State assembly ------------------------------------------------------------

let vectorsCache: { at: number; value: Record<string, unknown> } | undefined;
let tasksCache: { at: number; value: Array<Record<string, unknown>> } | undefined;
const VECTORS_TTL_MS = 60_000;

async function buildState(repoRoot: string, fresh: boolean): Promise<Record<string, unknown>> {
  const cfg = loadConfig({ repoRoot });
  const dirty = git(repoRoot, "status", "--porcelain");
  const memory = await collectMemory(repoRoot, fresh);
  if (fresh || !vectorsCache || Date.now() - vectorsCache.at > VECTORS_TTL_MS) {
    const next = await collectVectors(repoRoot);
    // Embedded SurrealKV connects time out intermittently — keep the last good snapshot.
    if (!next.error || !vectorsCache || vectorsCache.value.error) vectorsCache = { at: Date.now(), value: next };
    else vectorsCache.at = Date.now();
  }
  if (fresh || !tasksCache || Date.now() - tasksCache.at > VECTORS_TTL_MS) {
    const next = await collectTasks(repoRoot);
    if (next.length || !tasksCache) tasksCache = { at: Date.now(), value: next };
    else tasksCache.at = Date.now();
  }
  return {
    config: collectConfig(repoRoot),
    vectors: vectorsCache.value,
    tasks: tasksCache.value,
    generated_at: new Date().toISOString(),
    repo: {
      root: repoRoot,
      repo_id: cfg.repoId,
      database: cfg.database,
      plugin_root: REPO_ROOT,
      branch: git(repoRoot, "rev-parse", "--abbrev-ref", "HEAD") || "(not a git repo)",
      head: git(repoRoot, "log", "-1", "--format=%h %s"),
      dirty_files: dirty ? dirty.split("\n").length : 0,
    },
    health: collectHealth(repoRoot),
    sessions: collectSessions(repoRoot),
    spawned_agents: serializeAgents(repoRoot),
    worktrees: listStudioWorktrees(repoRoot),
    studio_runs: await listStudioRuns(repoRoot),
    recent_events: readJsonl(join(repoRoot, ".agent-runs", "current.jsonl")).slice(-60).reverse(),
    approvals: collectApprovals(repoRoot),
    graph: collectGraph(repoRoot),
    workflows: collectWorkflows(repoRoot),
    sync: collectSync(repoRoot),
    tokens: collectTokens(repoRoot, memory.metrics
      ? { total_packs: memory.metrics.retrieval.total, avg_estimated_tokens: memory.metrics.retrieval.avg_estimated_tokens }
      : undefined),
    memory,
    assistant: { configured: Boolean(loadMercuryConfig(repoRoot).key), model: loadMercuryConfig(repoRoot).model },
  };
}

// ---- Static serving --------------------------------------------------------------

const STATIC_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".js": "text/javascript",
  ".css": "text/css",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
};

function serveFile(baseDir: string, rel: string): { type: string; body: Buffer } | undefined {
  const clean = normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const abs = join(baseDir, clean);
  if (!abs.startsWith(baseDir)) return undefined;
  const type = STATIC_TYPES[extname(abs)];
  if (!type || !existsSync(abs) || !statSync(abs).isFile()) return undefined;
  return { type, body: readFileSync(abs) };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 256 * 1024) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));
}

// ---- Server ---------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = repoRootFromArgs(args);
  const port = Number.parseInt(args.port || process.env.DFC_DASHBOARD_PORT || "4949", 10);
  const uiDir = join(REPO_ROOT, "dashboard");

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    // repo-scoped routes accept ?repo=<registry id or path>; default = startup repo
    const reqRepo = () => resolveRepoParam(url.searchParams.get("repo"));
    try {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        const file = serveFile(uiDir, "index.html");
        if (file) res.writeHead(200, { "Content-Type": file.type }).end(file.body);
        else res.writeHead(500).end("dashboard/index.html missing");
      } else if (url.pathname === "/api/state") {
        sendJson(res, 200, await buildState(repoRoot, url.searchParams.get("fresh") === "1"));
      } else if (url.pathname === "/api/agents" && req.method === "GET") {
        sendJson(res, 200, { agents: serializeAgents(repoRoot) });
      } else if (/^\/api\/agents\/[^/]+\/log$/.test(url.pathname) && req.method === "GET") {
        sendJson(res, 200, { lines: agentLog(repoRoot, url.pathname.split("/")[3]) });
      } else if (/^\/api\/agents\/[^/]+\/retry$/.test(url.pathname) && req.method === "POST") {
        const src = serializeAgents(repoRoot).find((a) => a.id === url.pathname.split("/")[3]);
        if (!src || src.prompt === "(prompt not recorded)") {
          sendJson(res, 400, { error: "no recorded prompt to retry" });
        } else {
          const agent = launchAgent(repoRoot, src.prompt, src.permission_mode === "?" ? "acceptEdits" : src.permission_mode,
            { tools: src.tools, workflow: src.workflow, provider: src.provider, model: src.model, effort: src.effort, purpose: src.purpose });
          sendJson(res, 200, { id: agent.id, status: agent.status });
        }
      } else if (/^\/api\/agents\/[^/]+\/resume$/.test(url.pathname) && req.method === "POST") {
        const src = serializeAgents(repoRoot).find((a) => a.id === url.pathname.split("/")[3]);
        const body = JSON.parse((await readBody(req)) || "{}") as { prompt?: string };
        const prompt = String(body.prompt ?? "").trim();
        if (!src?.session_id) {
          sendJson(res, 400, { error: "run has no recorded session_id to resume" });
        } else if (!prompt) {
          sendJson(res, 400, { error: "prompt required" });
        } else {
          const agent = launchAgent(repoRoot, prompt.slice(0, 8000),
            src.permission_mode === "?" ? "acceptEdits" : src.permission_mode,
            { tools: src.tools, workflow: src.workflow, resumeSessionId: src.session_id });
          sendJson(res, 200, { id: agent.id, status: agent.status });
        }
      } else if (/^\/api\/hooked-sessions\/[^/]+$/.test(url.pathname) && req.method === "GET") {
        const detail = sessionDetail(repoRoot, url.pathname.split("/")[3]);
        if (detail) sendJson(res, 200, detail);
        else sendJson(res, 404, { error: "unknown session" });
      } else if (url.pathname === "/api/repos" && req.method === "GET") {
        sendJson(res, 200, reposPayload());
      } else if (url.pathname === "/api/repos" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as { root?: string };
        const result = addRepo(String(body.root ?? ""));
        sendJson(res, "error" in result ? 400 : 200, result);
      } else if (/^\/api\/repos\/[^/]+$/.test(url.pathname) && req.method === "DELETE") {
        const ok = removeRepo(decodeURIComponent(url.pathname.split("/")[3] ?? ""));
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "unknown repo" });
      } else if (url.pathname === "/api/profiles" && req.method === "GET") {
        sendJson(res, 200, { profiles: listProfiles() });
      } else if (url.pathname === "/api/profiles" && req.method === "PUT") {
        const body = JSON.parse((await readBody(req)) || "{}") as { profiles?: ProviderProfile[] };
        if (!Array.isArray(body.profiles)) {
          sendJson(res, 400, { error: "profiles array required" });
        } else {
          saveProfiles(body.profiles);
          sendJson(res, 200, { ok: true, profiles: listProfiles() });
        }
      } else if (url.pathname === "/api/prompt/render" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as { task?: string; contextPack?: string; worktreePath?: string };
        sendJson(res, 200, renderPrompt(String(body.task ?? ""), body.contextPack ?? "", body.worktreePath ?? ""));
      } else if (url.pathname === "/api/sessions" && req.method === "GET") {
        const repo = url.searchParams.get("repo");
        sendJson(res, 200, { sessions: listSessions(repo ? resolveRepoParam(repo) : undefined) });
      } else if (url.pathname === "/api/sessions" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as {
          repo?: string; profileId?: string; taskId?: string; worktreeId?: string;
          cwd?: string; prompt?: string; model?: string; effort?: string;
        };
        try {
          const sessRepo = resolveRepoParam(body.repo);
          let cwd = body.cwd;
          if (!cwd && body.worktreeId) {
            const wt = listStudioWorktrees(sessRepo).find((w) => w.id === body.worktreeId);
            if (!wt) throw new Error(`unknown worktree: ${body.worktreeId}`);
            cwd = wt.path;
          }
          const meta = createSession({
            repoRoot: sessRepo, profileId: String(body.profileId ?? ""), taskId: body.taskId,
            worktreeId: body.worktreeId, cwd, prompt: body.prompt, model: body.model, effort: body.effort,
          });
          sendJson(res, 200, meta);
        } catch (err) {
          sendJson(res, 400, { error: (err as Error).message });
        }
      } else if (/^\/api\/sessions\/[^/]+$/.test(url.pathname) && req.method === "GET") {
        const id = url.pathname.split("/")[3] ?? "";
        const live = getSession(id);
        if (live) sendJson(res, 200, { session: live.meta, tail: sessionTail(id) });
        else sendJson(res, 404, { error: "unknown session" });
      } else if (/^\/api\/sessions\/[^/]+$/.test(url.pathname) && req.method === "DELETE") {
        const id = url.pathname.split("/")[3] ?? "";
        const ok = deleteSession(id, url.searchParams.get("purge") === "1");
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "unknown session" });
      } else if (/^\/api\/sessions\/[^/]+\/input$/.test(url.pathname) && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as { data?: string };
        const ok = writeSession(url.pathname.split("/")[3] ?? "", String(body.data ?? ""));
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "session not running" });
      } else if (/^\/api\/sessions\/[^/]+\/signal$/.test(url.pathname) && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as { signal?: string };
        const sig = ["SIGINT", "SIGTERM", "SIGKILL"].includes(String(body.signal)) ? body.signal as "SIGINT" | "SIGTERM" | "SIGKILL" : "SIGTERM";
        const ok = signalSession(url.pathname.split("/")[3] ?? "", sig);
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "session not running" });
      } else if (/^\/api\/sessions\/[^/]+\/resize$/.test(url.pathname) && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as { cols?: number; rows?: number };
        const ok = resizeSession(url.pathname.split("/")[3] ?? "", Number(body.cols), Number(body.rows));
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "session not running" });
      } else if (/^\/api\/sessions\/[^/]+\/respawn$/.test(url.pathname) && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as { resume?: boolean; prompt?: string };
        try {
          sendJson(res, 200, respawnSession(url.pathname.split("/")[3] ?? "", { resume: !!body.resume, prompt: body.prompt }));
        } catch (err) {
          sendJson(res, 400, { error: (err as Error).message });
        }
      } else if (url.pathname === "/api/workflows/run" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as { name?: string };
        const wf = collectWorkflows(repoRoot).find((w) => w.name === String(body.name ?? ""));
        if (!wf) {
          sendJson(res, 400, { error: "unknown workflow" });
        } else {
          const agent = launchAgent(
            repoRoot,
            `Execute the workflow script at ${wf.file} using the Workflow tool (pass {scriptPath: ${JSON.stringify(wf.file)}}). ` +
              `Wait for it to complete and report the returned result concisely.`,
            "acceptEdits",
            { workflow: wf.name },
          );
          sendJson(res, 200, { id: agent.id, status: agent.status, workflow: wf.name });
        }
      } else if (url.pathname === "/api/node" && req.method === "GET") {
        sendJson(res, 200, await nodeDetail(repoRoot, url.searchParams.get("id") ?? ""));
      } else if (url.pathname === "/api/config" && req.method === "GET") {
        sendJson(res, 200, collectConfig(repoRoot));
      } else if (url.pathname === "/api/config" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as { file?: string; values?: Record<string, string> };
        try {
          const result = writeConfigFile(repoRoot, String(body.file ?? ""), body.values ?? {});
          vectorsCache = undefined; // config change may alter embed status
          sendJson(res, 200, { ...result, config: collectConfig(repoRoot) });
        } catch (err) {
          sendJson(res, 400, { error: (err as Error).message });
        }
      } else if (url.pathname === "/api/tasks/add" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as { goal?: string };
        const result = await addTask(reqRepo(), String(body.goal ?? "").trim());
        tasksCache = undefined;
        sendJson(res, result.error ? 400 : 200, result);
      } else if (url.pathname === "/api/tasks/status" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as { id?: string; status?: string };
        const result = await setTaskStatus(reqRepo(), String(body.id ?? ""), String(body.status ?? ""));
        tasksCache = undefined;
        sendJson(res, result.error ? 400 : 200, result);
      } else if (url.pathname === "/api/context" && req.method === "GET") {
        // Studio Context Pack panel: markdown context pack + token estimate (#27).
        const task = (url.searchParams.get("task") ?? "").trim();
        const ctxRepo = reqRepo();
        if (!task) {
          sendJson(res, 400, { error: "task query param required" });
        } else if (!memoryConfigured(ctxRepo)) {
          sendJson(res, 400, { error: "dev-memory not configured" });
        } else {
          try {
            const result = await withDbSerial(async (db, c) => {
              const pack = await buildContextPack(db, c.repoId, task, { repoRoot: ctxRepo });
              return {
                task,
                markdown: formatContextPackMarkdown(pack),
                token_estimate: pack.token_budget?.estimated_tokens ?? null,
                target_tokens: pack.token_budget?.target_tokens ?? null,
              };
            }, ctxRepo);
            sendJson(res, 200, result);
          } catch (err) {
            sendJson(res, 500, { error: (err as Error).message });
          }
        }
      } else if (url.pathname === "/api/worktrees" && req.method === "GET") {
        sendJson(res, 200, { worktrees: listStudioWorktrees(reqRepo()) });
      } else if (url.pathname === "/api/worktrees" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as { taskId?: string; branch?: string; baseRef?: string };
        const result = createStudioWorktree(reqRepo(), body);
        sendJson(res, result.error ? 400 : 200, result);
      } else if (/^\/api\/worktrees\/[^/]+\/diff$/.test(url.pathname) && req.method === "GET") {
        const id = decodeURIComponent(url.pathname.split("/")[3] ?? "");
        const result = diffStudioWorktree(reqRepo(), id);
        sendJson(res, result.error ? 404 : 200, result);
      } else if (/^\/api\/worktrees\/[^/]+$/.test(url.pathname) && req.method === "DELETE") {
        const id = decodeURIComponent(url.pathname.split("/")[3] ?? "");
        const result = deleteStudioWorktree(reqRepo(), id, url.searchParams.get("force") === "1");
        sendJson(res, result.error ? 400 : 200, result);
      } else if (url.pathname === "/api/runs" && req.method === "GET") {
        sendJson(res, 200, { runs: await listStudioRuns(repoRoot) });
      } else if (url.pathname === "/api/runs" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as {
          taskId?: string;
          worktreeId?: string;
          provider?: string;
          model?: string;
          promptProfileId?: string;
          promptHash?: string;
          transcriptPath?: string;
        };
        const result = await createStudioRun(repoRoot, body);
        sendJson(res, result.error ? 400 : 200, result);
      } else if (/^\/api\/runs\/[^/]+$/.test(url.pathname) && req.method === "GET") {
        const run = await getStudioRun(repoRoot, decodeURIComponent(url.pathname.split("/")[3] ?? ""));
        if (run) sendJson(res, 200, run);
        else sendJson(res, 404, { error: "unknown run" });
      } else if (/^\/api\/runs\/[^/]+\/finish$/.test(url.pathname) && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as {
          status?: string;
          exitCode?: unknown;
          changedFiles?: unknown;
          notes?: string;
        };
        const result = await finishStudioRun(repoRoot, decodeURIComponent(url.pathname.split("/")[3] ?? ""), body);
        sendJson(res, result.error ? 400 : 200, result);
      } else if (url.pathname === "/api/vectors" && req.method === "GET") {
        sendJson(res, 200, await collectVectors(repoRoot));
      } else if (url.pathname === "/api/vectors/embed" && req.method === "POST") {
        const result = await embedPending(repoRoot);
        vectorsCache = undefined;
        sendJson(res, result.error ? 400 : 200, result);
      } else if (url.pathname === "/api/agents/launch" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as {
          prompt?: string; permission_mode?: string; tools?: AgentTools;
          provider?: string; model?: string; effort?: string; purpose?: string;
        };
        const prompt = String(body.prompt ?? "").trim();
        if (!prompt) {
          sendJson(res, 400, { error: "prompt required" });
        } else {
          const agent = launchAgent(
            repoRoot, prompt.slice(0, 8000), String(body.permission_mode ?? "acceptEdits"),
            { tools: body.tools ?? {}, provider: body.provider, model: body.model, effort: body.effort, purpose: body.purpose });
          sendJson(res, 200, { id: agent.id, status: agent.status, provider: agent.provider, model: agent.model, effort: agent.effort });
        }
      } else if (/^\/api\/agents\/[^/]+\/kill$/.test(url.pathname) && req.method === "POST") {
        const id = url.pathname.split("/")[3];
        const agent = spawnedAgents.get(id);
        if (!agent) {
          sendJson(res, 404, { error: "unknown agent" });
        } else {
          if (agent.proc && agent.status === "running") {
            agent.status = "killed";
            agent.ended_at = new Date().toISOString();
            agent.proc.kill("SIGTERM");
          }
          sendJson(res, 200, { id, status: agent.status });
        }
      } else if (url.pathname === "/api/assistant" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as { messages?: Array<{ role: string; content: string }> };
        sendJson(res, 200, await handleAssistant(repoRoot, body));
      } else if (url.pathname.startsWith("/gout/")) {
        const file = serveFile(join(repoRoot, "graphify-out"), url.pathname.slice("/gout/".length));
        if (file) res.writeHead(200, { "Content-Type": file.type }).end(file.body);
        else res.writeHead(404).end("not found");
      } else {
        const file = serveFile(uiDir, url.pathname.slice(1));
        if (file) res.writeHead(200, { "Content-Type": file.type }).end(file.body);
        else res.writeHead(404).end("not found");
      }
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      sendJson(res, msg.startsWith("unknown repo") ? 400 : 500, { error: msg });
    }
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`port ${port} already in use — another Studio daemon is likely running.`);
      process.exit(0);
    }
    throw err;
  });

  initRepoRegistry(repoRoot);
  loadPersistedSessions();
  server.on("upgrade", (req, socket, head) => {
    if (!handleSessionUpgrade(req, socket, head)) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`voidarch-studio dashboard  →  http://127.0.0.1:${port}`);
    console.log(`repo root      →  ${repoRoot}`);
    console.log("Ctrl-C to stop.");
  });
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
