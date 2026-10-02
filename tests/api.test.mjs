import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler } from '../src/http.mjs';
import { createIdentityStore } from '../src/identity-sqlite.mjs';
import { aggregate } from '../public/core.mjs';

const clock = () => '2026-09-30T12:34:56.789Z';
const planFields = (changes = {}) => ({
  title: '합성 검사: ALEPH 공부', description: '실제 사용자 기록이 아닌 기능 검사',
  start_date: '2026-09-30', end_date: '2026-10-07', priority: 'high',
  success_criteria: '저장·이력·집계 검사', expected_minutes: 120, ...changes,
});
const taskFields = (changes = {}) => ({
  title: '합성 검사: 과제 읽기', notes: '시험 자료', due_date: '2026-09-30',
  priority: 'medium', tags: ['ALEPH', '합성 검사'], expected_minutes: 30, ...changes,
});
const executionFields = (changes = {}) => ({
  started_at: '2026-09-30T09:00:00+09:00', ended_at: '2026-09-30T09:20:00+09:00',
  actual_minutes: 20, blocked_reason: '', ...changes,
});
const stateKeys = ['plans', 'plan_history', 'tasks', 'executions', 'completion_events', 'request_receipts', 'reviews'];

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'aleph-t06-synthetic-'));
  const filename = join(directory, 'synthetic.sqlite');
  const publicDir = join(directory, 'public');
  await mkdir(publicDir);
  await writeFile(join(publicDir, 'index.html'), '<!doctype html><title>합성 검사</title><p>시험용 화면</p>');
  let server;
  let store;
  let base;
  let authCookie;
  let csrf;
  const fixturePassword = randomBytes(18).toString('base64url');
  async function stop() {
    if (server) {
      const current = server;
      server = null;
      await new Promise((resolve, reject) => {
        current.close((error) => error ? reject(error) : resolve());
        current.closeAllConnections();
      });
    }
    if (store) {
      store.close();
      store = null;
    }
  }
  async function start() {
    store = createIdentityStore({ directory: join(directory, 'identity'), clock, recordOrigin: 'synthetic' });
    if (!authCookie) {
      await store.register({ email: 'fixture@example.test', password: fixturePassword });
      const loggedIn = await store.login({ email: 'fixture@example.test', password: fixturePassword });
      authCookie = `pds_session=${loggedIn.token}`;
      csrf = loggedIn.csrf;
    }
    server = createServer(createHandler({ identity: store, publicDir, clock, recordOrigin: 'synthetic', secureCookies: false }));
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  }
  await start();
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  async function request(path, { method = 'GET', data, raw, headers = {} } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { cookie: authCookie, 'x-csrf-token': csrf, ...((data !== undefined || raw !== undefined) ? { 'content-type': 'application/json' } : {}), ...headers },
      body: raw ?? (data === undefined ? undefined : JSON.stringify(data)),
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status, response, body };
  }
  async function success(path, options) {
    const result = await request(path, options);
    assert.ok(result.status >= 200 && result.status < 300, `Unexpected ${result.status}: ${JSON.stringify(result.body)}`);
    assert.equal(result.body.ok, true);
    return result.body.data;
  }
  return {
    request, success,
    state: async () => (await request('/api/state')).body.data,
    restart: async () => { await stop(); await start(); },
  };
}
async function createPlan(f, changes) {
  return (await f.success('/api/plans', { method: 'POST', data: planFields(changes) })).entity;
}
async function createTask(f, planId, changes) {
  return (await f.success(`/api/plans/${planId}/tasks`, { method: 'POST', data: taskFields(changes) })).entity;
}

