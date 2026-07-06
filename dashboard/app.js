/* Voidarch Studio dashboard client. Plain JS, no dependencies. */
'use strict';

let state = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pill = (s) => '<span class="pill ' + esc(s) + '">' + esc(String(s).toUpperCase()) + '</span>';
const ts = (s) => (s ? esc(String(s).replace('T', ' ').slice(0, 19)) : '');
const age = (s) => {
  const t = Date.parse(String(s ?? ''));
  if (!Number.isFinite(t)) return '';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return '<1m';
  if (m < 60) return m + 'm';
  if (m < 1440) return Math.floor(m / 60) + 'h';
  return Math.floor(m / 1440) + 'd';
};
const fmtTok = (n) => {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
};
const kv = (obj) => Object.entries(obj || {}).map(([k, v]) => esc(k) + ': <b>' + esc(v) + '</b>').join(' · ') || '<span class="dim">none</span>';

function table(rows, cols, render) {
  if (!rows || !rows.length) return '<div class="dim">none</div>';
  return '<table><tr>' + cols.map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr>' +
    rows.map((r) => '<tr>' + cols.map((c) => '<td>' + (render && render[c] ? render[c](r[c], r) : esc(Array.isArray(r[c]) ? r[c].join(', ') : r[c] ?? '')) + '</td>').join('') + '</tr>').join('') + '</table>';
}

// ---- header chips ------------------------------------------------------------

function renderChips() {
  const m = state.memory || {};
  const activeSessions = (state.sessions || []).filter((s) => s.active).length;
  const running = (state.spawned_agents || []).filter((a) => a.status === 'running').length;
  const tasks = (m.open_tasks || []).length;
  const blockers = (m.open_blockers || []).length;
  const today = new Date().toISOString().slice(0, 10);
  const tok = state.tokens && state.tokens.by_day && state.tokens.by_day[today];
  const chips = [
    { id: 'agents', label: 'agents live <b>' + (activeSessions + running) + '</b>', alert: false },
    { id: 'control', label: 'tasks <b>' + tasks + '</b>', alert: false },
    { id: 'control', label: 'blockers <b>' + blockers + '</b>', alert: blockers > 0 },
    { id: 'tokens', label: 'tokens today <b>' + (tok ? fmtTok(tok.input + tok.output) : '0') + '</b>', alert: false },
    { id: 'sync', label: 'db <b>' + esc(state.sync ? state.sync.mode : '?') + '</b>', alert: false },
  ];
  $('chips').innerHTML = chips.map((c) =>
    '<span class="chip' + (c.alert ? ' alert' : '') + '" data-jump="' + c.id + '">' + c.label + '</span>').join('');
  for (const el of $('chips').querySelectorAll('.chip')) {
    el.onclick = () => jumpTo(el.dataset.jump);
  }
}

function jumpTo(id) {
  const panel = $(id);
  if (!panel) return;
  panel.open = true;
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- control room --------------------------------------------------------------

function renderControl() {
  const m = state.memory || {};
  const items = [];
  for (const b of m.open_blockers || []) {
    items.push({ sev: 'high', text: 'Blocker: ' + esc(b.summary || b.text), meta: age(b.created_at) });
  }
  const stale = m.metrics && m.metrics.stale;
  if (stale) {
    for (const t of stale.open_tasks_over_14_days.items || []) {
      items.push({ sev: 'med', text: 'Stale task (' + t.age_days + 'd): ' + esc(t.summary), meta: '' });
    }
  }
  for (const c of state.health || []) {
    if (c.status === 'fail') items.push({ sev: 'high', text: esc(c.name) + ' failing: ' + esc(c.detail), meta: '' });
    if (c.status === 'warn') items.push({ sev: 'med', text: esc(c.name) + ': ' + esc(c.detail), meta: '' });
  }
  if (state.graph && state.graph.present) {
    const days = (Date.now() - Date.parse(state.graph.updated_at)) / 86400000;
    if (days > 7) items.push({ sev: 'low', text: 'Repo graph is ' + days.toFixed(0) + 'd old — rerun /graphify or dfc:graph:build', meta: '' });
  } else {
    items.push({ sev: 'med', text: 'No repo graph — run /graphify', meta: '' });
  }
  for (const s of (state.sessions || []).slice(0, 5)) {
    if (!s.verified && !s.active) items.push({ sev: 'low', text: 'Session ' + esc(s.id.slice(0, 12)) + ' ended without verification', meta: age(s.last) });
  }
  if (state.repo.dirty_files > 0) items.push({ sev: 'low', text: state.repo.dirty_files + ' dirty file(s) in working tree', meta: '' });

  const attention = items.length
    ? items.slice(0, 12).map((i) =>
        '<div class="attention-item"><span class="sev ' + i.sev + '">' + i.sev.toUpperCase() + '</span><span>' + i.text + '</span><span class="dim" style="margin-left:auto">' + i.meta + '</span></div>').join('')
    : '<div class="dim">Nothing needs attention. Quiet skies.</div>';

  const r = state.repo;
  const activeSessions = (state.sessions || []).filter((s) => s.active);
  const running = (state.spawned_agents || []).filter((a) => a.status === 'running');
  const live = [...running.map((a) => ({ kind: 'spawned', label: a.prompt.slice(0, 70), since: a.started_at, state: 'running' })),
    ...activeSessions.map((s) => ({ kind: 'session', label: s.top_tools || s.id.slice(0, 12), since: s.last, state: 'active' }))];

  $('p-control').innerHTML =
    '<div class="two-col">' +
    '<div class="card"><h3>Repository</h3><div class="mono">' + esc(r.root) + '</div>' +
    '<div>branch <b>' + esc(r.branch) + '</b> · ' + r.dirty_files + ' dirty · <span class="dim">repo_id ' + esc(r.repo_id) + '</span></div>' +
    '<div class="dim mono">' + esc(r.head) + '</div></div>' +
    '<div class="card"><h3>Live activity</h3>' +
    (live.length
      ? live.map((l) => '<div>' + pill(l.state) + ' <span class="dim">' + esc(l.kind) + '</span> ' + esc(l.label) + ' <span class="dim">' + age(l.since) + '</span></div>').join('')
      : '<div class="dim">no live agents or hooked sessions</div>') + '</div>' +
    '</div>' +
    '<div class="card"><h3>Needs attention</h3>' + attention + '</div>';
  $('control-hint').textContent = items.length ? items.length + ' item(s)' : 'all clear';
}

// ---- agents ---------------------------------------------------------------------

// UI state that must survive the 5s re-render.
const ui = {
  openLogs: new Set(), logCache: {},
  openResume: new Set(),
  openSession: null, sessionCache: {},
  openWorkflows: new Set(),
  openTasks: new Set(),
  configStamp: '',
};

function editingIn(el) {
  const a = document.activeElement;
  return a && el.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
}

const fmtCost = (v) => (v == null ? '' : '$' + Number(v).toFixed(3));
const fmtDur = (ms) => (ms == null ? '' : ms >= 60000 ? (ms / 60000).toFixed(1) + 'm' : Math.round(ms / 1000) + 's');

function agentCard(a) {
  const feed = (a.lines || []).slice(-30).map(esc).join('\n');
  const logOpen = ui.openLogs.has(a.id);
  const resumeOpen = ui.openResume.has(a.id);
  const metrics = [
    [a.provider, a.model, a.effort].filter(Boolean).join('/') || '',
    a.purpose === 'verify' ? 'verify' : '',
    a.num_turns != null ? a.num_turns + ' turns' : '',
    fmtCost(a.cost_usd), fmtDur(a.duration_ms),
    a.session_id ? 'session ' + esc(a.session_id.slice(0, 8)) : '',
  ].filter(Boolean).join(' · ');
  const buttons =
    (a.status === 'running' ? '<button class="kill-btn" data-act="kill" data-id="' + esc(a.id) + '">kill</button>' : '') +
    '<button class="mini-btn" data-act="log" data-id="' + esc(a.id) + '">' + (logOpen ? 'hide log' : 'inspect') + '</button>' +
    (a.status !== 'running' && a.prompt !== '(prompt not recorded)'
      ? '<button class="mini-btn" data-act="retry" data-id="' + esc(a.id) + '">retry</button>' : '') +
    (a.status !== 'running' && a.session_id
      ? '<button class="mini-btn" data-act="resume" data-id="' + esc(a.id) + '">resume</button>' : '');
  return '<div class="card">' +
    '<h3>' + pill(a.status) + (a.historical ? ' ' + pill('off').replace('OFF', 'PAST') : '') +
    (a.workflow ? ' <span class="wf-tag">⚙ ' + esc(a.workflow) + '</span>' : '') +
    ' <span class="dim">' + ts(a.started_at) + ' · mode ' + esc(a.permission_mode) + '</span>' +
    '<span style="float:right;display:flex;gap:6px">' + buttons + '</span></h3>' +
    '<div class="mono">' + esc(a.prompt.slice(0, 200)) + '</div>' +
    (metrics ? '<div class="dim" style="margin-top:3px">' + metrics + (a.resumed_from ? ' · resumed from ' + esc(a.resumed_from.slice(0, 8)) : '') + '</div>' : '') +
    (a.tools && Object.keys(a.tools).length
      ? '<div class="dim" style="margin-top:3px">tools: ' + Object.entries(a.tools).map(([k, v]) => esc(k) + '=' + esc(v)).join(' · ') + '</div>'
      : '') +
    (resumeOpen
      ? '<div class="launch-row" style="margin-top:6px"><input class="resume-input" data-id="' + esc(a.id) + '" placeholder="Follow-up prompt for resumed session…" style="flex:1">' +
        '<button class="glow-btn" data-act="resume-go" data-id="' + esc(a.id) + '">Resume ▸</button></div>'
      : '') +
    (logOpen
      ? '<div class="agent-feed">' + ((ui.logCache[a.id] || ['loading…']).map(esc).join('\n')) + '</div>'
      : (a.status === 'running' && feed ? '<div class="agent-feed">' + feed + '</div>' : '')) +
    (a.result ? '<div class="agent-result">' + esc(a.result) + '</div>' : '') +
    '</div>';
}

async function agentAction(act, id, btn) {
  if (act === 'kill') {
    btn.disabled = true;
    await fetch('/api/agents/' + encodeURIComponent(id) + '/kill', { method: 'POST' });
  } else if (act === 'log') {
    if (ui.openLogs.has(id)) ui.openLogs.delete(id);
    else {
      ui.openLogs.add(id);
      const data = await (await fetch('/api/agents/' + encodeURIComponent(id) + '/log')).json();
      ui.logCache[id] = data.lines && data.lines.length ? data.lines : ['(no log lines)'];
    }
    renderAgents();
    return;
  } else if (act === 'retry') {
    btn.disabled = true;
    const data = await (await fetch('/api/agents/' + encodeURIComponent(id) + '/retry', { method: 'POST' })).json();
    if (data.error) { $('agent-launch-msg').textContent = 'retry: ' + data.error; }
  } else if (act === 'resume') {
    if (ui.openResume.has(id)) ui.openResume.delete(id); else ui.openResume.add(id);
    renderAgents();
    const inp = document.querySelector('.resume-input[data-id="' + CSS.escape(id) + '"]');
    if (inp) inp.focus();
    return;
  } else if (act === 'resume-go') {
    const inp = document.querySelector('.resume-input[data-id="' + CSS.escape(id) + '"]');
    const prompt = inp ? inp.value.trim() : '';
    if (!prompt) return;
    btn.disabled = true;
    const data = await (await fetch('/api/agents/' + encodeURIComponent(id) + '/resume', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }),
    })).json();
    if (data.error) { $('agent-launch-msg').textContent = 'resume: ' + data.error; }
    ui.openResume.delete(id);
  }
  loadState(false);
}

