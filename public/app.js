import { runIncident, runAll, CONFIGS } from '/stack.mjs';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

const scenario = await (await fetch('/scenario.json')).json();

const currentMode = () =>
  document.querySelector('input[name=mode]:checked')?.value ?? 'healthy';

const STATE_BADGE = { completed: 'pass', degraded: 'warn', failed: 'fail' };

function renderVerdict(result) {
  const grid = $('metrics');
  grid.replaceChildren();
  const completed = result.tasks.filter((t) => t.state === 'completed').length;
  const failed = result.tasks.filter((t) => t.state === 'failed').length;
  const rows = [
    ['run state', result.state, result.state === 'completed' ? 'both layers held' : 'something broke — read the trace by layer'],
    ['tasks completed', `${completed}/${result.tasks.length}`, failed ? `${failed} returned failed` : 'all artifacts returned'],
    ['a2a-leg failures', String(result.byLayer.a2aFailures), 'coordination hops'],
    ['mcp-leg failures', String(result.byLayer.mcpFailures), 'capability hops'],
  ];
  for (const [label, value, sub] of rows) {
    const card = el('div', 'metric');
    card.append(el('span', 'metric-label', label));
    card.append(el('strong', 'metric-value', value));
    card.append(el('span', 'muted', sub));
    grid.append(card);
  }
  const badge = $('verdict');
  badge.textContent = result.state;
  badge.className = `badge ${STATE_BADGE[result.state]}`;
  $('verdict-note').textContent = result.answer;
}

function renderTrace(result) {
  const list = $('trace');
  list.replaceChildren();
  for (const h of result.trace) {
    const item = el('li', `result ${h.status === 'fail' ? 'fail' : h.layer === 'mcp' ? 'mcp-item' : h.layer === 'a2a' ? 'a2a-item' : 'pass'}`);
    const head = el('div', 'result-head');
    head.append(el('span', `badge ${h.layer}`, h.layer));
    head.append(el('strong', '', `${h.from} → ${h.to}`));
    head.append(el('span', 'muted', `#${h.seq}`));
    item.append(head);
    item.append(el('p', '', `${h.op} — ${h.detail}`));
    list.append(item);
  }
  $('trace-count').textContent = `${result.trace.length} hops · ${result.byLayer.a2aFailures + result.byLayer.mcpFailures} failures`;
}

function renderTasks(result) {
  const list = $('tasks');
  list.replaceChildren();
  for (const t of result.tasks) {
    const item = el('li', `result ${t.state === 'failed' ? 'fail' : 'pass'}`);
    const head = el('div', 'result-head');
    head.append(el('span', `badge ${t.state === 'failed' ? 'fail' : 'pass'}`, t.state));
    head.append(el('strong', '', t.id));
    item.append(head);
    item.append(el('p', '', t.artifact ? `artifact: ${t.artifact}` : `error: ${t.error}`));
    list.append(item);
  }
}

function run() {
  const mode = currentMode();
  const cfg = CONFIGS.find((c) => c.id === mode);
  const result = runIncident(scenario, cfg.opts);
  renderVerdict(result);
  renderTrace(result);
  renderTasks(result);
}

function runAllConfigs() {
  const tbody = document.querySelector('#matrix tbody');
  tbody.replaceChildren();
  for (const c of runAll(scenario)) {
    const tr = el('tr');
    tr.append(el('td', '', c.label));
    tr.append(el('td', c.result.state === 'completed' ? 'yes' : 'no', c.result.state));
    tr.append(el('td', '', String(c.result.byLayer.a2aFailures)));
    tr.append(el('td', '', String(c.result.byLayer.mcpFailures)));
    tr.append(el('td', '', c.result.answer));
    tbody.append(tr);
  }
}

$('run').addEventListener('click', run);
$('run-all').addEventListener('click', runAllConfigs);
run();
