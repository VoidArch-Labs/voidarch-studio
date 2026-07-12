// studio-sessions — daemon-owned interactive PTY sessions for Voidarch Studio.
//
// Sessions are real PTYs (node-pty) running harness CLIs (claude, codex, plain shell)
// or anything a provider profile describes. The daemon owns the processes, so sessions
// survive closing the desktop app; they die with the daemon and are then reported as
// "orphaned" (transcript + resume info preserved).
//
// State:
//   ~/.voidarch-studio/providers.json    user provider profiles (same file the old Swift app used)
//   ~/.voidarch-studio/repos.json        registered repositories
//   <repo>/.agent-runs/studio-sessions/<id>/{meta.json,transcript.log}

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync,
  rmSync, statSync, writeFileSync, type WriteStream,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { IncomingMessage } from "node:http";
import pty from "node-pty";
import { WebSocketServer, type WebSocket } from "ws";

// pnpm strips the exec bit from node-pty's prebuilt spawn-helper; without it every
// spawn fails with "posix_spawnp failed". Fix it once at module load.
try {
  const base = join(process.cwd(), "node_modules", ".pnpm");
  for (const dir of readdirSync(base)) {
    if (!dir.startsWith("node-pty@")) continue;
    const prebuilds = join(base, dir, "node_modules", "node-pty", "prebuilds");
    if (!existsSync(prebuilds)) continue;
    for (const plat of readdirSync(prebuilds)) {
      const helper = join(prebuilds, plat, "spawn-helper");
      if (existsSync(helper)) chmodSync(helper, 0o755);
    }
  }
} catch { /* best-effort */ }

const STUDIO_HOME = join(homedir(), ".voidarch-studio");
const PROFILES_FILE = join(STUDIO_HOME, "providers.json");
const REPOS_FILE = join(STUDIO_HOME, "repos.json");

// ---- Provider profiles -----------------------------------------------------------

export interface ProviderProfile {
  id: string;
  displayName: string;
  command: string;
  args: string[];
  defaultModel: string;
  modelArgs: string[];   // e.g. ["--model", "{model}"], appended only when a model is set
  effortArgs: string[];  // appended only when an effort is set
  effort: string;
  envVars: Record<string, string>;
  supportsInteractive: boolean;
  promptInjectionMode: "arg" | "stdin" | "none";
  resumeArgs: string[];  // harness-native resume, e.g. ["-c"] for claude
}

const BUILTIN_PROFILES: ProviderProfile[] = [
  {
    id: "claude-code", displayName: "Claude Code", command: "claude", args: [],
    defaultModel: "sonnet", modelArgs: ["--model", "{model}"], effortArgs: [], effort: "",
    envVars: {}, supportsInteractive: true, promptInjectionMode: "arg", resumeArgs: ["-c"],
  },
  {
    id: "codex-cli", displayName: "Codex CLI", command: "codex", args: [],
    defaultModel: "", modelArgs: ["-m", "{model}"],
    effortArgs: ["-c", "model_reasoning_effort={effort}"], effort: "",
    envVars: {}, supportsInteractive: true, promptInjectionMode: "arg",
    resumeArgs: ["resume", "--last"],
  },
  {
    id: "generic-shell", displayName: "Shell", command: "/bin/zsh", args: ["-l"],
    defaultModel: "", modelArgs: [], effortArgs: [], effort: "",
    envVars: {}, supportsInteractive: true, promptInjectionMode: "stdin", resumeArgs: [],
  },
];

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function listProfiles(): ProviderProfile[] {
  const user = readJson<{ profiles?: Partial<ProviderProfile>[] }>(PROFILES_FILE)?.profiles ?? [];
  const merged = new Map<string, ProviderProfile>();
  for (const p of BUILTIN_PROFILES) merged.set(p.id, p);
  for (const u of user) {
    if (!u.id) continue;
    const base = merged.get(u.id) ?? BUILTIN_PROFILES[2];
    merged.set(u.id, { ...base, ...u, id: u.id } as ProviderProfile);
  }
  return [...merged.values()];
}

export function saveProfiles(profiles: ProviderProfile[]): void {
  mkdirSync(STUDIO_HOME, { recursive: true });
  writeFileSync(PROFILES_FILE, JSON.stringify({ profiles }, null, 2));
}

// ---- Repo registry ----------------------------------------------------------------

export interface RepoEntry {
  id: string;
  root: string;
  name: string;
}

let currentRepoRoot = "";

export function initRepoRegistry(startupRepoRoot: string): void {
  currentRepoRoot = resolve(startupRepoRoot);
  const repos = listRepos();
  if (!repos.some((r) => r.root === currentRepoRoot)) {
    repos.push({
      id: repoIdFor(currentRepoRoot, repos),
      root: currentRepoRoot,
      name: currentRepoRoot.split("/").pop() || currentRepoRoot,
    });
    persistRepos(repos);
  }
}