async function toggleSession(id) {
  if (ui.openSession === id) { ui.openSession = null; renderAgents(); return; }
  ui.openSession = id;
  if (!ui.sessionCache[id]) {
    try {
      ui.sessionCache[id] = await (await fetch('/api/sessions/' + encodeURIComponent(id))).json();
    } catch { ui.sessionCache[id] = { error: 'failed to load' }; }
  }
  renderAgents();
}

function sessionDetailHtml(id) {
  const d = ui.sessionCache[id];
  if (!d) return '<div class="dim">loading…</div>';
  if (d.error) return '<div class="dim">' + esc(d.error) + '</div>';
  return '<div class="card" style="margin-top:8px"><h3>Session ' + esc(id.slice(0, 12)) +
    ' <span class="dim">' + d.event_count + ' events · verified ' + (d.verified ? 'yes' : 'no') +
    ' · graph scan ' + (d.graph_scanned ? 'yes' : 'no') + '</span></h3>' +
    table(d.events, ['timestamp', 'tool', 'detail'], {
      timestamp: (v) => ts(v),
      tool: (v) => '<span class="mono">' + esc(v) + '</span>',
      detail: (v) => '<span class="mono">' + esc(v) + '</span>',
    }) + '</div>';
}

function renderAgents() {
  if (editingIn($('p-agents'))) return; // don't clobber an in-progress resume prompt
  const spawned = state.spawned_agents || [];
  const sessions = state.sessions || [];
  const running = spawned.filter((a) => a.status === 'running');

  const compare = spawned.length > 1
    ? '<div class="card"><h3>Run comparison</h3>' +
      table(spawned.slice(0, 12), ['run', 'agent', 'workflow', 'status', 'turns', 'cost', 'duration', 'started'], {
        run: (_, r) => '<span class="mono">' + esc(r.id.slice(11, 23)) + '</span>',
        agent: (_, r) => '<span class="mono">' + esc([r.provider, r.model].filter(Boolean).join('/') || '—') + '</span>',
        workflow: (_, r) => esc(r.workflow || '—'),
        status: (_, r) => pill(r.status),
        turns: (_, r) => r.num_turns ?? '',
        cost: (_, r) => fmtCost(r.cost_usd),
        duration: (_, r) => fmtDur(r.duration_ms),
        started: (_, r) => ts(r.started_at),
      }) + '</div>'
    : '';

  const spawnedHtml = spawned.length
    ? spawned.map(agentCard).join('')
    : '<div class="card"><span class="dim">No agent runs yet. Deploy one above — runs are logged to .agent-runs/dashboard-agents/ and reappear here after restarts.</span></div>';

  const sessHtml = table(sessions, ['id', 'state', 'events', 'last', 'top tools', 'verified', 'graph'], {
    id: (v) => '<a href="#" class="mono sess-link" data-sess="' + esc(v) + '">' + esc(String(v).slice(0, 12)) + '</a>',
    state: (_, r) => (r.active ? pill('running') : pill('off')),
    last: (v) => age(v) + ' ago',
    'top tools': (_, r) => '<span class="mono">' + esc(r.top_tools) + '</span>',
    verified: (v) => (v ? pill('ok') : pill('warn')),
    graph: (v, r) => (r.graph_scanned ? pill('ok') : pill('off')),
  });

  $('p-agents').innerHTML =
    (running.length
      ? '<div class="card live-card"><h3>Running now (' + running.length + ')</h3>' +
        running.map((a) => '<div>' + pill('running') + ' <span class="mono">' + esc(a.prompt.slice(0, 90)) + '</span>' +
          (a.workflow ? ' <span class="wf-tag">⚙ ' + esc(a.workflow) + '</span>' : '') +
          ' <span class="dim">' + age(a.started_at) + '</span></div>').join('') + '</div>'
      : '') +
    compare +
    '<div class="card"><h3>Agent runs (live + history)</h3>' + spawnedHtml + '</div>' +
    '<div class="card"><h3>Hooked sessions (.agent-runs/sessions/) — click a session to inspect</h3>' +
    (sessions.length
      ? sessHtml + (ui.openSession ? sessionDetailHtml(ui.openSession) : '')
      : '<div class="dim">No hooked sessions. Hooks are bundled but only fire inside a Claude session started with this plugin loaded (<span class="mono">claude --plugin-dir &lt;plugin&gt;</span>). Data appears here after the next hooked session.</div>') +
    '</div>';

  for (const btn of $('p-agents').querySelectorAll('[data-act]')) {
    btn.onclick = () => agentAction(btn.dataset.act, btn.dataset.id, btn);
  }
  for (const link of $('p-agents').querySelectorAll('.sess-link')) {
    link.onclick = (e) => { e.preventDefault(); toggleSession(link.dataset.sess); };
  }
  $('agents-hint').textContent = running.length + ' running · ' + spawned.length + ' run(s) · ' + sessions.length + ' session(s)';
}

function gatherTools() {
  const t = {};
  for (const sel of document.querySelectorAll('.tools-grid select[data-tool]')) {
    if (sel.closest('label').hidden) continue;
    if (sel.value) t[sel.dataset.tool] = sel.value;
  }
  return t;
}

// ---- provider / model / effort pickers ------------------------------------------

let launchPurpose = ''; // 'verify' → server enforces claude/haiku
let pickersReady = false;

function fillModelEffort() {
  const providers = (state.config && state.config.providers) || {};
  const p = providers[$('agent-provider').value] || { models: [], efforts: [] };
  const fill = (sel, list) => {
    const prev = sel.value;
    sel.innerHTML = list.map((m) => '<option value="' + esc(m) + '">' + esc(m) + '</option>').join('');
    if (list.includes(prev)) sel.value = prev;
  };
  fill($('agent-model'), p.models);
  fill($('agent-effort'), p.efforts);
  $('agent-effort-wrap').hidden = !p.efforts.length;
}

function initPickers() {
  if (pickersReady || !state.config) return;
  pickersReady = true;
  const providers = state.config.providers || {};
  const d = state.config.defaults || {};
  $('agent-provider').innerHTML = Object.keys(providers).map((p) => '<option value="' + esc(p) + '">' + esc(p) + '</option>').join('');
  if (providers[d.provider]) $('agent-provider').value = d.provider;
  fillModelEffort();
  if ((providers[d.provider] || { models: [] }).models.includes(d.model)) $('agent-model').value = d.model;
  if ((providers[d.provider] || { efforts: [] }).efforts.includes(d.effort)) $('agent-effort').value = d.effort;
  // Opinionated routing defaults from config (user can still change per launch).
  const routes = d.routes || {};
  for (const [tool, val] of Object.entries(routes)) {
    const sel = document.querySelector('.tools-grid select[data-tool="' + tool + '"]');
    if (sel && [...sel.options].some((o) => o.value === val)) sel.value = val;
  }
  $('agent-provider').onchange = () => { $('agent-preset').value = ''; launchPurpose = ''; fillModelEffort(); updateToolControls(); };
  $('agent-model').onchange = $('agent-effort').onchange = () => { $('agent-preset').value = ''; launchPurpose = ''; updateToolControls(); };
  $('agent-preset').onchange = () => {
    const v = $('agent-preset').value;
    if (!v) { launchPurpose = ''; updateToolControls(); return; }
    const [prov, model, purpose] = v.split('|');
    if (state.config.providers[prov]) $('agent-provider').value = prov;
    fillModelEffort();
    if (model) $('agent-model').value = model;
    launchPurpose = purpose || '';
    updateToolControls();
  };
  updateToolControls();
}

function updateToolControls() {
  const sub = $('tool-subagents').value;
  $('tool-model-wrap').hidden = !(sub === 'native-specific' || sub === 'antigravity-specific');
  $('tool-effort-wrap').hidden = sub !== 'native-specific';
  const t = gatherTools();
  const parts = Object.entries(t).map(([k, v]) => k + '=' + v);
  $('tool-preview').textContent = parts.length
    ? 'system prompt will route: ' + parts.join(' · ')
    : '';
  // Exact launch line — what the server will actually run.
  const prov = $('agent-provider').value || 'claude';
  const model = $('agent-model').value;
  const effort = $('agent-effort-wrap').hidden ? '' : $('agent-effort').value;
  const mode = $('agent-mode').value;
  const cmd = {
    claude: 'claude -p "…" --output-format stream-json --permission-mode ' + mode +
      (model ? ' --model ' + model : '') + (effort ? ' --effort ' + effort : ''),
    codex: 'codex exec' + (model ? ' -m ' + model : '') + (effort ? ' -c model_reasoning_effort="' + effort + '"' : '') + ' "…"',
    grok: 'grok -p "…"' + (model ? ' -m ' + model : ''),
    gemini: 'gemini -p "…"' + (model ? ' -m ' + model : ''),
    copilot: 'copilot -p "…"' + (model && model !== 'default' ? ' --model ' + model : ''),
  }[prov] || prov;
  $('launch-preview').innerHTML =
    'will run: <b>' + esc(cmd) + '</b>' +
    (launchPurpose === 'verify' ? ' <span class="pill warn">VERIFY → forced claude/haiku</span>' : '');
}