test('HTTP state and one-file export retain IDs, dates, values and units after DB restart', async (t) => {
  const f = await fixture(t);
  const plan = await createPlan(f);
  const updated = (await f.success(`/api/plans/${plan.id}`, {
    method: 'PATCH', data: { ...planFields({ title: '합성 검사: 수정된 계획', expected_minutes: 140 }), expected_version: plan.version },
  })).entity;
  const task = await createTask(f, plan.id, { expected_minutes: 37, due_date: '2026-10-01', tags: ['공부', '검사'] });
  const execution = (await f.success(`/api/tasks/${task.id}/executions`, { method: 'POST', data: executionFields({ actual_minutes: 23, blocked_reason: '합성 환경 확인' }) })).entity;
  await f.success(`/api/tasks/${task.id}/complete`, { method: 'POST', data: { request_id: randomUUID() } });
  await f.success(`/api/plans/${plan.id}/reviews`, { method: 'POST', data: { improvement: '합성 개선: 확인 순서를 적는다' } });
  const beforeResponse = await f.request('/api/state');
  const before = beforeResponse.body.data;
  assert.equal(beforeResponse.body.meta.timezone, 'Asia/Seoul');
  assert.equal(beforeResponse.body.meta.time_unit, 'minutes');
  assert.equal(beforeResponse.body.meta.today, '2026-09-30');
  assert.equal(beforeResponse.body.meta.authentication, true);
  assert.equal(beforeResponse.body.meta.record_origin, 'synthetic');
  assert.equal(updated.id, plan.id);
  assert.equal(updated.version, 2);
  assert.deepEqual(before.plan_history.filter((h) => h.plan_id === plan.id).sort((a, b) => a.version - b.version).map((h) => h.snapshot.title), ['합성 검사: ALEPH 공부', '합성 검사: 수정된 계획']);
  assert.equal(execution.started_at, '2026-09-30T00:00:00.000Z');
  assert.equal(execution.ended_at, '2026-09-30T00:20:00.000Z');
  assert.equal(before.tasks[0].expected_minutes, 37);
  assert.equal(before.tasks[0].due_date, '2026-10-01');
  assert.deepEqual(before.tasks[0].tags, ['공부', '검사']);
  for (const key of ['plans', 'tasks', 'executions', 'reviews']) {
    assert.ok(before[key].every((row) => row.record_origin === 'synthetic'), key);
  }
  await f.restart();
  const after = (await f.request('/api/state')).body;
  assert.deepEqual(after.data, before, 'all seven tables survive an actual connection and HTTP server restart');
  assert.equal(after.meta.time_unit, 'minutes');
  const exported = await f.request('/api/export');
  assert.equal(exported.status, 200);
  assert.match(exported.response.headers.get('content-type'), /application\/json/);
  assert.match(exported.response.headers.get('content-disposition'), /attachment;.*\.json/i);
  assert.equal(exported.body.schema_version, 2);
  assert.equal(exported.body.time_unit, 'minutes');
  assert.equal(exported.body.timezone, 'Asia/Seoul');
  assert.equal(exported.body.record_origin, 'synthetic');
  assert.equal(exported.body.exported_at, clock());
  for (const key of stateKeys) assert.deepEqual(exported.body[key], before[key], `export ${key}`);
});

test('invalid HTTP inputs reject before mutation and return safe structured errors', async (t) => {
  const f = await fixture(t);
  const plan = await createPlan(f);
  const task = await createTask(f, plan.id);
  const before = await f.state();
  const cases = [
    ['/api/plans', { method: 'POST', data: planFields({ title: '   ' }) }],
    ['/api/plans', { method: 'POST', data: planFields({ start_date: '2026-02-30' }) }],
    ['/api/plans', { method: 'POST', data: planFields({ end_date: '2026-09-29' }) }],
    ['/api/plans', { method: 'POST', data: planFields({ expected_minutes: -1 }) }],
    ['/api/plans', { method: 'POST', data: planFields({ expected_minutes: 1.5 }) }],
    ['/api/plans', { method: 'POST', data: planFields({ unexpected_field: 'must reject' }) }],
    [`/api/plans/${plan.id}/tasks`, { method: 'POST', data: taskFields({ due_date: '2026-13-01' }) }],
    [`/api/plans/${plan.id}/tasks`, { method: 'POST', data: taskFields({ priority: 'urgent' }) }],
    [`/api/tasks/${task.id}/executions`, { method: 'POST', data: executionFields({ ended_at: '2026-09-30T08:59:00+09:00' }) }],
    [`/api/tasks/${task.id}/executions`, { method: 'POST', data: executionFields({ actual_minutes: -1 }) }],
    [`/api/tasks/${task.id}/executions`, { method: 'POST', data: executionFields({ started_at: '2026-09-29T24:00:00Z', ended_at: '2026-09-30T00:20:00Z' }) }],
    [`/api/tasks/${task.id}/complete`, { method: 'POST', data: {} }],
    ['/api/plans', { method: 'POST', raw: '{"title":' }],
  ];
  for (const [path, options] of cases) {
    const rejected = await f.request(path, options);
    assert.equal(rejected.status, 400, `${path}: ${JSON.stringify(options.data ?? options.raw)}`);
    assert.equal(rejected.body.ok, false);
    assert.equal(typeof rejected.body.error.code, 'string');
    assert.equal(typeof rejected.body.error.message, 'string');
    assert.doesNotMatch(JSON.stringify(rejected.body), /SQLITE_|node:sqlite|C:\\Users|SUPABASE_(?:URL|KEY)|stack trace/i);
    assert.deepEqual(await f.state(), before, `invalid request mutated state: ${path}`);
  }
  const wrongType = await f.request('/api/plans', { method: 'POST', raw: '{}', headers: { 'content-type': 'text/plain' } });
  assert.ok([400, 415].includes(wrongType.status));
  assert.deepEqual(await f.state(), before);
});

