// CLI contract: the four-configuration report runs and exits cleanly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const report = fileURLToPath(new URL('../scripts/report.mjs', import.meta.url));

test('report.mjs prints all four ladders and exits 0', () => {
  const out = execFileSync(process.execPath, [report], { encoding: 'utf8' });
  for (const label of ['HEALTHY', 'DEAD MCP SERVER', 'DELEGATION LOOP', 'THIN HANDOFF']) {
    assert.ok(out.includes(label), `missing section ${label}`);
  }
  assert.ok(out.includes('All layer invariants hold'));
});
