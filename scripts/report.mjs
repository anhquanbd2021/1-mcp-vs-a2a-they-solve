#!/usr/bin/env node
// The four-way matrix: one incident task through a healthy stack and each
// failure mode. Prints every trace ladder and checks the invariants the
// lab exists to prove. Exits non-zero if an invariant breaks.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runIncident, runAll, CONFIGS, ERRORS, LAYERS } from '../public/stack.mjs';

const scenario = JSON.parse(readFileSync(
  fileURLToPath(new URL('../examples/scenario.json', import.meta.url)), 'utf8'));

const col = (s, w) => String(s).padEnd(w);
const results = runAll(scenario);

console.log(`\nProtocol Layers Lab — scenario "${scenario.name}"`);
console.log(`task: ${scenario.task.goal}\n`);

for (const c of results) {
  const r = c.result;
  console.log(`${'='.repeat(96)}`);
  console.log(`${c.label.toUpperCase()}  ->  ${r.state}`);
  console.log('-'.repeat(96));
  for (const h of r.trace) {
    const mark = h.status === 'fail' ? 'FAIL' : ' ok ';
    console.log(`  ${col(`#${h.seq}`, 4)} [${h.layer}] ${mark} ${col(`${h.from} -> ${h.to}`, 38)} ${col(h.op, 16)} ${h.detail}`);
  }
  console.log(`  verdict: ${r.answer}`);
  console.log(`  failures by layer: a2a=${r.byLayer.a2aFailures} mcp=${r.byLayer.mcpFailures}\n`);
}

// --- invariants: the relationships the demo exists to prove ---
const byId = Object.fromEntries(results.map((c) => [c.id, c.result]));
const failures = [];

// 1. Healthy run completes with every task's artifact and a clean trace.
if (!(byId.healthy.state === 'completed')) failures.push('healthy run did not complete');
if (!(byId.healthy.tasks.every((t) => t.artifact))) failures.push('healthy run missing artifacts');
if (!(byId.healthy.byLayer.a2aFailures === 0 && byId.healthy.byLayer.mcpFailures === 0)) {
  failures.push('healthy run reported a layer failure');
}

// 2. Trace ordering: for each agent, its a2a tasks/send precedes its mcp
//    tools/list, which precedes tools/call — delegation wraps capability.
const h = byId.healthy.trace;
const seqOf = (layer, op, from) => h.find((e) => e.layer === layer && e.op === op && e.from === from)?.seq ?? -1;
for (const a of scenario.agents) {
  const send = h.find((e) => e.layer === LAYERS.A2A && e.op === 'tasks/send' && e.to === a.id);
  const list = h.find((e) => e.layer === LAYERS.MCP && e.op === 'tools/list' && e.from === a.id);
  const call = h.find((e) => e.layer === LAYERS.MCP && e.op === 'tools/call' && e.from === a.id);
  if (!(send && list && call && send.seq < list.seq && list.seq < call.seq)) {
    failures.push(`${a.id}: hop order broken (a2a send must precede mcp list must precede call)`);
  }
}
if (!(seqOf(LAYERS.A2A, 'agents/discover', scenario.orchestrator.id) > 0)) {
  failures.push('agent-card discovery missing from a healthy run');
}

// 3. Dead MCP server: the mcp leg fails TOOL_UNREACHABLE; zero a2a-leg
//    failures — coordination held while capability vanished. degraded.
if (!(byId['dead-mcp'].state === 'degraded')) failures.push('dead-mcp run was not degraded');
if (!(byId['dead-mcp'].byLayer.mcpFailures > 0 && byId['dead-mcp'].byLayer.a2aFailures === 0)) {
  failures.push('dead-mcp: expected mcp-layer failures only');
}
const deadTask = byId['dead-mcp'].tasks.find((t) => t.state === 'failed');
if (!(deadTask && deadTask.error === ERRORS.TOOL_UNREACHABLE)) {
  failures.push('dead-mcp: failed task did not carry TOOL_UNREACHABLE');
}

// 4. Delegation loop: the a2a leg fails DELEGATION_LOOP and that agent's
//    mcp edge never runs — the work died at the seam. failed.
if (!(byId.loop.state === 'failed')) failures.push('loop run did not fail');
if (!(byId.loop.byLayer.a2aFailures > 0)) failures.push('loop: no a2a-leg failure recorded');
const loopAgent = scenario.agents[0].id;
if (!(byId.loop.trace.every((e) => !(e.layer === LAYERS.MCP && e.from === loopAgent)))) {
  failures.push('loop: the looping agent still reached its tool edge');
}
const loopTask = byId.loop.tasks.find((t) => t.agent === loopAgent);
if (!(loopTask && loopTask.error === ERRORS.DELEGATION_LOOP)) {
  failures.push('loop: task did not carry DELEGATION_LOOP');
}

// 5. Thin handoff: a2a hops all succeed — tasks were delivered — but every
//    tools/call fails INSUFFICIENT_CONTEXT. Healthy seam, broken payload.
if (!(byId.thin.state === 'degraded')) failures.push('thin run was not degraded');
if (!(byId.thin.byLayer.a2aFailures === 0)) failures.push('thin: a2a-leg should be clean');
const thinSends = byId.thin.trace.filter((e) => e.layer === LAYERS.A2A && e.op === 'tasks/send');
if (!(thinSends.every((e) => e.status === 'ok'))) failures.push('thin: a delegation hop failed');
const thinCalls = byId.thin.trace.filter((e) => e.layer === LAYERS.MCP && e.op === 'tools/call');
if (!(thinCalls.length === scenario.agents.length && thinCalls.every((e) => e.status === 'fail'))) {
  failures.push('thin: expected every tools/call to fail INSUFFICIENT_CONTEXT');
}
if (!(byId.thin.tasks.every((t) => t.error === ERRORS.INSUFFICIENT_CONTEXT))) {
  failures.push('thin: a task failed with the wrong error');
}

if (failures.length) {
  console.error('INVARIANT FAILURES:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('All layer invariants hold: delegation wraps capability, a dead tool fails only the');
console.log('mcp leg, a loop fails only the a2a leg, and a thin packet fails inside a healthy seam.');