test('stale plan and task edits conflict without overwriting saved values', async (t) => {
  const f = await fixture(t);
  const plan = await createPlan(f);
  const task = await createTask(f, plan.id);
  await f.success(`/api/plans/${plan.id}`, { method: 'PATCH', data: { ...planFields({ title: '먼저 저장한 계획' }), expected_version: 1 } });
  await f.success(`/api/tasks/${task.id}`, { method: 'PATCH', data: { ...taskFields({ title: '먼저 저장한 할 일' }), expected_version: 1 } });
  const saved = await f.state();
  for (const [path, data] of [
    [`/api/plans/${plan.id}`, { ...planFields({ title: '뒤늦은 계획' }), expected_version: 1 }],
    [`/api/tasks/${task.id}`, { ...taskFields({ title: '뒤늦은 할 일' }), expected_version: 1 }],
  ]) {
    const conflict = await f.request(path, { method: 'PATCH', data });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.ok, false);
    assert.deepEqual(await f.state(), saved);
  }
  const missing = await f.request(`/api/plans/${randomUUID()}`, { method: 'PATCH', data: { ...planFields(), expected_version: 1 } });
  assert.equal(missing.status, 404);
  assert.deepEqual(await f.state(), saved);
});

test('repeated concurrent completions produce one event and one current completion', async (t) => {
  const f = await fixture(t);
  const plan = await createPlan(f);
  const task = await createTask(f, plan.id);
  const other = await createTask(f, plan.id, { title: '두 번째 합성 할 일' });
  const requestId = randomUUID();
  const before = aggregate(await f.state(), plan.id, '2026-09-30').completed;
  await Promise.all([
    f.success(`/api/tasks/${task.id}/complete`, { method: 'POST', data: { request_id: requestId } }),
    f.success(`/api/tasks/${task.id}/complete`, { method: 'POST', data: { request_id: requestId } }),
    f.success(`/api/tasks/${task.id}/complete`, { method: 'POST', data: { request_id: randomUUID() } }),
  ]);
  let state = await f.state();
  assert.equal(state.completion_events.filter((e) => e.task_id === task.id).length, 1);
  assert.equal(aggregate(state, plan.id, '2026-09-30').completed - before, 1);
  const reused = await f.request(`/api/tasks/${other.id}/complete`, { method: 'POST', data: { request_id: requestId } });
  assert.equal(reused.status, 409, 'same request key cannot complete a different task');
  assert.equal((await f.state()).tasks.find((row) => row.id === other.id).status, 'pending');
  const reopenId = randomUUID();
  await f.success(`/api/tasks/${task.id}/reopen`, { method: 'POST', data: { request_id: reopenId } });
  await f.success(`/api/tasks/${task.id}/reopen`, { method: 'POST', data: { request_id: reopenId } });
  // A delayed retry of the old completion may replay its response, but never its mutation.
  await f.success(`/api/tasks/${task.id}/complete`, { method: 'POST', data: { request_id: requestId } });
  state = await f.state();
  assert.equal(state.tasks.find((row) => row.id === task.id).status, 'pending');
  assert.equal(state.tasks.find((row) => row.id === task.id).completion_cycle, 1);
  assert.equal(state.completion_events.filter((e) => e.task_id === task.id).length, 1);
  assert.equal(aggregate(state, plan.id, '2026-09-30').completed, 0);
  await f.success(`/api/tasks/${task.id}/complete`, { method: 'POST', data: { request_id: randomUUID() } });
  state = await f.state();
  assert.equal(state.completion_events.filter((e) => e.task_id === task.id).length, 2);
  assert.equal(aggregate(state, plan.id, '2026-09-30').completed, 1);
});