function repoIdFor(root: string, existing: RepoEntry[]): string {
  const base = (root.split("/").pop() || "repo").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  let id = base;
  let n = 2;
  while (existing.some((r) => r.id === id)) id = `${base}-${n++}`;
  return id;
}

export function listRepos(): RepoEntry[] {
  return (readJson<{ repos?: RepoEntry[] }>(REPOS_FILE)?.repos ?? []).filter(
    (r) => r && typeof r.root === "string" && existsSync(r.root),
  );
}

function persistRepos(repos: RepoEntry[]): void {
  mkdirSync(STUDIO_HOME, { recursive: true });
  writeFileSync(REPOS_FILE, JSON.stringify({ repos }, null, 2));
}

export function addRepo(root: string): RepoEntry | { error: string } {
  const abs = resolve(root);
  if (!existsSync(join(abs, ".git"))) return { error: `not a git repository: ${abs}` };
  const repos = listRepos();
  const found = repos.find((r) => r.root === abs);
  if (found) return found;
  const entry: RepoEntry = { id: repoIdFor(abs, repos), root: abs, name: abs.split("/").pop() || abs };
  repos.push(entry);
  persistRepos(repos);
  return entry;
}

export function removeRepo(id: string): boolean {
  const repos = listRepos();
  const filtered = repos.filter((r) => r.id !== id);
  if (filtered.length === repos.length) return false;
  persistRepos(filtered);
  return true;
}

export function reposPayload(): { repos: Array<RepoEntry & { current: boolean }> } {
  return { repos: listRepos().map((r) => ({ ...r, current: r.root === currentRepoRoot })) };
}

/** Resolve a ?repo= param (registry id or absolute path) to a repo root; default = startup repo. */
export function resolveRepoParam(param: string | null | undefined): string {
  if (!param) return currentRepoRoot;
  const repos = listRepos();
  const byId = repos.find((r) => r.id === param);
  if (byId) return byId.root;
  const abs = resolve(param);
  if (repos.some((r) => r.root === abs)) return abs;
  throw new Error(`unknown repo: ${param} (register it via POST /api/repos)`);
}

// ---- Prompt spec (ported from the retired SwiftUI app's PromptSpec) ----------------

const PROMPT_TEMPLATE = `## Role
You are an implementation agent working inside a dedicated git worktree.

## Task
{task}

## Repo context
{contextPack}

## Working directory
{worktreePath}

## Allowed
- Edit files inside the working directory, run builds and tests, commit locally.

## Forbidden
- Pushing, force operations, touching files outside the working directory, secrets.

## Verification
Run the project's checks before declaring done, and report what you ran.

## Output expectation
End with a concise summary: what changed, verification results, open concerns.`;

export function renderPrompt(task: string, contextPack = "", worktreePath = ""): { prompt: string; hash: string } {
  const prompt = PROMPT_TEMPLATE
    .replace("{task}", task || "(no task provided)")
    .replace("{contextPack}", contextPack || "(none attached)")
    .replace("{worktreePath}", worktreePath || "(repository root)");
  return { prompt, hash: createHash("sha256").update(prompt).digest("hex") };
}

// ---- Sessions ----------------------------------------------------------------------

export interface SessionMeta {
  id: string;
  repoRoot: string;
  profileId: string;
  taskId?: string;
  worktreeId?: string;
  model?: string;
  effort?: string;
  status: "running" | "exited" | "killed" | "orphaned";
  pid?: number;
  cols: number;
  rows: number;
  createdAt: string;
  exitedAt?: string;
  exitCode?: number;
  transcriptPath: string;
  promptHash?: string;
  respawnOf?: string;
  command: string;
  args: string[];
  cwd: string;
  prompt?: string; // kept for respawn
}

interface LiveSession {
  meta: SessionMeta;
  pty?: pty.IPty;
  buffer: string[];
  bufferBytes: number;
  sockets: Set<WebSocket>;
  transcript?: WriteStream;
}

const BUFFER_CAP = 512 * 1024;
const sessions = new Map<string, LiveSession>();

function sessionDir(repoRoot: string, id: string): string {
  return join(repoRoot, ".agent-runs", "studio-sessions", id);
}

function persistMeta(s: LiveSession): void {
  try {
    const dir = sessionDir(s.meta.repoRoot, s.meta.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "meta.json"), JSON.stringify(s.meta, null, 2));
  } catch (err) {
    console.error(`studio-sessions: persist failed for ${s.meta.id}:`, err);
  }
}