async function launchAgent() {
  const prompt = $('agent-prompt').value.trim();
  const msg = $('agent-launch-msg');
  if (!prompt) { msg.textContent = 'prompt required'; return; }
  $('agent-launch').disabled = true;
  msg.textContent = 'launching…';
  try {
    const res = await fetch('/api/agents/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt, permission_mode: $('agent-mode').value, tools: gatherTools(),
        provider: $('agent-provider').value, model: $('agent-model').value,
        effort: $('agent-effort-wrap').hidden ? '' : $('agent-effort').value,
        purpose: launchPurpose,
      }),
    });
    const data = await res.json();
    msg.textContent = data.error ? 'error: ' + data.error
      : 'deployed ' + data.id + ' (' + data.provider + (data.model ? '/' + data.model : '') + ')';
    if (!data.error) $('agent-prompt').value = '';
  } catch (e) {
    msg.textContent = 'launch failed: ' + e.message;
  }
  $('agent-launch').disabled = false;
  loadState(false);
}

// ---- workflows -----------------------------------------------------------------

function workflowRuns(name) {
  return (state.spawned_agents || []).filter((a) => a.workflow === name);
}

async function runWorkflow(name, btn) {
  btn.disabled = true;
  btn.textContent = 'launching…';
  try {
    const data = await (await fetch('/api/workflows/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    })).json();
    if (data.error) btn.textContent = 'error: ' + data.error;
    else { jumpTo('agents'); }
  } catch (e) { btn.textContent = 'failed'; }
  loadState(false);
}

function renderWorkflows() {
  if (editingIn($('p-workflows'))) return;
  const rows = state.workflows || [];
  if (!rows.length) {
    $('p-workflows').innerHTML = '<div class="dim">No workflow definitions found — expected in <span class="mono">workflows/*.js</span> (plugin) or <span class="mono">.claude/workflows/*.js</span> (repo). Add one and it appears here.</div>';
    $('workflows-hint').textContent = '0';
    return;
  }
  $('p-workflows').innerHTML = rows.map((w) => {
    const runs = workflowRuns(w.name);
    const last = runs[0];
    const open = ui.openWorkflows.has(w.name);
    const steps = w.phases.length
      ? '<ol class="wf-steps">' + w.phases.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ol>'
      : '<div class="dim">no declared phases</div>';
    const history = runs.length
      ? table(runs.slice(0, 6), ['status', 'started', 'turns', 'cost', 'result'], {
          status: (_, r) => pill(r.status),
          started: (_, r) => ts(r.started_at),
          turns: (_, r) => r.num_turns ?? '',
          cost: (_, r) => fmtCost(r.cost_usd),
          result: (_, r) => esc((r.result || '').slice(0, 120)),
        })
      : '<div class="dim">never run from this dashboard — runs appear here (and under Agents) after you hit Run</div>';
    return '<details class="card wf-card"' + (open ? ' open' : '') + ' data-wf="' + esc(w.name) + '">' +
      '<summary><b>' + esc(w.name) + '</b> <span class="dim">' + esc(w.source) + '</span>' +
      (last ? ' ' + pill(last.status) : '') +
      ' <span class="dim">' + esc(w.description) + '</span></summary>' +
      '<div style="margin-top:8px">' +
      (w.when_to_use ? '<div class="dim">' + esc(w.when_to_use) + '</div>' : '') +
      '<div class="two-col" style="margin-top:6px"><div><h3>Steps</h3>' + steps +
      '<div class="dim mono">' + esc(w.file) + '</div></div>' +
      '<div><h3>Run history</h3>' + history + '</div></div>' +
      '<div style="margin-top:8px"><button class="glow-btn wf-run" data-wf="' + esc(w.name) + '">Run ▸</button> ' +
      '<span class="dim">deploys a headless agent that executes this workflow (acceptEdits; real token cost — see run history)</span></div>' +
      '</div></details>';
  }).join('');
  for (const d of $('p-workflows').querySelectorAll('.wf-card')) {
    d.ontoggle = () => { if (d.open) ui.openWorkflows.add(d.dataset.wf); else ui.openWorkflows.delete(d.dataset.wf); };
  }
  for (const btn of $('p-workflows').querySelectorAll('.wf-run')) {
    btn.onclick = () => runWorkflow(btn.dataset.wf, btn);
  }
  const lastAny = (state.spawned_agents || []).find((a) => a.workflow);
  $('workflows-hint').textContent = rows.length + ' definition(s)' + (lastAny ? ' · last run ' + lastAny.status : '');
}

// ---- memory ---------------------------------------------------------------------

function memTable(rows) {
  return table(rows, ['summary', 'source_agent', 'created_at'], { created_at: (v) => ts(v) });
}

function renderMemory() {
  const m = state.memory || {};
  if (!m.available) {
    $('p-memory').innerHTML = '<div class="card">' + pill('off') + ' <span class="dim">' + esc(m.error || 'not configured') + '</span></div>';
    $('memory-hint').textContent = 'off';
    return;
  }
  const counts = kv(m.counts);
  $('p-memory').innerHTML =
    '<div class="card"><h3>Table counts</h3><div class="dim">' + counts + '</div>' +
    '<div style="margin-top:8px"><button class="glow-btn" onclick="loadState(true)">Query SurrealDB now</button> <span class="dim">cached 60s otherwise</span></div></div>' +
    '<div class="two-col">' +
    '<div class="card"><h3>Open tasks</h3>' + table(m.open_tasks, ['goal', 'status', 'created_at'], { created_at: (v) => age(v) }) + '</div>' +
    '<div class="card"><h3>Open blockers</h3>' + table(m.open_blockers, ['summary', 'created_at'], { summary: (v, r) => esc(v || r.text), created_at: (v) => age(v) }) + '</div>' +
    '<div class="card"><h3>Recent decisions</h3>' + memTable(m.decisions) + '</div>' +
    '<div class="card"><h3>Recent lessons</h3>' + memTable(m.lessons) + '</div>' +
    '<div class="card"><h3>Recent repo facts</h3>' + memTable(m.repo_facts) + '</div>' +
    '<div class="card"><h3>Recent snippets</h3>' + memTable(m.snippets) + '</div>' +
    '<div class="card"><h3>Recent evidence</h3>' + memTable(m.evidence) + '</div>' +
    '<div class="card"><h3>Recent agent runs</h3>' + table(m.agent_runs, ['task_goal', 'status', 'source_agent', 'created_at'], { created_at: (v) => ts(v) }) + '</div>' +
    '</div>';
  const total = Object.values(m.counts || {}).reduce((a, b) => a + b, 0);
  $('memory-hint').textContent = total + ' rows · ' + (m.open_tasks || []).length + ' open tasks';
}

// ---- metrics ---------------------------------------------------------------------

function renderMetrics() {
  const x = state.memory && state.memory.metrics;
  if (!x) {
    $('p-metrics').innerHTML = '<div class="dim">metrics unavailable (memory off or query failed)</div>';
    $('metrics-hint').textContent = 'off';
    return;
  }
  const growth = Object.entries(x.memories || {}).map(([k, v]) =>
    '<tr><td>' + esc(k) + '</td><td>' + v.last_7_days + '</td><td>' + v.last_30_days + '</td></tr>').join('');
  const tools = (x.tool_activity.by_tool || []).map((t) =>
    '<tr><td class="mono">' + esc(t.tool_name) + '</td><td>' + t.count + '</td><td>' + t.ok + '</td><td>' + t.fail + '</td></tr>').join('');
  $('p-metrics').innerHTML =
    '<div class="two-col">' +
    '<div class="card"><h3>Activity (last ' + x.days + ' days)</h3>' +
    '<div><b>Runs:</b> ' + x.runs.total + ' <span class="dim">(' + kv(x.runs.by_status) + ')</span></div>' +
    '<div><b>Tasks:</b> ' + kv(x.tasks.by_status) +
    (x.tasks.oldest_open_age_days != null ? ' <span class="dim">· oldest open ' + x.tasks.oldest_open_age_days + 'd</span>' : '') + '</div>' +
    '<div><b>Blockers:</b> open <b>' + x.blockers.open + '</b> · resolved <b>' + x.blockers.resolved + '</b></div>' +
    '<div><b>Retrieval:</b> ' + x.retrieval.total + ' packs · ' + x.retrieval.last_7_days + ' last 7d' +
    (x.retrieval.avg_estimated_tokens != null ? ' · avg ~' + x.retrieval.avg_estimated_tokens + ' tokens' : '') + '</div>' +
    '<div><b>Stale:</b> ' + x.stale.open_tasks_over_14_days.count + ' tasks &gt;14d · ' + x.stale.open_blockers_over_7_days.count + ' blockers &gt;7d</div></div>' +
    '<div class="card"><h3>Memory growth</h3>' +
    (growth ? '<table><tr><th>kind</th><th>7d</th><th>30d</th></tr>' + growth + '</table>' : '<div class="dim">none</div>') + '</div>' +
    '</div>' +
    '<div class="card"><h3>Tool activity (' + x.tool_activity.total + ' events)</h3>' +
    (tools ? '<table><tr><th>tool</th><th>count</th><th>ok</th><th>fail</th></tr>' + tools + '</table>' : '<div class="dim">none</div>') + '</div>';
  $('metrics-hint').textContent = x.runs.total + ' runs / ' + x.days + 'd';
}

// ---- tokens ---------------------------------------------------------------------

function bars(entries, value) {
  const max = Math.max(1, ...entries.map(([, v]) => value(v)));
  return entries.map(([k, v]) =>
    '<div class="bar-row"><span class="lbl" title="' + esc(k) + '">' + esc(k.length > 11 ? k.slice(0, 10) + '…' : k) + '</span>' +
    '<span class="bar" style="width:' + Math.max(1, (value(v) / max) * 100) + '%"></span>' +
    '<span class="val">' + fmtTok(value(v)) + '</span></div>').join('');
}

function renderTokens() {
  const t = state.tokens;
  if (!t || !t.available) {
    $('p-tokens').innerHTML = '<div class="card">' + pill('off') + ' <span class="dim">no Claude Code transcripts found under ~/.claude/projects for this repo (set DFC_TRANSCRIPTS_DIR to override)</span></div>';
    $('tokens-hint').textContent = 'off';
    return;
  }
  const days = Object.entries(t.by_day || {}).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const models = Object.entries(t.by_model || {}).sort((a, b) => b[1].output - a[1].output).slice(0, 6);
  const tot = t.totals;
  $('p-tokens').innerHTML =
    '<div class="two-col">' +
    '<div class="card"><h3>Totals (all transcripts for this repo)</h3>' +
    '<div>input <b>' + fmtTok(tot.input) + '</b> · output <b>' + fmtTok(tot.output) + '</b> · ' + tot.messages + ' messages</div>' +
    '<div class="dim">cache read ' + fmtTok(tot.cache_read) + ' · cache creation ' + fmtTok(tot.cache_creation) + '</div>' +
    (t.retrieval ? '<div class="dim" style="margin-top:4px">retrieval: ' + t.retrieval.total_packs + ' context packs' +
      (t.retrieval.avg_estimated_tokens != null ? ' · avg ~' + t.retrieval.avg_estimated_tokens + ' tok' : '') + '</div>' : '') +
    '<div class="dim mono" style="margin-top:6px">' + (t.transcript_dirs || []).map(esc).join('<br>') + '</div></div>' +
    '<div class="card"><h3>By model (output tokens)</h3>' + (models.length ? bars(models, (v) => v.output) : '<div class="dim">none</div>') + '</div>' +
    '</div>' +
    '<div class="card"><h3>Last 14 days (input + output)</h3>' + (days.length ? bars(days.map(([d, v]) => [d.slice(5), v]), (v) => v.input + v.output) : '<div class="dim">none</div>') + '</div>' +
    '<div class="card"><h3>Recent sessions</h3>' +
    table(t.sessions, ['session', 'model', 'input', 'output', 'cache_read', 'last'], {
      session: (v) => '<span class="mono">' + esc(String(v).slice(0, 12)) + '</span>',
      model: (v) => '<span class="mono">' + esc(v) + '</span>',
      input: (v) => fmtTok(v), output: (v) => fmtTok(v), cache_read: (v) => fmtTok(v),
      last: (v) => age(v) + ' ago',
    }) + '</div>';
  $('tokens-hint').textContent = fmtTok(tot.input + tot.output) + ' total';
}

// ---- sync ------------------------------------------------------------------------

function renderSync() {
  const s = state.sync || {};
  const lock = s.lock && s.lock.present
    ? pill('warn') + ' LOCK present (' + s.lock.age_seconds + 's old) — one process at a time'
    : pill('ok') + ' no stale lock';
  $('p-sync').innerHTML =
    '<div class="two-col">' +
    '<div class="card"><h3>Backend</h3>' +
    '<div>mode ' + pill(s.mode === 'embedded' ? 'ok' : 'warn') + ' <b>' + esc(s.mode) + '</b></div>' +
    '<div class="mono dim">' + esc(s.url) + '</div>' +
    '<div class="dim">ns ' + esc(s.namespace) + ' · db ' + esc(s.database) + ' · repo_id ' + esc(s.repo_id) + '</div>' +
    (s.mode === 'embedded' ? '<div style="margin-top:6px">' + lock + '</div>' : '') + '</div>' +
    '<div class="card"><h3>Hosted sync</h3>' +
    (s.hosted_configured
      ? '<div>' + pill('ok') + ' hosted URL configured — push/pull with:</div>'
      : '<div>' + pill('off') + ' no hosted SurrealDB URL on file (.dfc/surreal.hosted.env)</div>') +
    '<div class="mono dim" style="margin-top:6px">pnpm dfc:sync --to &lt;wss://…&gt;   # promote local → hosted<br>pnpm dfc:sync --from &lt;wss://…&gt; # pull hosted → local</div></div>' +
    '</div>';
  $('sync-hint').textContent = s.mode || '';
}

// ---- observability ----------------------------------------------------------------

function renderObservability() {
  const obsCheck = (state.health || []).find((c) => c.name === 'Observability') || {};
  const events = state.recent_events || [];
  const sessions = state.sessions || [];
  // Tri-state: hooks not attached (no .agent-runs) / attached but quiet / flowing.
  let status;
  if (obsCheck.status === 'off') {
    status = pill('off') + ' <b>Hooks not attached yet.</b> The logging hooks are bundled with the plugin but only run inside a hooked Claude session. ' +
      '<div class="dim" style="margin-top:4px">Next action: start a session with <span class="mono">claude --plugin-dir &lt;plugin path&gt;</span> in this repo — <span class="mono">.agent-runs/</span> and the event stream appear on the first tool call.</div>';
  } else if (!events.length && !sessions.length) {
    status = pill('warn') + ' <b>Configured, no data yet.</b> <span class="mono">.agent-runs/</span> exists but holds no tool events. ' +
      '<div class="dim" style="margin-top:4px">Next action: run any hooked Claude session (or <span class="mono">pnpm dfc:log-tool</span> manually); events land in <span class="mono">.agent-runs/current.jsonl</span>.</div>';
  } else {
    status = pill('ok') + ' hooks attached · ' + sessions.length + ' session(s) logged · ' + events.length + ' recent event(s)' +
      '<div class="dim" style="margin-top:4px">Import into dev-memory with <span class="mono">pnpm dfc:import-runs --agent claude</span> to make runs queryable/searchable.</div>';
  }
  const ev = events.map((e) =>
    '<tr><td class="dim">' + ts(e.timestamp) + '</td><td class="mono">' + esc(e.tool) + '</td>' +
    '<td class="mono">' + esc(String(e.command || e.file || '').slice(0, 90)) + '</td></tr>').join('');
  const appr = (state.approvals || []).length
    ? table(state.approvals, ['file', 'tool_pattern', 'expires_at'], {
        file: (v) => '<span class="mono">' + esc(v) + '</span>',
        tool_pattern: (v) => '<span class="mono">' + esc(v) + '</span>',
      })
    : '<div class="dim">No scoped approval records — that means no hook overrides are active (a good default). To grant one, copy <span class="mono">templates/approval.example.json</span> into <span class="mono">.agent-runs/approvals/</span> with a narrow <span class="mono">tool_pattern</span> and expiry.</div>';
  $('p-observability').innerHTML =
    '<div class="card"><h3>Status</h3>' + status + '</div>' +
    '<div class="card"><h3>Recent tool events (.agent-runs/current.jsonl)</h3>' +
    (ev ? '<table><tr><th>time</th><th>tool</th><th>command/file</th></tr>' + ev + '</table>'
        : '<div class="dim">Empty = no hooked tool calls recorded yet (dashboard-deployed agents log to <span class="mono">.agent-runs/dashboard-agents/</span> instead — see the Agents panel).</div>') + '</div>' +
    '<div class="card"><h3>Scoped approvals</h3>' + appr + '</div>';
  $('observability-hint').textContent = obsCheck.status === 'off' ? 'hooks not attached' : (events.length + ' recent event(s)');
}

// ---- health ------------------------------------------------------------------------

function renderHealth() {
  $('p-health').innerHTML = '<div class="cards">' + (state.health || []).map((c) =>
    '<div class="card"><h3>' + esc(c.name) + '</h3>' + pill(c.status) + ' <span class="dim">' + esc(c.detail) + '</span></div>').join('') + '</div>';
  const bad = (state.health || []).filter((c) => c.status === 'fail' || c.status === 'warn').length;
  $('health-hint').textContent = bad ? bad + ' issue(s)' : 'all ok';
}

// ---- code map (canvas force graph) ---------------------------------------------------

const graph = {
  nodes: [], links: [], byId: new Map(), adj: new Map(),
  loaded: false, selected: null, matches: new Set(),
  scale: 1, ox: 0, oy: 0, ticks: 0, dragging: null, panning: false,
  mode: 'visual', // 'visual' (file/symbol force graph) | 'systems' (architecture nodes)
  systems: null, selectedSystem: null,
};

const COMMUNITY_HUES = [265, 172, 315, 205, 35, 140, 0, 55, 230, 290, 100, 190];
const commColor = (c, a) => {
  const hue = COMMUNITY_HUES[Math.abs(parseInt(c, 10) || 0) % COMMUNITY_HUES.length];
  return 'hsla(' + hue + ',85%,66%,' + a + ')';
};

async function initGraph() {
  const g = state.graph;
  $('codemap-hint').textContent = g && g.present ? g.nodes + ' nodes · ' + g.edges + ' edges' : 'no graph';
  if (graph.loaded || !g || !g.present) return;
  graph.loaded = true;
  try {
    const raw = await (await fetch('/gout/graph.json')).json();
    const W = 1000, H = 600;
    graph.nodes = raw.nodes.map((n, i) => ({
      id: String(n.id), label: String(n.label || n.id), file: String(n.source_file || ''),
      community: String(n.community ?? '0'), type: String(n.file_type || ''),
      x: W / 2 + Math.cos(i * 2.4) * (60 + (i % 200) * 2), y: H / 2 + Math.sin(i * 2.4) * (60 + (i % 200) * 2),
      vx: 0, vy: 0, deg: 0,
    }));
    graph.byId = new Map(graph.nodes.map((n) => [n.id, n]));
    graph.links = raw.links
      .map((l) => ({ s: graph.byId.get(String(l.source)), t: graph.byId.get(String(l.target)), relation: String(l.relation || '') }))
      .filter((l) => l.s && l.t);
    for (const l of graph.links) {
      l.s.deg++; l.t.deg++;
      if (!graph.adj.has(l.s.id)) graph.adj.set(l.s.id, []);
      if (!graph.adj.has(l.t.id)) graph.adj.set(l.t.id, []);
      graph.adj.get(l.s.id).push(l);
      graph.adj.get(l.t.id).push(l);
    }
    graph.systems = null; // rebuild systems layout now that nodes exist
    graph.ticks = 260;
    setupGraphCanvas();
    requestAnimationFrame(graphFrame);
  } catch (e) {
    $('graph-info').textContent = 'graph load failed: ' + e.message;
  }
}

function simTick() {
  const nodes = graph.nodes, links = graph.links;
  // repulsion (O(n²) — fine at ~700 nodes; ponytail: quadtree if graphs grow 10×)
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      let dx = a.x - b.x, dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
      if (d2 > 40000) continue;
      const f = 160 / d2;
      a.vx += dx * f; a.vy += dy * f;
      b.vx -= dx * f; b.vy -= dy * f;
    }
  }
  for (const l of links) {
    const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = (d - 38) * 0.03;
    l.s.vx += (dx / d) * f; l.s.vy += (dy / d) * f;
    l.t.vx -= (dx / d) * f; l.t.vy -= (dy / d) * f;
  }
  for (const n of nodes) {
    n.vx += (500 - n.x) * 0.004;
    n.vy += (300 - n.y) * 0.004;
    n.x += n.vx *= 0.82;
    n.y += n.vy *= 0.82;
  }
}

