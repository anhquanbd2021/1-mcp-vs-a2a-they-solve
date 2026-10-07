// Protocol Layers Lab — a toy agent stack where one incident task descends
// through two different kinds of hop:
//
//   A2A-shaped hops  (layer: 'a2a') — agent ↔ agent. Agent-card discovery,
//                    task submission, lifecycle states, artifacts coming back.
//                    This is the *coordination* boundary.
//   MCP-shaped hops  (layer: 'mcp') — agent ↔ tool server. tools/list
//                    discovery, tools/call invocation against a schema.
//                    This is the *capability* boundary.
//
// These are protocol SHAPES, not wire formats: the ops are named and
// sequenced like the real calls so the boundary stays visible, but no
// JSON-RPC or HTTP is emitted. Every hop posts one trace entry, so a
// failure can be read by layer: a dead tools/call is an MCP-leg problem;
// a delegation loop is an A2A-leg problem; a missing argument is a
// content problem riding a healthy A2A hop.

export const LAYERS = { A2A: 'a2a', MCP: 'mcp', TASK: 'task' };

// Error codes — one per failure mode the lab demonstrates.
export const ERRORS = {
  TOOL_UNREACHABLE: 'TOOL_UNREACHABLE',     // MCP leg: server did not answer
  INSUFFICIENT_CONTEXT: 'INSUFFICIENT_CONTEXT', // thin handoff: required args missing
  DELEGATION_LOOP: 'DELEGATION_LOOP',       // A2A leg: target already in the path
};

// --- A2A discovery: agent cards describe *agents* (id, skills), not tools ---
export function agentCards(scenario) {
  return scenario.agents.map((a) => ({ id: a.id, name: a.name, skills: a.skills }));
}

// A delegation packet is the task envelope that crosses an A2A hop.
// 'full' carries the working set; 'thin' strips it — the protocol still
// delivers the task, it just arrives without what the agent needs.
function makePacket(scenario, agent, handoff) {
  return {
    subtask: agent.subtask,
    context: handoff === 'full' ? { ...scenario.task.context } : {},
  };
}

// The MCP leg of one specialist: discover tools, then invoke. A dead
// server fails the discovery call itself — the capability is gone before
// the agent can even ask what the server offers.
function runMcpLeg(trace, agent, server, packet) {
  const post = (op, status, detail) => trace.push({
    seq: trace.length + 1, layer: LAYERS.MCP,
    from: agent.id, to: server.id, op, status, detail,
  });

  if (!server.alive) {
    post('tools/list', 'fail', `${ERRORS.TOOL_UNREACHABLE} — ${server.id} did not answer; capability gone`);
    post('tools/call', 'fail', `${agent.tool} never invoked — discovery failed upstream`);
    return { ok: false, error: ERRORS.TOOL_UNREACHABLE };
  }

  post('tools/list', 'ok', `offers ${server.tools.map((t) => t.name).join(', ')}`);

  // The tool validates its inputSchema. Under a thin handoff the agent
  // has no service/window to fill the arguments with — the call goes out
  // and the schema rejects it.
  const required = server.tools[0].inputSchema.required;
  const args = { ...agent.toolArgs };
  for (const key of required) {
    if (!(key in packet.context) && !(key === 'level')) delete args[key];
  }
  const missing = required.filter((key) => !(key in args));
  if (missing.length) {
    post('tools/call', 'fail',
      `${ERRORS.INSUFFICIENT_CONTEXT} — missing required args: ${missing.join(', ')}`);
    return { ok: false, error: ERRORS.INSUFFICIENT_CONTEXT };
  }

  post('tools/call', 'ok', `${agent.tool}(${required.map((k) => args[k]).join(', ')}) -> artifact`);
  return { ok: true, artifact: agent.artifact };
}