test('Do preserves original Plan and estimate, and a review carries to exactly one next Plan', async (t) => {
  const f = await fixture(t);
  const plan = await createPlan(f);
  const task = await createTask(f, plan.id);
  const before = await f.state();
  await f.success(`/api/tasks/${task.id}/executions`, { method: 'POST', data: executionFields({ actual_minutes: 55, blocked_reason: '합성 막힘 이유' }) });
  let state = await f.state();
  assert.deepEqual(state.plans, before.plans);
  assert.deepEqual(state.plan_history, before.plan_history);
  assert.deepEqual(state.tasks, before.tasks, 'adding execution cannot silently complete task or replace estimate');
  const review = (await f.success(`/api/plans/${plan.id}/reviews`, { method: 'POST', data: { improvement: '합성 개선: 먼저 DB 연결을 확인한다' } })).entity;
  const payload = planFields({ title: '합성 다음 계획', start_date: '2026-10-08', end_date: '2026-10-15' });
  const first = await f.success(`/api/reviews/${review.id}/next-plan`, { method: 'POST', data: payload });
  const repeated = await f.success(`/api/reviews/${review.id}/next-plan`, { method: 'POST', data: payload });
  assert.equal(first.entity.id, repeated.entity.id);
  assert.equal(first.entity.source_review_id, review.id);
  assert.equal(first.entity.carried_improvement, review.improvement);
  state = await f.state();
  assert.equal(state.plans.length, 2);
  assert.equal(state.reviews.find((row) => row.id === review.id).next_plan_id, first.entity.id);
  assert.equal(state.plan_history.filter((row) => row.plan_id === first.entity.id).length, 1);
});

test('soft delete hides a task from See, retains its evidence, and can be restored', async (t) => {
  const f = await fixture(t);
  const plan = await createPlan(f);
  const task = await createTask(f, plan.id);
  const execution = (await f.success(`/api/tasks/${task.id}/executions`, { method: 'POST', data: executionFields() })).entity;
  await f.success(`/api/tasks/${task.id}/complete`, { method: 'POST', data: { request_id: randomUUID() } });
  await f.success(`/api/tasks/${task.id}`, { method: 'DELETE' });
  let state = await f.state();
  assert.ok(state.tasks.find((row) => row.id === task.id).deleted_at);
  assert.equal(state.executions.find((row) => row.id === execution.id).task_id, task.id);
  assert.equal(state.completion_events.length, 1);
  assert.equal(aggregate(state, plan.id, '2026-09-30').planned, 0);
  assert.equal(aggregate(state, plan.id, '2026-09-30').actual_minutes, 0);
  const deletedExecution = await f.request(`/api/tasks/${task.id}/executions`, { method: 'POST', data: executionFields() });
  assert.equal(deletedExecution.status, 404);
  await f.success(`/api/tasks/${task.id}/restore`, { method: 'POST', data: {} });
  state = await f.state();
  assert.equal(state.tasks.find((row) => row.id === task.id).deleted_at, null);
  assert.equal(aggregate(state, plan.id, '2026-09-30').planned, 1);
  assert.equal(aggregate(state, plan.id, '2026-09-30').completed, 1);
  assert.equal(aggregate(state, plan.id, '2026-09-30').actual_minutes, 20);
});

test('script-shaped text is literal JSON, CSP is present, and cross-origin writes are rejected', async (t) => {
  const f = await fixture(t);
  const script = '<script>globalThis.__t06Injected = true</script><img src=x onerror="alert(1)">';
  const plan = await createPlan(f, { title: script });
  const task = await createTask(f, plan.id, { notes: script });
  const response = await f.request('/api/state');
  assert.equal(response.body.data.plans.find((row) => row.id === plan.id).title, script);
  assert.equal(response.body.data.tasks.find((row) => row.id === task.id).notes, script);
  assert.match(response.response.headers.get('content-type'), /application\/json/);
  assert.match(response.response.headers.get('x-content-type-options'), /nosniff/);
  const page = await f.request('/');
  assert.equal(page.status, 200);
  const csp = page.response.headers.get('content-security-policy');
  assert.match(csp, /script-src\s+'self'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  const before = await f.state();
  const denied = await f.request('/api/plans', { method: 'POST', data: planFields(), headers: { origin: 'https://untrusted.example' } });
  assert.equal(denied.status, 403);
  assert.deepEqual(await f.state(), before);
  const unknown = await f.request('/api/unregistered');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.ok, false);
  const traversal = await f.request('/%2e%2e%2fpackage.json');
  assert.ok([400, 403, 404].includes(traversal.status), 'static handler cannot expose workspace files');
});