function graphFrame() {
  if (graph.ticks > 0) {
    for (let i = 0; i < 3 && graph.ticks > 0; i++, graph.ticks--) simTick();
    drawGraph();
    requestAnimationFrame(graphFrame);
  } else {
    drawGraph();
  }
}

function drawGraph() {
  if (graph.mode === 'systems') { drawSystems(); return; }
  const canvas = $('graph-canvas');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(graph.ox + w / 2, graph.oy + h / 2);
  ctx.scale(graph.scale * (w / 1100), graph.scale * (w / 1100));
  ctx.translate(-500, -300);

  const sel = graph.selected;
  const neighbors = new Set();
  if (sel) {
    neighbors.add(sel.id);
    for (const l of graph.adj.get(sel.id) || []) { neighbors.add(l.s.id); neighbors.add(l.t.id); }
  }
  ctx.lineWidth = 0.5;
  for (const l of graph.links) {
    const lit = sel && (l.s.id === sel.id || l.t.id === sel.id);
    ctx.strokeStyle = lit ? 'rgba(45,226,195,0.75)' : (sel || graph.matches.size ? 'rgba(124,92,255,0.06)' : 'rgba(124,92,255,0.28)');
    ctx.beginPath(); ctx.moveTo(l.s.x, l.s.y); ctx.lineTo(l.t.x, l.t.y); ctx.stroke();
  }
  for (const n of graph.nodes) {
    const r = Math.min(9, 2 + Math.sqrt(n.deg));
    const dimmed = (sel && !neighbors.has(n.id)) || (graph.matches.size && !graph.matches.has(n.id) && !sel);
    ctx.fillStyle = commColor(n.community, dimmed ? 0.12 : 0.9);
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 7); ctx.fill();
    if (graph.matches.has(n.id) || n === sel) {
      ctx.strokeStyle = n === sel ? '#fff' : 'rgba(45,226,195,0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(n.x, n.y, r + 2.5, 0, 7); ctx.stroke();
      ctx.lineWidth = 0.5;
    }
    if (n === sel || graph.matches.has(n.id) || (!dimmed && n.deg > 18)) {
      ctx.fillStyle = n === sel ? '#fff' : 'rgba(215,219,238,0.85)';
      ctx.font = (n === sel ? '600 ' : '') + '9px ui-monospace';
      ctx.fillText(n.label.slice(0, 28), n.x + r + 2, n.y + 3);
    }
  }
  ctx.restore();
}