// One specialist's A2A leg: receive the task, run its MCP edge, return an
// artifact — or, in 'loop' mode, delegate the confusing part back upstream.
// Every task carries a delegationPath; submitting to an agent already in
// the path is what the router rejects.
function delegate(trace, tasks, scenario, agent, opts) {
  const { orchestrator } = scenario;
  const post = (layer, from, to, op, status, detail) => trace.push({
    seq: trace.length + 1, layer, from, to, op, status, detail,
  });

  const packet = makePacket(scenario, agent, opts.handoff);
  const task = { id: `${scenario.task.id}/${agent.id}`, agent: agent.id, state: 'submitted' };
  tasks.push(task);

  post(LAYERS.A2A, orchestrator.id, agent.id, 'tasks/send', 'ok',
    `subtask delegated — packet carries ${Object.keys(packet.context).length || 'no'} context keys`);
  task.state = 'working';
  post(LAYERS.TASK, agent.id, agent.id, 'state', 'ok', 'submitted -> working');

  // Loop mode: the specialist cannot map the subtask to a tool, so it
  // delegates "the diagnosis part" back to the orchestrator — which is
  // already in the delegationPath. The router refuses the cycle.
  const path = [orchestrator.id, agent.id];
  if (opts.delegation === 'loop' && agent.id === scenario.agents[0].id) {
    const target = orchestrator.id;
    if (path.includes(target)) {
      post(LAYERS.A2A, agent.id, target, 'tasks/send', 'fail',
        `${ERRORS.DELEGATION_LOOP} — ${target} already in delegation path [${path.join(' -> ')}]`);
      task.state = 'failed';
      task.error = ERRORS.DELEGATION_LOOP;
      post(LAYERS.TASK, agent.id, agent.id, 'state', 'fail', `working -> failed (${task.error})`);
      return task;
    }
  }

  const server = scenario.mcpServers.find((s) => s.id === agent.server);
  const leg = runMcpLeg(trace, agent, { ...server, alive: opts.toolHealth[server.id] !== false }, packet);

  if (leg.ok) {
    task.state = 'completed';
    task.artifact = leg.artifact;
    post(LAYERS.TASK, agent.id, agent.id, 'state', 'ok', 'working -> completed');
    post(LAYERS.A2A, agent.id, orchestrator.id, 'tasks/result', 'ok',
      `artifact returned — ${leg.artifact}`);
  } else {
    task.state = 'failed';
    task.error = leg.error;
    post(LAYERS.TASK, agent.id, agent.id, 'state', 'fail', `working -> failed (${leg.error})`);
    // The result hop itself succeeded — it faithfully carried a failure
    // raised at the MCP edge. A fail status here would be the delegation
    // layer claiming a break it did not cause.
    post(LAYERS.A2A, agent.id, orchestrator.id, 'tasks/result', 'ok',
      `task returned failed — ${leg.error} raised at the MCP edge`);
  }
  return task;
}

// Run the whole incident: one task in, a verdict out, every hop traced.
export function runIncident(scenario, opts = {}) {
  const o = { toolHealth: {}, delegation: 'normal', handoff: 'full', ...opts };
  const trace = [];
  const tasks = [];
  const post = (layer, from, to, op, status, detail) => trace.push({
    seq: trace.length + 1, layer, from, to, op, status, detail,
  });

  post(LAYERS.TASK, 'user', scenario.orchestrator.id, 'task.submit', 'ok',
    `"${scenario.task.goal}"`);

  // A2A discovery happens at the coordination layer: the orchestrator
  // learns who exists and what they claim to do — not what tools they run.
  const cards = agentCards(scenario);
  post(LAYERS.A2A, scenario.orchestrator.id, 'agent-directory', 'agents/discover', 'ok',
    `agent cards: ${cards.map((c) => `${c.id} [${c.skills[0]}]`).join(' · ')}`);

  for (const agent of scenario.agents) delegate(trace, tasks, scenario, agent, o);

  // Verdict: read the failures by layer, not as one undifferentiated break.
  const failures = tasks.filter((t) => t.state === 'failed');
  const mcpFails = trace.filter((t) => t.layer === LAYERS.MCP && t.status === 'fail');
  const a2aFails = trace.filter((t) => t.layer === LAYERS.A2A && t.status === 'fail');

  let state, answer;
  if (failures.some((t) => t.error === ERRORS.DELEGATION_LOOP)) {
    state = 'failed';
    answer = 'coordination broke — a delegation loop was refused before work could start';
  } else if (failures.length) {
    state = 'degraded';
    const why = failures.map((t) => `${t.agent}: ${t.error}`).join('; ');
    answer = `partial answer — the coordination held but capability/context failed (${why})`;
  } else {
    state = 'completed';
    answer = 'checkout p95 spiked when db-connection-timeout errors began at 14:06 — ' +
      'metrics and logs agree on the same window';
  }

  post(LAYERS.TASK, scenario.orchestrator.id, 'user', 'tasks/aggregate', 'ok',
    `verdict: ${state}`);

  return {
    state, answer, trace, tasks,
    byLayer: {
      a2aFailures: a2aFails.length,
      mcpFailures: mcpFails.length,
    },
  };
}

// The four configurations the lab demonstrates — one healthy run plus the
// three failure modes, one per concept the article names.
export const CONFIGS = [
  { id: 'healthy', label: 'healthy — both layers working', opts: {} },
  { id: 'dead-mcp', label: 'dead MCP server (metrics-db)', opts: { toolHealth: { 'metrics-db': false } } },
  { id: 'loop', label: 'delegation loop (A2A layer)', opts: { delegation: 'loop' } },
  { id: 'thin', label: 'thin handoff packet (A2A content)', opts: { handoff: 'thin' } },
];

export function runAll(scenario) {
  return CONFIGS.map((c) => ({ ...c, result: runIncident(scenario, c.opts) }));
}
