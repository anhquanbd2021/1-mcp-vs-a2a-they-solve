# Protocol Layers Lab — companion demo

Interactive lab for the article *MCP and A2A Are Not Competitors — They're
Different Layers of the Agent Stack*. One incident task descends a toy
agent stack while a per-hop trace tags every hop by the boundary it
crosses: **A2A-shaped delegation hops** (agent ↔ agent) vs. **MCP-shaped
tool hops** (agent ↔ tool server).

Zero dependencies — Node 20+ only. The stack engine is a plain ES module
shared by the browser UI, the CLI report, and the test suite.

## The scenario

*"Why did checkout p95 latency spike at 14:00?"* — an orchestrator
discovers two specialists by agent card (`agents/discover`), delegates a
subtask to each (`tasks/send`), and each specialist reaches its tool
server (`tools/list` → `tools/call`) before artifacts climb back
(`tasks/result`).

## Four configurations

| Mode | What it proves |
|---|---|
| **healthy** | Delegation wraps capability: `tasks/send` → `tools/list` → `tools/call` per agent; the run completes. |
| **dead-mcp** | Kill `metrics-db` → `tools/call` fails `TOOL_UNREACHABLE`. The A2A hops stay clean — coordination held, capability vanished. Verdict: `degraded`. |
| **loop** | A specialist delegates back to the orchestrator, already in the `delegationPath` → `DELEGATION_LOOP`. The tool edge is never reached. Verdict: `failed`. |
| **thin** | The handoff packet arrives without the working set → `tools/call` fails `INSUFFICIENT_CONTEXT` on a healthy A2A hop. Verdict: `degraded`. |

## Run it

```text
npm start        # serve the lab on :3000
npm test         # engine + server + CLI contract tests
npm run report   # print all four trace ladders + invariant checks
npm run check    # both
```

## Honest limits

- **Protocol shapes, not wire formats.** Ops are named and sequenced like
  real MCP (`tools/list`, `tools/call`, schema-shaped inputs) and A2A
  (agent cards, task lifecycle) calls, but nothing emits JSON-RPC or HTTP.
  You cannot point a real MCP client or A2A agent at it.
- No model is called — specialists map subtasks to tools by fixture.
- Real deployments add auth between agent boundaries, streaming task
  updates, transport negotiation, and long-running states — all compressed
  to a synchronous ladder here.
- One scenario, two specialists, one tool each. The point is the boundary,
  not the topology.

This is an educational demo, not production infrastructure.