function canvasToWorld(canvas, cx, cy) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const k = graph.scale * (w / 1100);
  return { x: (cx - w / 2 - graph.ox) / k + 500, y: (cy - h / 2 - graph.oy) / k + 300 };
}

function nodeAt(canvas, cx, cy) {
  const p = canvasToWorld(canvas, cx, cy);
  let best = null, bestD = 12 / (graph.scale * (canvas.clientWidth / 1100));
  for (const n of graph.nodes) {
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

function selectNode(n) {
  graph.selected = n;
  const card = $('graph-card');
  if (!n) { card.hidden = true; drawGraph(); return; }
  const edges = (graph.adj.get(n.id) || []).slice(0, 14).map((l) => {
    const other = l.s.id === n.id ? l.t : l.s;
    const dir = l.s.id === n.id ? '→' : '←';
    return '<li>' + esc(l.relation) + ' ' + dir + ' ' + esc(other.label.slice(0, 34)) + '</li>';
  }).join('');
  const ref = (n.file ? n.file + '#' : '') + n.label;
  card.innerHTML = '<h4>' + esc(n.label) + '</h4>' +
    '<div class="dim mono">' + esc(n.file) + '</div>' +
    '<div class="dim">community ' + esc(n.community) + ' · ' + n.deg + ' edge(s)</div>' +
    refActions(ref) +
    (edges ? '<ul>' + edges + '</ul>' : '') +
    '<div class="dim" id="graph-card-more">loading detail…</div>';
  card.hidden = false;
  wireRefActions(card);
  drawGraph();
  loadNodeDetail(n);
}

/** Server-side detail: file facts, grouped edges, same-file siblings, related memory. */
async function loadNodeDetail(n) {
  let d;
  try {
    d = await (await fetch('/api/node?id=' + encodeURIComponent(n.id))).json();
  } catch { d = { error: 'detail unavailable' }; }
  if (graph.selected !== n) return; // stale response
  const more = $('graph-card-more');
  if (!more) return;
  if (d.error) { more.textContent = d.error; return; }
  const edgeGroup = (title, groups) => {
    const parts = Object.entries(groups || {}).map(([rel, names]) =>
      '<li><b>' + esc(rel) + '</b> ' + names.slice(0, 8).map(esc).join(', ') +
      (names.length > 8 ? ' <span class="dim">+' + (names.length - 8) + '</span>' : '') + '</li>');
    return parts.length ? '<div class="dim">' + title + '</div><ul>' + parts.join('') + '</ul>' : '';
  };
  const mem = [];
  for (const [kind, rows] of Object.entries(d.related || {})) {
    if (Array.isArray(rows)) for (const r of rows.slice(0, 2)) mem.push('<li><b>' + esc(kind) + '</b> ' + esc(String(r.summary || r.goal || '').slice(0, 80)) + '</li>');
  }
  const vecs = (d.vectors || []).map((v) =>
    '<li><span class="mono">' + esc(String(v.source_id).slice(0, 44)) + '</span> <span class="dim">sim ' + v.similarity + '</span><br><span class="dim">' + esc(v.excerpt) + '</span></li>').join('');
  more.outerHTML =
    (d.file ? '<div class="dim mono">' + (d.file.missing ? 'file missing on disk' : d.file.lines + ' lines · ' + Math.round(d.file.size / 1024 * 10) / 10 + ' KB · modified ' + age(d.file.mtime) + ' ago') + '</div>' : '') +
    edgeGroup('uses →', d.outbound) + edgeGroup('used by ←', d.inbound) +
    (d.siblings && d.siblings.length
      ? '<div class="dim">same file</div><div class="sys-members">' + d.siblings.map((s) => '<span class="node-chip" data-node="' + esc(s.id) + '">' + esc(String(s.label).slice(0, 30)) + '</span>').join('') + '</div>'
      : '') +
    (mem.length ? '<div class="dim">related memory</div><ul>' + mem.join('') + '</ul>' : '') +
    (vecs ? '<div class="dim">related vectors</div><ul>' + vecs + '</ul>' : '');
  for (const chip of $('graph-card').querySelectorAll('.node-chip')) {
    chip.onclick = () => { const t = graph.byId.get(chip.dataset.node); if (t) selectNode(t); };
  }
}

// ---- systems view: node-based architecture map (communities as system nodes) -----

function buildSystems() {
  if (graph.systems && graph.systems.systems.length) return graph.systems;
  const by = new Map();
  for (const n of graph.nodes) {
    if (!by.has(n.community)) by.set(n.community, []);
    by.get(n.community).push(n);
  }
  // Which systems talk to which (cross-community dependency counts).
  const cross = new Map(); // "a|b" → count (a < b)
  for (const l of graph.links) {
    if (l.s.community === l.t.community) continue;
    const key = [l.s.community, l.t.community].sort().join('|');
    cross.set(key, (cross.get(key) || 0) + 1);
  }
  const systems = [...by.entries()]
    .map(([c, nodes]) => {
      const sorted = nodes.slice().sort((x, y) => y.deg - x.deg);
      const files = new Set(nodes.map((n) => n.file).filter(Boolean));
      return { c, hub: sorted[0], nodes: sorted, files: files.size, x: 0, y: 0, vx: 0, vy: 0 };
    })
    .filter((s) => s.nodes.length >= 3)
    .sort((a, b) => b.nodes.length - a.nodes.length)
    .slice(0, 30);
  const index = new Map(systems.map((s) => [s.c, s]));
  const edges = [];
  for (const [key, count] of cross) {
    const [a, b] = key.split('|');
    const sa = index.get(a), sb = index.get(b);
    if (sa && sb) edges.push({ a: sa, b: sb, count });
  }
  // Small force layout in the same 1000×600 world as the visual graph.
  systems.forEach((s, i) => {
    s.x = 500 + Math.cos(i * 2.4) * (90 + i * 9);
    s.y = 300 + Math.sin(i * 2.4) * (60 + i * 6);
  });
  for (let t = 0; t < 250; t++) {
    for (let i = 0; i < systems.length; i++) {
      for (let j = i + 1; j < systems.length; j++) {
        const a = systems[i], b = systems[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = 1; d2 = 1; }
        const f = 2600 / d2;
        a.vx += dx * f; a.vy += dy * f;
        b.vx -= dx * f; b.vy -= dy * f;
      }
    }
    for (const e of edges) {
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 150) * 0.02;
      e.a.vx += (dx / d) * f; e.a.vy += (dy / d) * f;
      e.b.vx -= (dx / d) * f; e.b.vy -= (dy / d) * f;
    }
    for (const s of systems) {
      s.vx += (500 - s.x) * 0.01;
      s.vy += (300 - s.y) * 0.01;
      s.x += s.vx *= 0.75;
      s.y += s.vy *= 0.75;
    }
  }
  // Fit whatever the sim produced into the 1000×600 world box.
  const xs = systems.map((s) => s.x), ys = systems.map((s) => s.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  for (const s of systems) {
    s.x = 90 + ((s.x - minX) / Math.max(1, maxX - minX)) * 820;
    s.y = 70 + ((s.y - minY) / Math.max(1, maxY - minY)) * 460;
  }
  graph.systems = { systems, edges, index };
  return graph.systems;
}

const sysRadius = (s) => Math.min(34, 10 + Math.sqrt(s.nodes.length) * 2.6);

function drawSystems() {
  const canvas = $('graph-canvas');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(graph.ox + w / 2, graph.oy + h / 2);
  ctx.scale(graph.scale * (w / 1100), graph.scale * (w / 1100));
  ctx.translate(-500, -300);

  const { systems, edges } = buildSystems();
  const sel = graph.selectedSystem;
  const q = $('graph-search').value.trim().toLowerCase();
  const sysMatches = q
    ? new Set(systems.filter((s) => s.nodes.some((n) => n.label.toLowerCase().includes(q) || n.file.toLowerCase().includes(q))).map((s) => s.c))
    : new Set();

  const maxCount = Math.max(1, ...edges.map((e) => e.count));
  for (const e of edges) {
    const lit = sel && (e.a === sel || e.b === sel);
    ctx.strokeStyle = lit ? 'rgba(45,226,195,0.8)' : 'rgba(124,92,255,' + (0.10 + (e.count / maxCount) * 0.3) + ')';
    ctx.lineWidth = 0.6 + (e.count / maxCount) * 3.4;
    ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.stroke();
    // dependency weight label on stronger edges
    if (e.count >= maxCount * 0.3 || lit) {
      ctx.fillStyle = lit ? 'rgba(45,226,195,0.9)' : 'rgba(127,134,168,0.7)';
      ctx.font = '8px ui-monospace';
      ctx.fillText(String(e.count), (e.a.x + e.b.x) / 2 + 3, (e.a.y + e.b.y) / 2 - 3);
    }
  }
  for (const s of systems) {
    const r = sysRadius(s);
    const dimmed = (sel && s !== sel && !edges.some((e) => (e.a === sel && e.b === s) || (e.b === sel && e.a === s))) ||
      (q && !sysMatches.has(s.c) && !sel);
    ctx.fillStyle = commColor(s.c, dimmed ? 0.10 : 0.28);
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 7); ctx.fill();
    ctx.strokeStyle = s === sel ? '#fff' : (sysMatches.has(s.c) ? 'rgba(45,226,195,0.9)' : commColor(s.c, dimmed ? 0.25 : 0.85));
    ctx.lineWidth = s === sel ? 2 : 1.2;
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 7); ctx.stroke();
    ctx.fillStyle = dimmed ? 'rgba(215,219,238,0.25)' : (s === sel ? '#fff' : 'rgba(215,219,238,0.92)');
    ctx.font = (s === sel ? '700 ' : '600 ') + '10px ui-monospace';
    ctx.textAlign = 'center';
    ctx.fillText(s.hub.label.slice(0, 22), s.x, s.y - r - 5);
    ctx.fillStyle = dimmed ? 'rgba(127,134,168,0.3)' : 'rgba(127,134,168,0.9)';
    ctx.font = '8.5px ui-monospace';
    ctx.fillText(s.nodes.length + 'n · ' + s.files + 'f', s.x, s.y + 3);
    ctx.textAlign = 'start';
  }
  ctx.restore();
}

