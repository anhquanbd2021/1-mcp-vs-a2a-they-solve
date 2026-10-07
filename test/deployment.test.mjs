// Server contract: allowlisted files only, security headers, health + version.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startProduction } from '../app/server.js';

let server, base, close;

before(async () => {
  ({ server, close } = await startProduction({ port: 0 }));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { await close(); });

const get = path => fetch(base + path);

test('/health returns ok', async () => {
  const res = await get('/health');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
});

test('/version returns package metadata', async () => {
  const res = await get('/version');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.name, 'mcp-vs-a2a-layers-demo');
  assert.ok(body.version);
  assert.ok(body.commit);
});

test('allowlisted assets serve with security headers', async () => {
  for (const path of ['/', '/guide.html', '/styles.css', '/app.js', '/stack.mjs', '/scenario.json']) {
    const res = await get(path);
    assert.equal(res.status, 200, `${path} should serve`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(res.headers.get('content-security-policy'));
  }
});

test('traversal and unknown paths are 404', async () => {
  for (const path of ['/package.json', '/../package.json', '/test/stack.test.mjs', '/server.js', '/nope']) {
    const res = await get(path);
    assert.equal(res.status, 404, `${path} must not serve`);
  }
});

test('POST to a static path is 404', async () => {
  const res = await fetch(base + '/', { method: 'POST' });
  assert.equal(res.status, 404);
});
