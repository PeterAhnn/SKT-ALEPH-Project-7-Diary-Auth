import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import api, { config } from '../api/index.mjs';

test('serverless fails closed even with legacy public T06 credentials', async t => {
  assert.equal(config.helpers, false);
  const originalFetch = globalThis.fetch;
  const before = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_synthetic_test';
  let cloudCalls = 0;
  globalThis.fetch = async () => { cloudCalls++; throw new Error('legacy adapter must never be reached'); };
  const server = createServer(api);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    globalThis.fetch = originalFetch;
    for (const [name, value] of [['SUPABASE_URL', before.url], ['SUPABASE_PUBLISHABLE_KEY', before.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  for (const [path, method] of [['state', 'GET'], ['export', 'GET'], ['plans', 'POST'], ['auth/login', 'POST']]) {
    const response = await originalFetch(`http://127.0.0.1:${server.address().port}/api/index?route=${path}`, { method });
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'UNAVAILABLE');
    assert.equal(Object.hasOwn(result, 'data'), false);
  }
  assert.equal(cloudCalls, 0);
});