function systemAt(canvas, cx, cy) {
  const p = canvasToWorld(canvas, cx, cy);
  const { systems } = buildSystems();
  let best = null, bestD = Infinity;
  for (const s of systems) {
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    if (d < sysRadius(s) + 6 && d < bestD) { bestD = d; best = s; }
  }
  return best;
}

function refActions(ref) {
  return '<div class="card-actions">' +
    '<button class="mini-btn" data-copy="' + esc(ref) + '">copy ref</button>' +
    '<button class="mini-btn" data-delegate="' + esc(ref) + '">delegate ▸</button></div>';
}

function wireRefActions(container) {
  for (const b of container.querySelectorAll('[data-copy]')) {
    b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'copied ✓'; setTimeout(() => { b.textContent = 'copy ref'; }, 1200); };
  }
  for (const b of container.querySelectorAll('[data-delegate]')) {
    b.onclick = () => {
      $('agent-prompt').value = 'Work on ' + b.dataset.delegate + ' — ';
      jumpTo('agents');
      $('agent-prompt').focus();
    };
  }
}

function selectSystem(s) {
  graph.selectedSystem = s;
  graph.selected = null;
  const card = $('graph-card');
  if (!s) { card.hidden = true; drawSystems(); return; }
  const { edges, index } = buildSystems();
  const partners = edges
    .filter((e) => e.a === s || e.b === s)
    .sort((x, y) => y.count - x.count)
    .slice(0, 6)
    .map((e) => { const o = e.a === s ? e.b : e.a; return '<li><span class="sys-link" data-sys="' + esc(o.c) + '">' + esc(o.hub.label) + '</span> — ' + e.count + ' dependency edge(s)</li>'; })
    .join('');
  const members = s.nodes.slice(0, 14).map((n) =>
    '<span class="node-chip" data-node="' + esc(n.id) + '" title="' + esc(n.file) + '">' + esc(n.label.slice(0, 30)) + '</span>').join('');
  const ref = 'system:' + s.hub.label + ' (community ' + s.c + ', ' + s.nodes.length + ' nodes)';
  card.innerHTML = '<h4>⬢ ' + esc(s.hub.label) + ' <span class="dim">system</span></h4>' +
    '<div class="dim">' + s.nodes.length + ' nodes · ' + s.files + ' file(s) · community ' + esc(s.c) + '</div>' +
    (partners ? '<div class="dim" style="margin-top:4px">depends on / used by:</div><ul>' + partners + '</ul>' : '') +
    '<div class="dim" style="margin-top:4px">key members</div><div class="sys-members">' + members + '</div>' +
    refActions(ref);
  card.hidden = false;
  for (const chip of card.querySelectorAll('.node-chip')) {
    chip.onclick = () => { const n = graph.byId.get(chip.dataset.node); if (n) selectNode(n); };
  }
  for (const link of card.querySelectorAll('.sys-link')) {
    link.onclick = () => { const o = index.get(link.dataset.sys); if (o) selectSystem(o); };
  }
  wireRefActions(card);
  drawSystems();
}

// ---- "how this repo works" — generated architecture narrative --------------------

function renderSystemsExplain() {
  const el = $('graph-explain');
  if (graph.mode !== 'systems' || !graph.nodes.length) { el.hidden = true; return; }
  el.hidden = false;
  const { systems } = buildSystems();

  // Directed cross-system dependency weights → role per system.
  const dir = new Map(); // community → {in, out}
  const get = (c) => { if (!dir.has(c)) dir.set(c, { in: 0, out: 0 }); return dir.get(c); };
  for (const l of graph.links) {
    if (l.s.community === l.t.community) continue;
    get(l.s.community).out++;
    get(l.t.community).in++;
  }
  const roleOf = (s) => {
    const d = dir.get(s.c) || { in: 0, out: 0 };
    if (d.in >= d.out * 2 && d.in > 3) return ['foundation', 'shared library — ' + d.in + ' inbound dependencies from other systems'];
    if (d.out >= d.in * 2 && d.out > 3) return ['entry layer', 'orchestrator — drives ' + d.out + ' dependencies into other systems'];
    return ['module', 'domain module (' + d.in + ' in / ' + d.out + ' out cross-system edges)'];
  };

  // Entry points: script/hook files, ranked by connectivity.
  const entries = graph.nodes
    .filter((n) => /^(scripts|hooks)\//.test(n.file) && n.label.includes('.'))
    .sort((a, b) => b.deg - a.deg).slice(0, 6);

  // Runtime flow chains: follow each entry's strongest outbound edges a few hops.
  const chainOf = (start) => {
    const seen = new Set([start.id]);
    const parts = [start];
    let cur = start;
    for (let hop = 0; hop < 3; hop++) {
      const outs = (graph.adj.get(cur.id) || []).filter((l) => l.s.id === cur.id && !seen.has(l.t.id));
      if (!outs.length) break;
      const next = outs.sort((a, b) => b.t.deg - a.t.deg)[0].t;
      seen.add(next.id);
      parts.push(next);
      cur = next;
    }
    return parts;
  };

  const sysRows = systems.slice(0, 10).map((s) => {
    const [tag, desc] = roleOf(s);
    const files = [...new Set(s.nodes.map((n) => n.file).filter(Boolean))].slice(0, 4);
    return '<tr><td><span style="color:' + commColor(s.c, 0.95) + '">●</span> <b class="sys-link" data-sys="' + esc(s.c) + '">' + esc(s.hub.label) + '</b></td>' +
      '<td><span class="pill ' + (tag === 'foundation' ? 'done' : tag === 'entry layer' ? 'running' : 'off') + '">' + tag.toUpperCase() + '</span></td>' +
      '<td>' + esc(desc) + '</td>' +
      '<td class="mono dim">' + files.map(esc).join('<br>') + (s.files > 4 ? '<br>+' + (s.files - 4) + ' more' : '') + '</td></tr>';
  }).join('');

  const flows = entries.slice(0, 5).map((e) => {
    const parts = chainOf(e);
    if (parts.length < 2) return '';
    return '<div class="flow-chain">' + parts.map((n, i) =>
      (i ? ' <span class="dim">→</span> ' : '') +
      '<span class="node-chip" data-node="' + esc(n.id) + '" title="' + esc(n.file) + '">' + esc(n.label.slice(0, 28)) + '</span>').join('') + '</div>';
  }).filter(Boolean).join('');

  el.innerHTML =
    '<div class="card" style="margin-top:10px"><h3>How this repo works</h3>' +
    '<table><tr><th>system</th><th>role</th><th>what it does in the graph</th><th>key files</th></tr>' + sysRows + '</table>' +
    (flows ? '<h3 style="margin-top:12px">Runtime paths (entry point → strongest dependencies)</h3>' + flows : '') +
    '<div class="dim" style="margin-top:6px">Derived from the dependency graph: a system is a graphify community; roles come from cross-system edge direction. Click any name to inspect.</div></div>';
  for (const chip of el.querySelectorAll('.node-chip')) {
    chip.onclick = () => { const n = graph.byId.get(chip.dataset.node); if (n) selectNode(n); };
  }
  const { index } = buildSystems();
  for (const link of el.querySelectorAll('.sys-link')) {
    link.onclick = () => { const s = index.get(link.dataset.sys); if (s) selectSystem(s); };
  }
}

function setGraphView(view) {
  graph.mode = view;
  graph.selected = null;
  graph.selectedSystem = null;
  $('graph-card').hidden = true;
  $('graph-view-visual').classList.toggle('active', view === 'visual');
  $('graph-view-systems').classList.toggle('active', view === 'systems');
  drawGraph();
  renderSystemsExplain();
}

function setupGraphCanvas() {
  const canvas = $('graph-canvas');
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    graph.scale = Math.min(8, Math.max(0.3, graph.scale * (e.deltaY < 0 ? 1.12 : 0.89)));
    drawGraph();
  }, { passive: false });
  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const n = graph.mode === 'visual' ? nodeAt(canvas, e.clientX - rect.left, e.clientY - rect.top) : null;
    if (n) graph.dragging = n;
    else { graph.panning = true; }
    graph.lastX = e.clientX; graph.lastY = e.clientY;
  });
  window.addEventListener('mousemove', (e) => {
    if (graph.dragging) {
      const rect = canvas.getBoundingClientRect();
      const p = canvasToWorld(canvas, e.clientX - rect.left, e.clientY - rect.top);
      graph.dragging.x = p.x; graph.dragging.y = p.y;
      drawGraph();
    } else if (graph.panning) {
      graph.ox += e.clientX - graph.lastX;
      graph.oy += e.clientY - graph.lastY;
      graph.lastX = e.clientX; graph.lastY = e.clientY;
      drawGraph();
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (graph.dragging) { graph.dragging = null; return; }
    if (graph.panning) {
      graph.panning = false;
      const moved = Math.hypot(e.clientX - graph.lastX, e.clientY - graph.lastY);
      if (moved < 4) {
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
        if (graph.mode === 'systems') selectSystem(systemAt(canvas, cx, cy));
        else selectNode(nodeAt(canvas, cx, cy));
      }
    }
  });
  $('graph-search').addEventListener('input', () => {
    const q = $('graph-search').value.trim().toLowerCase();
    graph.matches = new Set();
    if (q) {
      for (const n of graph.nodes) {
        if (n.label.toLowerCase().includes(q) || n.file.toLowerCase().includes(q)) graph.matches.add(n.id);
      }
      $('graph-info').textContent = graph.matches.size + ' match(es)';
    } else {
      $('graph-info').textContent = '';
    }
    if (graph.mode === 'visual' && graph.matches.size === 1) selectNode(graph.byId.get([...graph.matches][0]));
    else drawGraph();
  });
  $('graph-view-visual').onclick = () => setGraphView('visual');
  $('graph-view-systems').onclick = () => setGraphView('systems');
  $('graph-fullscreen').onclick = () => {
    const wrap = document.querySelector('.graph-wrap');
    if (document.fullscreenElement) document.exitFullscreen();
    else wrap.requestFullscreen();
  };
  document.addEventListener('fullscreenchange', () => requestAnimationFrame(drawGraph));
  window.addEventListener('resize', () => drawGraph());
}

