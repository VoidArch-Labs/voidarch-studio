// dfc:dashboard - per-repo development dashboard. Local-only live server (127.0.0.1).
//
//   pnpm dfc:dashboard [--repo-root /path/to/repo] [--port 4949]
//
// Local-first: works with no SurrealDB credentials (memory panel degrades to "off").
// Sources: .agent-runs/ observability logs, graphify-out/ repo graph, plugin health
// (manifest/hooks/skills/agents), git state, and — when creds exist — SurrealDB
// dev-memory (table counts, open tasks/blockers, recent memories, deep metrics).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { parseArgs, repoRootFromArgs } from "../src/memory/cli.js";
import { type DfcMetrics, collectMetrics } from "../src/memory/metrics.js";
import { REPO_ROOT, isEmbeddedUrl, loadConfig, queryResult, withDb } from "../src/memory/surreal.js";

// Short timeouts for an interactive dashboard (only if the user has not overridden).
process.env.DFC_SURREAL_CONNECT_TIMEOUT_MS ??= "8000";
process.env.DFC_SURREAL_CONNECT_ATTEMPTS ??= "1";
process.env.DFC_SURREAL_QUERY_TIMEOUT_MS ??= "15000";

const MAX_JSONL_BYTES = 2 * 1024 * 1024;

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
}

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
    sessions.push({
      id,
      events: events.length,
      first: String(events[0]?.timestamp ?? ""),
      last: String(events[events.length - 1]?.timestamp ?? ""),
      top_tools: top,
      verified: existsSync(join(dir, id, "verification.json")),
      graph_scanned: existsSync(join(dir, id, "graph-scanned.json")),
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

async function collectMemory(repoRoot: string, fresh: boolean): Promise<MemoryPanel> {
  if (!fresh && memoryCache && Date.now() - memoryCache.at < MEMORY_TTL_MS) return memoryCache.value;
  const cfg = loadConfig({ repoRoot });
  const placeholder = /<[^>]+>/;
  const embedded = cfg.url ? isEmbeddedUrl(cfg.url) : false;
  if (
    !cfg.url ||
    placeholder.test(cfg.url) ||
    (!embedded && (!cfg.username || !cfg.password || placeholder.test(cfg.username + cfg.password)))
  ) {
    return { available: false, error: "not configured" };
  }
  let value: MemoryPanel;
  try {
    value = await withDb(async (db, c) => {
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
      const [decisions, evidence, lessons, repo_facts, snippets] = await Promise.all([
        recent("decision"), recent("evidence_item"), recent("lesson"), recent("repo_fact"), recent("snippet"),
      ]);
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
    }, { repoRoot });
  } catch (err) {
    value = { available: false, error: (err as Error).message };
  }
  memoryCache = { at: Date.now(), value };
  return value;
}

// ---- State assembly ------------------------------------------------------------

async function buildState(repoRoot: string, fresh: boolean): Promise<Record<string, unknown>> {
  const cfg = loadConfig({ repoRoot });
  const dirty = git(repoRoot, "status", "--porcelain");
  return {
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
    recent_events: readJsonl(join(repoRoot, ".agent-runs", "current.jsonl")).slice(-60).reverse(),
    approvals: collectApprovals(repoRoot),
    graph: collectGraph(repoRoot),
    memory: await collectMemory(repoRoot, fresh),
  };
}

// ---- Static serving for graphify-out/ -------------------------------------------

const STATIC_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".js": "text/javascript",
  ".css": "text/css",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function serveGraphifyFile(repoRoot: string, rel: string): { type: string; body: Buffer } | undefined {
  const clean = normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const abs = join(repoRoot, "graphify-out", clean);
  if (!abs.startsWith(join(repoRoot, "graphify-out"))) return undefined;
  const type = STATIC_TYPES[extname(abs)];
  if (!type || !existsSync(abs) || !statSync(abs).isFile()) return undefined;
  return { type, body: readFileSync(abs) };
}

// ---- HTML shell ------------------------------------------------------------------

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>dev-flow-control</title>
<style>
  :root { --bg:#0e1117; --card:#161b22; --line:#2d333b; --fg:#c9d1d9; --dim:#8b949e;
          --ok:#3fb950; --warn:#d29922; --fail:#f85149; --off:#6e7681; --accent:#58a6ff; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:14px/1.5 -apple-system, "Segoe UI", sans-serif; }
  header { display:flex; align-items:baseline; gap:16px; padding:14px 22px;
           border-bottom:1px solid var(--line); }
  header h1 { font-size:16px; margin:0; }
  header .sub { color:var(--dim); font-size:12px; }
  nav { display:flex; gap:4px; padding:8px 22px 0; }
  nav button { background:none; border:none; color:var(--dim); padding:8px 14px; cursor:pointer;
               font-size:13px; border-bottom:2px solid transparent; }
  nav button.active { color:var(--fg); border-bottom-color:var(--accent); }
  main { padding:18px 22px; max-width:1200px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:12px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:12px 14px; }
  .card h3 { margin:0 0 6px; font-size:13px; color:var(--dim); font-weight:600; }
  .pill { display:inline-block; padding:1px 8px; border-radius:10px; font-size:11px; font-weight:600; }
  .ok   { background:rgba(63,185,80,.15);  color:var(--ok); }
  .warn { background:rgba(210,153,34,.15); color:var(--warn); }
  .fail { background:rgba(248,81,73,.15);  color:var(--fail); }
  .off  { background:rgba(110,118,129,.15);color:var(--off); }
  table { width:100%; border-collapse:collapse; font-size:12.5px; margin-top:8px; }
  th { text-align:left; color:var(--dim); font-weight:600; padding:4px 8px; border-bottom:1px solid var(--line); }
  td { padding:4px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  code, .mono { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; }
  .dim { color:var(--dim); }
  .section { margin-bottom:22px; }
  a { color:var(--accent); text-decoration:none; }
  #refreshed { margin-left:auto; font-size:11px; color:var(--dim); }
</style></head><body>
<header><h1>dev-flow-control</h1><span class="sub" id="repoline"></span><span id="refreshed"></span></header>
<nav>
  <button data-tab="overview" class="active">Overview</button>
  <button data-tab="dev">Development</button>
  <button data-tab="sessions">Sessions</button>
  <button data-tab="graph">Graph</button>
</nav>
<main id="main">Loading…</main>
<script>
let state = null, tab = 'overview';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pill = (s) => '<span class="pill ' + s + '">' + s.toUpperCase() + '</span>';
const ts = (s) => s ? esc(String(s).replace('T',' ').slice(0,19)) : '';
const age = (s) => {
  const t = Date.parse(String(s ?? ''));
  if (!Number.isFinite(t)) return '';
  const d = Math.max(0, Math.floor((Date.now() - t) / 86400000));
  return d === 0 ? '<1d' : d + 'd';
};
const kv = (obj) => Object.entries(obj || {}).map(([k,v]) => esc(k) + ': <b>' + esc(v) + '</b>').join(' · ') || '<span class="dim">none</span>';

function renderOverview() {
  const h = state.health.map(c =>
    '<div class="card"><h3>' + esc(c.name) + '</h3>' + pill(c.status) +
    ' <span class="dim">' + esc(c.detail) + '</span></div>').join('');
  const r = state.repo;
  const g = state.graph;
  return '<div class="section"><div class="cards">' +
    '<div class="card"><h3>Repository</h3><div class="mono">' + esc(r.root) + '</div>' +
    '<div>branch <b>' + esc(r.branch) + '</b> · ' + r.dirty_files + ' dirty</div>' +
    '<div class="dim mono">' + esc(r.head) + '</div></div>' +
    '<div class="card"><h3>Repo graph</h3>' + (g.present
       ? g.nodes + ' nodes · ' + g.edges + ' edges<div class="dim">updated ' + ts(g.updated_at) + '</div>'
       : '<span class="dim">absent — run /graphify</span>') + '</div>' +
    h + '</div></div>';
}

function memTable(rows, cols) {
  if (!rows || !rows.length) return '<div class="dim">none</div>';
  return '<table><tr>' + cols.map(c => '<th>' + c + '</th>').join('') + '</tr>' +
    rows.map(r => '<tr>' + cols.map(c => '<td>' + (c==='created_at'?ts(r[c]):esc(Array.isArray(r[c])?r[c].join(', '):r[c])) + '</td>').join('') + '</tr>').join('') + '</table>';
}

function renderMetrics(x) {
  if (!x) return '';
  const growth = Object.entries(x.memories || {}).map(([k,v]) =>
    '<tr><td>' + esc(k) + '</td><td>' + v.last_7_days + '</td><td>' + v.last_30_days + '</td></tr>').join('');
  const tools = (x.tool_activity.by_tool || []).map(t =>
    '<tr><td class="mono">' + esc(t.tool_name) + '</td><td>' + t.count + '</td><td>' + t.ok + '</td><td>' + t.fail + '</td></tr>').join('');
  return '<div class="card" style="margin-top:12px"><h3>Metrics (last ' + x.days + ' days)</h3>' +
    '<div><b>Runs:</b> ' + x.runs.total + ' <span class="dim">(' + kv(x.runs.by_status) + ')</span></div>' +
    '<div><b>Tasks:</b> ' + kv(x.tasks.by_status) +
      (x.tasks.oldest_open_age_days != null ? ' <span class="dim">· oldest open ' + x.tasks.oldest_open_age_days + 'd</span>' : '') + '</div>' +
    '<div><b>Blockers:</b> open <b>' + x.blockers.open + '</b> · resolved <b>' + x.blockers.resolved + '</b>' +
      (x.blockers.oldest_open_age_days != null ? ' <span class="dim">· oldest open ' + x.blockers.oldest_open_age_days + 'd</span>' : '') + '</div>' +
    '<div><b>Retrieval:</b> ' + x.retrieval.total + ' packs · ' + x.retrieval.last_7_days + ' last 7d' +
      (x.retrieval.avg_estimated_tokens != null ? ' · avg ~' + x.retrieval.avg_estimated_tokens + ' tokens' : '') + '</div>' +
    '<div><b>Stale:</b> ' + x.stale.open_tasks_over_14_days.count + ' tasks open &gt;14d · ' +
      x.stale.open_blockers_over_7_days.count + ' blockers open &gt;7d</div>' +
    '<h3 style="margin-top:10px">Memory growth</h3>' +
    (growth ? '<table><tr><th>kind</th><th>7d</th><th>30d</th></tr>' + growth + '</table>' : '<div class="dim">none</div>') +
    '<h3 style="margin-top:10px">Tool activity (' + x.tool_activity.total + ' events)</h3>' +
    (tools ? '<table><tr><th>tool</th><th>count</th><th>ok</th><th>fail</th></tr>' + tools + '</table>' : '<div class="dim">none</div>') +
    '</div>';
}

function renderDev() {
  const m = state.memory;
  let mem;
  if (!m.available) {
    mem = '<div class="card"><h3>Dev-memory (SurrealDB)</h3>' + pill('off') +
          ' <span class="dim">' + esc(m.error || '') + '</span></div>';
  } else {
    const counts = Object.entries(m.counts).map(([k,v]) => k + ': <b>' + v + '</b>').join(' · ');
    const tasks = (m.open_tasks || []).length
      ? '<table><tr><th>goal</th><th>status</th><th>age</th></tr>' +
        m.open_tasks.map(t => '<tr><td>' + esc(t.goal) + '</td><td>' + esc(t.status) + '</td><td>' + age(t.created_at) + '</td></tr>').join('') + '</table>'
      : '<div class="dim">none</div>';
    const blockers = (m.open_blockers || []).length
      ? '<table><tr><th>blocker</th><th>age</th></tr>' +
        m.open_blockers.map(b => '<tr><td>' + esc(b.text || b.summary) + '</td><td>' + age(b.created_at) + '</td></tr>').join('') + '</table>'
      : '<div class="dim">none</div>';
    mem = '<div class="card"><h3>Dev-memory (SurrealDB)</h3><div class="dim">' + counts + '</div>' +
      '<h3 style="margin-top:10px">Open tasks</h3>' + tasks +
      '<h3 style="margin-top:10px">Open blockers</h3>' + blockers +
      '<h3 style="margin-top:10px">Recent decisions</h3>' + memTable(m.decisions, ['summary','source_agent','created_at']) +
      '<h3 style="margin-top:10px">Recent evidence</h3>' + memTable(m.evidence, ['summary','source_agent','created_at']) +
      '<h3 style="margin-top:10px">Recent lessons</h3>' + memTable(m.lessons, ['summary','source_agent','created_at']) +
      '<h3 style="margin-top:10px">Recent repo facts</h3>' + memTable(m.repo_facts, ['summary','source_agent','created_at']) +
      '<h3 style="margin-top:10px">Recent snippets</h3>' + memTable(m.snippets, ['summary','source_agent','created_at']) +
      '<h3 style="margin-top:10px">Recent agent runs</h3>' + memTable(m.agent_runs, ['task_goal','status','source_agent','created_at']) +
      '</div>' + renderMetrics(m.metrics);
  }
  const appr = state.approvals.length
    ? '<table><tr><th>file</th><th>tool_pattern</th><th>expires</th></tr>' +
      state.approvals.map(a => '<tr><td class="mono">' + esc(a.file) + '</td><td class="mono">' +
        esc(a.tool_pattern) + '</td><td>' + esc(a.expires_at || '') + '</td></tr>').join('') + '</table>'
    : '<div class="dim">no scoped approval records</div>';
  return '<div class="section">' + mem +
    '<div class="card" style="margin-top:12px"><h3>Scoped approvals (.agent-runs/approvals/)</h3>' + appr + '</div>' +
    '<div class="card" style="margin-top:12px"><h3>Refresh memory</h3>' +
    '<button onclick="load(true)" style="cursor:pointer">Query SurrealDB now</button> ' +
    '<span class="dim">cached 60s otherwise</span></div></div>';
}

function renderSessions() {
  const rows = state.sessions.map(s =>
    '<tr><td class="mono">' + esc(s.id.slice(0,12)) + '</td><td>' + s.events + '</td>' +
    '<td>' + ts(s.first) + '</td><td>' + ts(s.last) + '</td>' +
    '<td class="mono">' + esc(s.top_tools) + '</td>' +
    '<td>' + (s.verified ? pill('ok') : pill('warn')) + '</td>' +
    '<td>' + (s.graph_scanned ? pill('ok') : pill('off')) + '</td></tr>').join('');
  const ev = state.recent_events.map(e =>
    '<tr><td class="dim">' + ts(e.timestamp) + '</td><td class="mono">' + esc(e.tool) + '</td>' +
    '<td class="mono">' + esc((e.command || e.file || '').slice(0,90)) + '</td></tr>').join('');
  return '<div class="section"><div class="card"><h3>Sessions (.agent-runs/sessions/)</h3>' +
    (rows ? '<table><tr><th>id</th><th>events</th><th>first</th><th>last</th><th>top tools</th><th>verified</th><th>graph</th></tr>' + rows + '</table>'
          : '<div class="dim">no hooked sessions yet — run claude with the plugin loaded</div>') + '</div>' +
    '<div class="card" style="margin-top:12px"><h3>Recent tool events</h3>' +
    (ev ? '<table><tr><th>time</th><th>tool</th><th>command/file</th></tr>' + ev + '</table>'
        : '<div class="dim">none</div>') + '</div></div>';
}

function renderGraph() {
  const g = state.graph;
  if (!g.present) return '<div class="card"><span class="dim">No graphify-out/graph.json in this repo. Run /graphify first.</span></div>';
  return '<div class="card"><h3>Repo graph</h3>' + g.nodes + ' nodes · ' + g.edges + ' edges · built at <code>' +
    esc(g.built_at_commit) + '</code> · updated ' + ts(g.updated_at) +
    (g.html ? '<div style="margin-top:8px"><a href="/gout/graph.html" target="_blank">Open interactive graph ↗</a></div>' : '') +
    '</div>';
}

function render() {
  if (!state) return;
  document.getElementById('repoline').textContent =
    state.repo.repo_id + ' · ' + state.repo.root;
  document.getElementById('refreshed').textContent = 'updated ' + ts(state.generated_at);
  const views = { overview: renderOverview, dev: renderDev, sessions: renderSessions, graph: renderGraph };
  document.getElementById('main').innerHTML = views[tab]();
}

document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  tab = b.dataset.tab;
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x === b));
  render();
});

async function load(fresh) {
  try {
    const res = await fetch('/api/state' + (fresh ? '?fresh=1' : ''));
    state = await res.json();
    render();
  } catch (e) { document.getElementById('main').innerHTML = '<div class="card fail">dashboard server unreachable</div>'; }
}
load(false);
setInterval(() => load(false), 5000);
</script></body></html>`;

// ---- Server ---------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = repoRootFromArgs(args);
  const port = Number.parseInt(args.port || process.env.DFC_DASHBOARD_PORT || "4949", 10);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE);
      } else if (url.pathname === "/api/state") {
        const state = await buildState(repoRoot, url.searchParams.get("fresh") === "1");
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(state));
      } else if (url.pathname.startsWith("/gout/")) {
        const file = serveGraphifyFile(repoRoot, url.pathname.slice("/gout/".length));
        if (file) res.writeHead(200, { "Content-Type": file.type }).end(file.body);
        else res.writeHead(404).end("not found");
      } else {
        res.writeHead(404).end("not found");
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: (err as Error).message }));
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`dfc dashboard  →  http://127.0.0.1:${port}`);
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
