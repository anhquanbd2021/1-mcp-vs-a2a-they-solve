// Engine contract: the trace tags every hop by layer, each failure mode
// lands on its own layer, and delegation always wraps capability.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runIncident, agentCards, ERRORS, LAYERS, CONFIGS } from '../public/stack.mjs';

const scenario = JSON.parse(readFileSync(
  fileURLToPath(new URL('../examples/scenario.json', import.meta.url)), 'utf8'));

test('agent cards describe agents (skills), not tools', () => {
  const cards = agentCards(scenario);
  assert.equal(cards.length, scenario.agents.length);
  for (const c of cards) {
    assert.ok(c.id && c.name && Array.isArray(c.skills));
    assert.equal(c.tools, undefined);
  }
});

test('healthy run: completed state, every artifact, no layer failures', () => {
  const r = runIncident(scenario);
  assert.equal(r.state, 'completed');
  assert.equal(r.tasks.length, scenario.agents.length);
  assert.ok(r.tasks.every((t) => t.state === 'completed' && t.artifact));
  assert.equal(r.byLayer.a2aFailures, 0);
  assert.equal(r.byLayer.mcpFailures, 0);
});

test('healthy trace: discovery, then a2a wraps mcp per agent', () => {
  const r = runIncident(scenario);
  assert.ok(r.trace.some((e) => e.op === 'agents/discover' && e.layer === LAYERS.A2A));
  for (const a of scenario.agents) {
    const send = r.trace.find((e) => e.layer === LAYERS.A2A && e.op === 'tasks/send' && e.to === a.id);
    const list = r.trace.find((e) => e.layer === LAYERS.MCP && e.op === 'tools/list' && e.from === a.id);
    const call = r.trace.find((e) => e.layer === LAYERS.MCP && e.op === 'tools/call' && e.from === a.id);
    assert.ok(send.seq < list.seq && list.seq < call.seq, `${a.id}: delegation must wrap capability`);
  }
  // sequence numbers are a contiguous ladder
  r.trace.forEach((e, i) => assert.equal(e.seq, i + 1));
});

test('dead MCP server: mcp leg fails TOOL_UNREACHABLE, a2a leg stays clean', () => {
  const r = runIncident(scenario, { toolHealth: { 'metrics-db': false } });
  assert.equal(r.state, 'degraded');
  assert.ok(r.byLayer.mcpFailures > 0);
  assert.equal(r.byLayer.a2aFailures, 0);
  const dead = r.tasks.find((t) => t.agent === 'metrics-agent');
  assert.equal(dead.state, 'failed');
  assert.equal(dead.error, ERRORS.TOOL_UNREACHABLE);
  // the other agent is untouched
  assert.equal(r.tasks.find((t) => t.agent === 'logs-agent').state, 'completed');
});

test('delegation loop: refused at the a2a layer, tool edge never reached', () => {
  const r = runIncident(scenario, { delegation: 'loop' });
  assert.equal(r.state, 'failed');
  assert.ok(r.byLayer.a2aFailures > 0);
  const looping = scenario.agents[0].id;
  const task = r.tasks.find((t) => t.agent === looping);
  assert.equal(task.error, ERRORS.DELEGATION_LOOP);
  assert.ok(r.trace.every((e) => !(e.layer === LAYERS.MCP && e.from === looping)),
    'the looping agent must never reach its tool edge');
  assert.ok(r.trace.some((e) => e.layer === LAYERS.A2A && e.status === 'fail'
    && e.detail.includes(ERRORS.DELEGATION_LOOP)));
});

test('thin handoff: clean a2a hops, every tools/call fails INSUFFICIENT_CONTEXT', () => {
  const r = runIncident(scenario, { handoff: 'thin' });
  assert.equal(r.state, 'degraded');
  assert.equal(r.byLayer.a2aFailures, 0);
  assert.ok(r.trace.filter((e) => e.op === 'tasks/send').every((e) => e.status === 'ok'));
  const calls = r.trace.filter((e) => e.layer === LAYERS.MCP && e.op === 'tools/call');
  assert.equal(calls.length, scenario.agents.length);
  assert.ok(calls.every((e) => e.status === 'fail'));
  assert.ok(r.tasks.every((t) => t.error === ERRORS.INSUFFICIENT_CONTEXT));
});

test('CONFIGS covers one healthy run plus the three failure modes', () => {
  assert.deepEqual(CONFIGS.map((c) => c.id), ['healthy', 'dead-mcp', 'loop', 'thin']);
});