// ---- assistant -----------------------------------------------------------------------

const chat = { messages: [], busy: false };

function pushChat(role, content, cls) {
  const div = document.createElement('div');
  div.className = 'a-msg ' + (cls || (role === 'user' ? 'a-user' : 'a-assistant'));
  div.textContent = content;
  $('assistant-log').appendChild(div);
  $('assistant-log').scrollTop = $('assistant-log').scrollHeight;
  return div;
}

async function askAssistant(q) {
  chat.messages.push({ role: 'user', content: q });
  pushChat('user', q);
  const thinking = pushChat('assistant', '…thinking (querying graph/memory)…');
  chat.busy = true;
  try {
    const res = await fetch('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chat.messages }),
    });
    const data = await res.json();
    thinking.remove();
    if (data.error) {
      pushChat('assistant', data.error, 'a-msg a-assistant a-error');
    } else {
      chat.messages.push({ role: 'assistant', content: data.reply });
      pushChat('assistant', data.reply);
      if (data.trace && data.trace.length) {
        pushChat('assistant', 'tools: ' + data.trace.map((t) => t.tool + '(' + JSON.stringify(t.args) + ')').join(' · '), 'a-msg a-trace');
      }
    }
  } catch (e) {
    thinking.textContent = 'request failed: ' + e.message;
  }
  chat.busy = false;
}

// ---- tasks (expandable todos) ----------------------------------------------------------

async function addTaskFromUi() {
  const inp = $('task-new');
  const goal = inp.value.trim();
  if (!goal) return;
  $('task-add').disabled = true;
  const data = await (await fetch('/api/tasks/add', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal }),
  })).json();
  $('task-add').disabled = false;
  if (data.error) { $('task-add-msg').textContent = data.error; return; }
  inp.value = '';
  $('task-add-msg').textContent = 'added ✓';
  loadState(true);
}

async function setTaskStatusUi(id, status) {
  await fetch('/api/tasks/status', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }),
  });
  loadState(true);
}

function renderTasks() {
  if (editingIn($('p-tasks'))) return; // don't clobber a goal being typed
  const tasks = state.tasks || [];
  const addRow =
    '<div class="card"><div class="launch-row">' +
    '<input id="task-new" placeholder="New task goal — added straight to dev-memory, no agent involved" style="flex:1">' +
    '<button id="task-add" class="glow-btn">Add ▸</button><span id="task-add-msg" class="dim"></span></div></div>';
  if (!tasks.length) {
    $('p-tasks').innerHTML = addRow + '<div class="dim">No tasks in dev-memory yet — add one above or via <span class="mono">pnpm dfc:task add</span>.</div>';
    $('tasks-hint').textContent = '0';
    wireTaskAdd();
    return;
  }
  const statusPill = (s) => pill(s === 'done' ? 'ok' : s === 'blocked' ? 'fail' : s === 'in_progress' ? 'running' : 'warn').replace('>OK<', '>DONE<').replace('>WARN<', '>OPEN<').replace('>RUNNING<', '>IN PROGRESS<').replace('>FAIL<', '>BLOCKED<');
  $('p-tasks').innerHTML = addRow + tasks.map((t, i) => {
    const key = 'task-' + i;
    const runs = (state.spawned_agents || []).filter((a) => a.prompt && a.prompt.includes(t.goal)).slice(0, 3);
    const ref = 'task:' + t.goal;
    return '<details class="card task-card"' + (ui.openTasks.has(key) ? ' open' : '') + ' data-task="' + key + '">' +
      '<summary>' + statusPill(t.status) + ' <b>' + esc(String(t.goal).slice(0, 110)) + '</b>' +
      ' <span class="dim">' + age(t.created_at) + ' old</span></summary>' +
      '<div style="margin-top:8px">' +
      '<div class="dim">agent <b>' + esc(t.source_agent || '?') + '</b> · created ' + ts(t.created_at) +
      (t.done_at ? ' · done ' + ts(t.done_at) : ' · updated ' + ts(t.updated_at)) +
      (Array.isArray(t.tags) && t.tags.length ? ' · tags: ' + t.tags.map(esc).join(', ') : '') + '</div>' +
      ((t.blockers || []).length
        ? '<div style="margin-top:6px"><span class="dim">blockers:</span>' + t.blockers.map((b) =>
            '<div>' + pill(b.status === 'open' ? 'fail' : 'ok') + ' ' + esc(b.summary || b.text) + '</div>').join('') + '</div>'
        : '') +
      (runs.length
        ? '<div style="margin-top:6px"><span class="dim">related runs:</span>' + runs.map((r) =>
            '<div>' + pill(r.status) + ' <span class="mono">' + esc(r.id.slice(11, 23)) + '</span> ' + esc([r.provider, r.model].filter(Boolean).join('/')) + '</div>').join('') + '</div>'
        : '') +
      '<div class="card-actions">' +
      (t.id && t.status !== 'in_progress' && t.status !== 'done'
        ? '<button class="mini-btn" data-tstatus="in_progress" data-tid="' + esc(t.id) + '">start</button>' : '') +
      (t.id && t.status !== 'done'
        ? '<button class="mini-btn" data-tstatus="done" data-tid="' + esc(t.id) + '">mark done</button>' : '') +
      (t.id && t.status === 'done'
        ? '<button class="mini-btn" data-tstatus="open" data-tid="' + esc(t.id) + '">reopen</button>' : '') +
      '<button class="mini-btn" data-copy="' + esc(ref) + '">copy ref</button>' +
      '<button class="mini-btn" data-delegate="' + esc(ref) + '">delegate ▸</button></div>' +
      '</div></details>';
  }).join('');
  for (const d of $('p-tasks').querySelectorAll('.task-card')) {
    d.ontoggle = () => { if (d.open) ui.openTasks.add(d.dataset.task); else ui.openTasks.delete(d.dataset.task); };
  }
  for (const b of $('p-tasks').querySelectorAll('[data-tstatus]')) {
    b.onclick = () => { b.disabled = true; setTaskStatusUi(b.dataset.tid, b.dataset.tstatus); };
  }
  wireRefActions($('p-tasks'));
  wireTaskAdd();
  const open = tasks.filter((t) => t.status !== 'done').length;
  $('tasks-hint').textContent = open + ' open · ' + tasks.length + ' total';
}

function wireTaskAdd() {
  $('task-add').onclick = addTaskFromUi;
  $('task-new').onkeydown = (e) => { if (e.key === 'Enter') addTaskFromUi(); };
}

// ---- vectors ----------------------------------------------------------------------------

async function embedNow(btn) {
  btn.disabled = true;
  btn.textContent = 'embedding…';
  try {
    const data = await (await fetch('/api/vectors/embed', { method: 'POST' })).json();
    btn.textContent = data.error ? 'error: ' + String(data.error).slice(0, 60)
      : 'embedded ' + data.embedded + (data.errors ? ' (' + data.errors + ' errors)' : '');
  } catch (e) { btn.textContent = 'failed: ' + e.message; }
  loadState(true);
}