/** Load persisted sessions from all registered repos; anything "running" is orphaned now. */
export function loadPersistedSessions(): void {
  for (const repo of listRepos()) {
    const base = join(repo.root, ".agent-runs", "studio-sessions");
    if (!existsSync(base)) continue;
    for (const id of readdirSync(base)) {
      if (sessions.has(id)) continue;
      const meta = readJson<SessionMeta>(join(base, id, "meta.json"));
      if (!meta || typeof meta.id !== "string") continue; // malformed: skip, keep files on disk
      if (meta.status === "running") {
        meta.status = "orphaned";
        meta.exitedAt = meta.exitedAt ?? new Date().toISOString();
      }
      const live: LiveSession = { meta, buffer: [], bufferBytes: 0, sockets: new Set() };
      sessions.set(id, live);
      if (meta.status === "orphaned") persistMeta(live);
    }
  }
}

export function listSessions(repoRoot?: string): SessionMeta[] {
  const all = [...sessions.values()].map((s) => s.meta);
  const filtered = repoRoot ? all.filter((m) => m.repoRoot === repoRoot) : all;
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getSession(id: string): LiveSession | undefined {
  return sessions.get(id);
}

export function sessionTail(id: string, maxBytes = 64 * 1024): string {
  const s = sessions.get(id);
  if (!s) return "";
  if (s.buffer.length) {
    const joined = s.buffer.join("");
    return joined.length > maxBytes ? joined.slice(-maxBytes) : joined;
  }
  // exited/orphaned session loaded from disk: read transcript tail
  try {
    const path = s.meta.transcriptPath;
    const size = statSync(path).size;
    const fd = readFileSync(path);
    return fd.subarray(Math.max(0, size - maxBytes)).toString("utf8");
  } catch {
    return "";
  }
}

function commandExists(cmd: string): boolean {
  if (cmd.startsWith("/")) return existsSync(cmd);
  try {
    execFileSync("/usr/bin/which", [cmd], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${process.env.PATH}:${homedir()}/.local/bin:/opt/homebrew/bin:/usr/local/bin` },
    });
    return true;
  } catch {
    return false;
  }
}

export interface CreateSessionOpts {
  repoRoot: string;
  profileId: string;
  taskId?: string;
  worktreeId?: string;
  cwd?: string;       // resolved worktree path or repo root (caller resolves worktreeId)
  prompt?: string;
  model?: string;
  effort?: string;
  resume?: boolean;
  respawnOf?: string;
  cols?: number;
  rows?: number;
}

export function createSession(opts: CreateSessionOpts): SessionMeta {
  const profile = listProfiles().find((p) => p.id === opts.profileId);
  if (!profile) throw new Error(`unknown profile: ${opts.profileId}`);
  if (!commandExists(profile.command)) {
    throw new Error(`command not found: ${profile.command} (is the ${profile.displayName} CLI installed?)`);
  }

  const id = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const cwd = opts.cwd || opts.repoRoot;
  const cols = opts.cols ?? 120;
  const rows = opts.rows ?? 32;

  const args = [...profile.args];
  const model = opts.model ?? (profile.defaultModel || undefined);
  if (model) args.push(...profile.modelArgs.map((a) => a.replaceAll("{model}", model)));
  const effort = opts.effort ?? (profile.effort || undefined);
  if (effort && profile.effortArgs.length) args.push(...profile.effortArgs.map((a) => a.replaceAll("{effort}", effort)));
  if (opts.resume && profile.resumeArgs.length) args.push(...profile.resumeArgs);
  const prompt = (opts.prompt ?? "").trim();
  if (prompt && profile.promptInjectionMode === "arg") args.push(prompt);

  // Strip nested-Claude guards so sessions launch cleanly from within a Claude session.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_")) continue;
    if (v !== undefined) env[k] = v;
  }
  Object.assign(env, profile.envVars, { TERM: "xterm-256color", COLORTERM: "truecolor" });

  const dir = sessionDir(opts.repoRoot, id);
  mkdirSync(dir, { recursive: true });
  const transcriptPath = join(dir, "transcript.log");

  const meta: SessionMeta = {
    id, repoRoot: opts.repoRoot, profileId: profile.id, taskId: opts.taskId,
    worktreeId: opts.worktreeId, model, effort, status: "running", cols, rows,
    createdAt: new Date().toISOString(), transcriptPath,
    promptHash: prompt ? createHash("sha256").update(prompt).digest("hex") : undefined,
    respawnOf: opts.respawnOf, command: profile.command, args, cwd, prompt: prompt || undefined,
  };

  let child: pty.IPty;
  try {
    child = pty.spawn(profile.command, args, { name: "xterm-256color", cols, rows, cwd, env });
  } catch (err) {
    throw new Error(`failed to start ${profile.command}: ${(err as Error).message}`);
  }

  const live: LiveSession = {
    meta, pty: child, buffer: [], bufferBytes: 0, sockets: new Set(),
    transcript: createWriteStream(transcriptPath, { flags: "a" }),
  };
  meta.pid = child.pid;
  sessions.set(id, live);
  persistMeta(live);

  child.onData((data) => {
    live.buffer.push(data);
    live.bufferBytes += data.length;
    while (live.bufferBytes > BUFFER_CAP && live.buffer.length > 1) {
      live.bufferBytes -= live.buffer[0].length;
      live.buffer.shift();
    }
    live.transcript?.write(data);
    const frame = JSON.stringify({ t: "d", d: data });
    for (const ws of live.sockets) if (ws.readyState === ws.OPEN) ws.send(frame);
  });

  child.onExit(({ exitCode }) => {
    meta.status = meta.status === "killed" ? "killed" : "exited";
    meta.exitCode = exitCode;
    meta.exitedAt = new Date().toISOString();
    live.pty = undefined;
    live.transcript?.end();
    live.transcript = undefined;
    persistMeta(live);
    const frame = JSON.stringify({ t: "exit", code: exitCode });
    for (const ws of live.sockets) if (ws.readyState === ws.OPEN) ws.send(frame);
  });

  if (prompt && profile.promptInjectionMode === "stdin") {
    // ponytail: fixed delay like the old Swift app; a readiness handshake isn't worth it
    setTimeout(() => { try { live.pty?.write(`${prompt}\r`); } catch { /* exited */ } }, 1200);
  }

  return meta;
}

export function writeSession(id: string, data: string): boolean {
  const s = sessions.get(id);
  if (!s?.pty) return false;
  s.pty.write(data);
  return true;
}

export function resizeSession(id: string, cols: number, rows: number): boolean {
  const s = sessions.get(id);
  if (!s?.pty || !Number.isFinite(cols) || !Number.isFinite(rows)) return false;
  s.meta.cols = Math.max(20, Math.min(500, Math.floor(cols)));
  s.meta.rows = Math.max(5, Math.min(200, Math.floor(rows)));
  s.pty.resize(s.meta.cols, s.meta.rows);
  return true;
}

export function signalSession(id: string, signal: "SIGINT" | "SIGTERM" | "SIGKILL"): boolean {
  const s = sessions.get(id);
  if (!s?.pty) return false;
  if (signal === "SIGINT") {
    s.pty.write("\x03"); // deliver as a keystroke so the TUI harness handles it natively
    return true;
  }
  if (signal !== "SIGKILL") s.meta.status = "killed";
  try {
    s.pty.kill(signal);
  } catch {
    return false;
  }
  if (signal === "SIGKILL") s.meta.status = "killed";
  persistMeta(s);
  return true;
}

export function respawnSession(id: string, opts: { resume?: boolean; prompt?: string }): SessionMeta {
  const old = sessions.get(id);
  if (!old) throw new Error(`unknown session: ${id}`);
  if (old.pty) throw new Error("session still running; kill it first");
  const m = old.meta;
  return createSession({
    repoRoot: m.repoRoot, profileId: m.profileId, taskId: m.taskId, worktreeId: m.worktreeId,
    cwd: m.cwd, model: m.model, effort: m.effort,
    prompt: opts.prompt ?? (opts.resume ? undefined : m.prompt),
    resume: opts.resume, respawnOf: m.id, cols: m.cols, rows: m.rows,
  });
}

export function deleteSession(id: string, purge = false): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  if (s.pty) {
    s.meta.status = "killed";
    try { s.pty.kill("SIGTERM"); } catch { /* already dead */ }
  }
  for (const ws of s.sockets) { try { ws.close(); } catch { /* noop */ } }
  sessions.delete(id);
  if (purge) {
    try { rmSync(sessionDir(s.meta.repoRoot, id), { recursive: true, force: true }); } catch { /* noop */ }
  }
  return true;
}

// ---- WebSocket attach ---------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true });

export function handleSessionUpgrade(req: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");
  const m = /^\/ws\/sessions\/([^/]+)$/.exec(url.pathname);
  if (!m) return false;
  const s = sessions.get(m[1]);
  if (!s) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return true;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    s.sockets.add(ws);
    if (s.buffer.length) ws.send(JSON.stringify({ t: "d", d: s.buffer.join("") }));
    else {
      const tail = sessionTail(s.meta.id);
      if (tail) ws.send(JSON.stringify({ t: "d", d: tail }));
    }
    if (!s.pty) ws.send(JSON.stringify({ t: "exit", code: s.meta.exitCode ?? -1 }));
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { t: string; d?: string; cols?: number; rows?: number };
        if (msg.t === "i" && typeof msg.d === "string") writeSession(s.meta.id, msg.d);
        else if (msg.t === "r") resizeSession(s.meta.id, Number(msg.cols), Number(msg.rows));
      } catch { /* ignore malformed frames */ }
    });
    ws.on("close", () => s.sockets.delete(ws));
  });
  return true;
}