function renderVectors() {
  const v = state.vectors || {};
  const s = v.status || {};
  const statusHtml =
    '<div>' + pill(s.available ? 'ok' : 'off') + ' provider <b>' + esc(s.provider) + '</b>' +
    (s.model ? ' · model <b>' + esc(s.model) + '</b>' : '') +
    (s.dimension ? ' · dim ' + s.dimension : '') +
    ' · key ' + (s.key_present ? pill('ok') : pill('off')) +
    ' · approved ' + (s.approved ? pill('ok') : pill('off')) + '</div>' +
    '<div class="dim" style="margin-top:4px">' + esc(s.reason || '') + '</div>';
  if (v.error) {
    $('p-vectors').innerHTML = '<div class="card"><h3>Embedding status</h3>' + statusHtml +
      '<div class="dim" style="margin-top:6px">' + esc(v.error) + '</div></div>';
    $('vectors-hint').textContent = s.available ? 'ready, no data' : 'off';
    return;
  }
  const tot = v.totals || { chunks: 0, embedded: 0, pending: 0 };
  const files = (v.files || []).slice(0, 20);
  const fileRows = files.map((f) =>
    '<tr><td class="mono">' + esc(f.path) + '</td><td>' + f.chunks + '</td><td>' + f.embedded + '</td>' +
    '<td>' + (f.pending ? '<span class="pill warn">' + f.pending + ' pending</span>' : pill('ok')) + '</td></tr>').join('');
  $('p-vectors').innerHTML =
    '<div class="two-col">' +
    '<div class="card"><h3>Embedding status</h3>' + statusHtml +
    '<div style="margin-top:8px"><button class="glow-btn" id="embed-now"' + (s.available && tot.pending ? '' : ' disabled') + '>Embed ' + tot.pending + ' pending ▸</button>' +
    (s.provider === 'openai' ? ' <span class="dim">paid API (approved in config)</span>' : '') + '</div></div>' +
    '<div class="card"><h3>Coverage</h3>' +
    '<div>chunks <b>' + tot.chunks + '</b> · embedded <b>' + tot.embedded + '</b> · pending <b>' + tot.pending + '</b></div>' +
    ((v.models || []).length
      ? '<div class="dim" style="margin-top:4px">models: ' + v.models.map((m) => esc(m.provider + ':' + m.model) + ' (dim ' + m.dimension + ')').join(' · ') + '</div>'
      : '<div class="dim" style="margin-top:4px">no embedding model registered yet — nothing embedded</div>') + '</div>' +
    '</div>' +
    '<div class="card"><h3>Per-file coverage (worst first)</h3>' +
    (fileRows ? '<table><tr><th>file</th><th>chunks</th><th>embedded</th><th>state</th></tr>' + fileRows + '</table>'
      : '<div class="dim">No doc chunks in dev-memory — run <span class="mono">pnpm dfc:ingest</span> first, then embed.</div>') + '</div>';
  const btn = $('embed-now');
  if (btn) btn.onclick = () => embedNow(btn);
  $('vectors-hint').textContent = s.available ? tot.embedded + '/' + tot.chunks + ' embedded' : 'off';
}

// ---- config -----------------------------------------------------------------------------

function configField(label, key, value, opts) {
  const type = opts && opts.secret ? 'password' : 'text';
  const ph = opts && opts.secret ? (opts.set ? 'set — leave blank to keep' : 'not set') : '';
  return '<label class="cfg-field">' + esc(label) +
    '<input type="' + type + '" data-key="' + esc(key) + '" value="' + esc(value || '') + '" placeholder="' + esc(ph) + '"></label>';
}

function configSelect(label, key, value, choices) {
  return '<label class="cfg-field">' + esc(label) + '<select data-key="' + esc(key) + '">' +
    choices.map((c) => '<option value="' + esc(c) + '"' + (c === value ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
    '</select></label>';
}

async function saveConfig(file, card, btn) {
  const values = {};
  for (const el of card.querySelectorAll('[data-key]')) values[el.dataset.key] = el.value;
  btn.disabled = true;
  btn.textContent = 'saving…';
  try {
    const data = await (await fetch('/api/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file, values }),
    })).json();
    btn.textContent = data.error ? 'error: ' + data.error : 'saved ' + (data.saved || []).length + ' key(s) ✓';
  } catch (e) { btn.textContent = 'failed: ' + e.message; }
  btn.disabled = false;
  ui.configStamp = ''; // force re-render with fresh status
  loadState(true);
}

function renderConfig() {
  const c = state.config;
  if (!c) return;
  const stamp = JSON.stringify([c.mercury, c.embed, c.defaults]);
  if (stamp === ui.configStamp) return; // don't clobber in-progress edits with identical data
  if (editingIn($('p-config'))) return;
  ui.configStamp = stamp;
  const d = c.defaults || {};
  const providers = c.providers || {};
  const provNames = Object.keys(providers);
  $('p-config').innerHTML =
    '<div class="dim" style="margin-bottom:8px">Saved to gitignored <span class="mono">.dfc/mercury.env · embed.env · nox.env</span> in this repo. Blank secret fields keep the existing key. Env vars still override files.</div>' +
    '<div class="two-col">' +
    '<div class="card" data-cfg="mercury"><h3>Assistant ' + (c.mercury.configured ? pill('ok') : pill('off')) + '</h3>' +
    configField('API key', 'MERCURY_API_KEY', '', { secret: true, set: c.mercury.configured }) +
    configField('Base URL (OpenAI-compatible)', 'MERCURY_BASE_URL', c.mercury.base_url) +
    configField('Model', 'MERCURY_MODEL', c.mercury.model) +
    configField('Tool-call limit (rounds)', 'NOX_ASSISTANT_ROUNDS', String(d.assistant_rounds)) +
    '<button class="glow-btn cfg-save">Save ▸</button></div>' +
    '<div class="card" data-cfg="embed"><h3>Embeddings ' + (c.embed.available ? pill('ok') : pill('off')) + '</h3>' +
    configSelect('Provider', 'DFC_EMBED_PROVIDER', c.embed.provider, ['none', 'ollama', 'openai']) +
    configField('Model', 'DFC_EMBED_MODEL', c.embed.model) +
    configField('Dimension', 'DFC_EMBED_DIMENSION', String(c.embed.dimension || '')) +
    configSelect('Approved (paid ok)', 'DFC_EMBED_APPROVED', c.embed.approved ? '1' : '0', ['0', '1']) +
    configField('OpenAI API key', 'OPENAI_API_KEY', '', { secret: true, set: c.embed.key_present }) +
    '<div class="dim">' + esc(c.embed.reason) + '</div>' +
    '<button class="glow-btn cfg-save">Save ▸</button></div>' +
    '<div class="card" data-cfg="nox"><h3>Launch defaults</h3>' +
    configSelect('Default provider', 'NOX_DEFAULT_PROVIDER', d.provider, provNames) +
    configField('Default model', 'NOX_DEFAULT_MODEL', d.model) +
    configSelect('Default effort', 'NOX_DEFAULT_EFFORT', d.effort, ['low', 'medium', 'high']) +
    '<button class="glow-btn cfg-save">Save ▸</button></div>' +
    '<div class="card" data-cfg="nox"><h3>Routing defaults</h3>' +
    configSelect('Workflow', 'NOX_ROUTE_WORKFLOW', d.routes.workflow, ['', 'native', 'superpowers', 'gsd']) +
    configSelect('Subagents', 'NOX_ROUTE_SUBAGENTS', d.routes.subagents, ['', 'native-dynamic', 'native-specific', 'antigravity-dynamic', 'antigravity-specific', 'codex']) +
    configSelect('Search', 'NOX_ROUTE_SEARCH', d.routes.search, ['', 'native', 'playwright', 'firecrawl']) +
    configSelect('Docs', 'NOX_ROUTE_DOCS', d.routes.docs, ['', 'search', 'context7']) +
    configSelect('Git', 'NOX_ROUTE_GIT', d.routes.git, ['', 'git-cli', 'gitkraken']) +
    '<button class="glow-btn cfg-save">Save ▸</button></div>' +
    '</div>';
  for (const card of $('p-config').querySelectorAll('[data-cfg]')) {
    const btn = card.querySelector('.cfg-save');
    btn.onclick = () => saveConfig(card.dataset.cfg, card, btn);
  }
  const issues = (c.mercury.configured ? 0 : 1) + (c.embed.available ? 0 : 1);
  $('config-hint').textContent = issues ? issues + ' provider(s) unconfigured' : 'all configured';
}

// ---- boot -----------------------------------------------------------------------------

function render() {
  if (!state) return;
  $('repoline').textContent = state.repo.repo_id + ' · ' + state.repo.root;
  $('refreshed').textContent = 'updated ' + ts(state.generated_at);
  $('assistant-model').textContent = state.assistant && state.assistant.configured
    ? state.assistant.model : 'not configured (.dfc/mercury.env)';
  renderChips();
  renderControl();
  initPickers();
  renderAgents();
  renderWorkflows();
  renderTasks();
  renderMemory();
  renderVectors();
  renderMetrics();
  renderTokens();
  renderSync();
  renderObservability();
  renderHealth();
  renderConfig();
  initGraph();
}

async function loadState(fresh) {
  try {
    const res = await fetch('/api/state' + (fresh ? '?fresh=1' : ''));
    state = await res.json();
    render();
  } catch {
    $('repoline').textContent = 'dashboard server unreachable';
  }
}
window.loadState = loadState;

$('jump').onchange = () => { if ($('jump').value) jumpTo($('jump').value); $('jump').value = ''; };
$('agent-launch').onclick = launchAgent;
for (const sel of document.querySelectorAll('.tools-grid select[data-tool]')) sel.onchange = updateToolControls;
$('agent-mode').onchange = updateToolControls;
$('assistant-toggle').onclick = () => { $('assistant').hidden = !$('assistant').hidden; if (!$('assistant').hidden) $('assistant-q').focus(); };
$('assistant-close').onclick = () => { $('assistant').hidden = true; };
$('assistant-form').onsubmit = (e) => {
  e.preventDefault();
  const q = $('assistant-q').value.trim();
  if (!q || chat.busy) return;
  $('assistant-q').value = '';
  askAssistant(q);
};

loadState(false);
setInterval(() => loadState(false), 5000);
