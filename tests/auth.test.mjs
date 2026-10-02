import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createIdentityStore, SESSION_SECONDS } from '../src/identity-sqlite.mjs';
import { createHandler } from '../src/http.mjs';

const evidence = [];
const secrets = [];
function secret() { const value = randomBytes(20).toString('base64url'); secrets.push(value); return value; }
function redact(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /^(?:password|current_password|token|csrf|cookie|x-csrf-token|set-cookie)$/i.test(key) ? '[REDACTED]' : redact(item)]));
}
function record(name, requests, extra = {}) {
  evidence.push({ name, requests: requests.map(({ path, method, headers, input, status, body }) => ({ path, method, headers: redact(headers), input: redact(input), status, response: redact(body) })), ...extra });
}
after(async () => {
  const report = { checked_at: new Date().toISOString(), data_origin: 'synthetic', scope: 'Local Node HTTP + isolated SQLite, not live cloud, not actual five-day use', password_method: 'Node 24 node:crypto scrypt N=32768 r=8 p=3, 16-byte random salt', session_seconds: SESSION_SECONDS, checks: evidence };
  const serialized = JSON.stringify(report, null, 2);
  for (const value of secrets) assert.ok(!serialized.includes(value), 'evidence contains a password or authentication secret');
  await mkdir('verification', { recursive: true });
  await writeFile('verification/auth-local.json', serialized + '\n');
});

const planInput = { title: '합성 계획', description: '인증 기능 시험 자료', start_date: '2026-10-02', end_date: '2026-10-06', priority: 'medium', success_criteria: '양방향 차단 시험', expected_minutes: 20 };
const taskInput = { title: '합성 할 일', notes: '실사용 기록 아님', due_date: '2026-10-02', priority: 'medium', tags: ['synthetic'], expected_minutes: 5 };
async function fixture(t, { secureCookies = true, sessionSeconds = SESSION_SECONDS } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'aleph-t07-synthetic-'));
  let stamp = '2026-10-02T00:00:00.000Z';
  const identity = createIdentityStore({ directory, clock: () => stamp, recordOrigin: 'synthetic', sessionSeconds });
  const server = createServer(createHandler({ identity, secureCookies, clock: () => stamp, recordOrigin: 'synthetic', publicDir: join(process.cwd(), 'public') }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); identity.close();
    await rm(directory, { recursive: true, force: true });
  });
  async function request(path, { method = 'GET', input, auth, headers = {} } = {}) {
    const sentHeaders = { ...(auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf } : {}), ...(input ? { 'Content-Type': 'application/json' } : {}), ...headers };
    const response = await fetch(base + path, { method, headers: sentHeaders, body: input ? JSON.stringify(input) : undefined, redirect: 'manual' });
    const text = await response.text(); let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { path, method, headers: sentHeaders, input, status: response.status, body, response };
  }
  async function account(email, password = secret()) {
    const created = await request('/api/auth/register', { method: 'POST', input: { email, password } });
    assert.equal(created.status, 201);
    const loggedIn = await request('/api/auth/login', { method: 'POST', input: { email, password } });
    assert.equal(loggedIn.status, 200);
    const cookie = loggedIn.response.headers.get('set-cookie').split(';')[0];
    const token = cookie.slice('pds_session='.length); secrets.push(token, loggedIn.body.data.csrf);
    return { user: created.body.data.user, password, cookie, csrf: loggedIn.body.data.csrf, created, loggedIn };
  }
  return { directory, identity, request, account, advance: milliseconds => { stamp = new Date(new Date(stamp).getTime() + milliseconds).toISOString(); } };
}

test('signup, salted password storage, duplicate signup, identical wrong-login errors and cookie protection', async t => {
  const f = await fixture(t);
  const shared = secret();
  const a = await f.account('alpha@example.test', shared);
  const b = await f.account('beta@example.test', shared);
  const db = new DatabaseSync(join(f.directory, 'identity.sqlite'));
  const rows = db.prepare('SELECT id,password_digest FROM users ORDER BY id').all();
  assert.equal(rows.length, 2); assert.notEqual(rows[0].password_digest, rows[1].password_digest);
  for (const row of rows) { assert.match(row.password_digest, /^scrypt\$32768\$8\$3\$[0-9a-f]{32}\$[0-9a-f]{64}$/); assert.ok(!row.password_digest.includes(shared)); }
  const sessions = db.prepare('SELECT token_hash FROM sessions').all();
  for (const row of sessions) { assert.match(row.token_hash, /^[0-9a-f]{64}$/); assert.ok(!row.token_hash.includes(a.cookie.slice(12))); }
  db.close();
  assert.match(a.loggedIn.response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Max-Age=28800; Secure/);
  assert.ok(!JSON.stringify(a.loggedIn.body).includes(shared));
  const duplicate = await f.request('/api/auth/register', { method: 'POST', input: { email: 'ALPHA@example.test', password: shared } });
  assert.equal(duplicate.status, 409);
  const wrong = secret();
  const wrongPassword = await f.request('/api/auth/login', { method: 'POST', input: { email: 'alpha@example.test', password: wrong } });
  const nonexistent = await f.request('/api/auth/login', { method: 'POST', input: { email: 'absent@example.test', password: wrong } });
  assert.equal(wrongPassword.status, 401); assert.equal(nonexistent.status, 401); assert.deepEqual(wrongPassword.body, nonexistent.body);
  record('registration-and-password-storage', [a.created, a.loggedIn, b.created, duplicate, wrongPassword, nonexistent], { stored_test_password_hashes: rows.map(row => row.password_digest), different_hashes_for_same_password: true, session_tokens_stored_as_hashes: true, source: ['src/identity-sqlite.mjs:hashPassword', 'src/http.mjs:cookie'] });
});

test('anonymous direct requests are denied, login screen stays public, CSRF and forged origins cannot write', async t => {
  const f = await fixture(t);
  const a = await f.account('alpha@example.test');
  const page = await f.request('/'); assert.equal(page.status, 200); assert.match(page.body, /id="auth-panel"/);
  const redirected = await f.request('/diary'); assert.equal(redirected.status, 303); assert.equal(redirected.response.headers.get('location'), '/');
  const allowed = await f.request('/api/state', { auth: a }); assert.equal(allowed.status, 200);
  const rejected = [];
  for (const [path, method] of [['/api/state', 'GET'], ['/api/export', 'GET'], ['/api/plans', 'POST']]) {
    const response = await f.request(path, { method, ...(method === 'POST' ? { input: planInput } : {}) });
    assert.equal(response.status, 401); assert.equal(Object.hasOwn(response.body, 'data'), false); rejected.push(response);
  }
  const missingCsrf = await f.request('/api/plans', { method: 'POST', input: planInput, auth: a, headers: { 'X-CSRF-Token': '' } });
  const foreignOrigin = await f.request('/api/plans', { method: 'POST', input: planInput, auth: a, headers: { Origin: 'https://untrusted.example' } });
  assert.equal(missingCsrf.status, 403); assert.equal(foreignOrigin.status, 403);
  assert.deepEqual((await f.request('/api/state', { auth: a })).body.data, allowed.body.data);
  const allowedWrite = await f.request('/api/plans', { method: 'POST', input: planInput, auth: a }); assert.equal(allowedWrite.status, 200);
  record('anonymous-access-and-csrf', [allowed, ...rejected, missingCsrf, foreignOrigin, allowedWrite], { login_screen_public: true, anonymous_diary_redirects_to_login: true, denied_writes_preserve_state_before_positive_write_control: true, source: ['src/http.mjs:authentication gate', 'src/http.mjs:checkCsrf', 'src/http.mjs:checkOrigin'] });
});

test('same URL, method and old cookie succeeds before logout and is denied immediately afterwards', async t => {
  const f = await fixture(t); const a = await f.account('alpha@example.test');
  const before = await f.request('/api/state', { auth: a });
  const logout = await f.request('/api/auth/logout', { method: 'POST', auth: a });
  const afterLogout = await f.request('/api/state', { auth: a });
  assert.equal(before.status, 200); assert.equal(logout.status, 200); assert.equal(afterLogout.status, 401);
  assert.equal(before.path, afterLogout.path); assert.equal(before.method, afterLogout.method); assert.deepEqual(before.headers, afterLogout.headers);
  record('same-value-after-logout', [before, logout, afterLogout], { same_url_method_and_credential: true, old_value_rejected: true, source: ['src/identity-sqlite.mjs:authenticate', 'src/identity-sqlite.mjs:logout'] });
});

test('password change invalidates every existing session and the previous password', async t => {
  const f = await fixture(t); const a = await f.account('alpha@example.test');
  const extraLogin = await f.request('/api/auth/login', { method: 'POST', input: { email: a.user.email, password: a.password } });
  const otherSession = { cookie: extraLogin.response.headers.get('set-cookie').split(';')[0], csrf: extraLogin.body.data.csrf };
  secrets.push(otherSession.cookie.slice(12), otherSession.csrf);
  const before = await f.request('/api/state', { auth: a });
  const nextSecret = secret();
  const changed = await f.request('/api/auth/password', { method: 'POST', auth: a, input: { current_password: a.password, password: nextSecret } });
  assert.equal(changed.status, 200);
  const oldSession = await f.request('/api/state', { auth: a });
  const secondOldSession = await f.request('/api/state', { auth: otherSession });
  assert.equal(oldSession.status, 401); assert.equal(secondOldSession.status, 401);
  const oldLogin = await f.request('/api/auth/login', { method: 'POST', input: { email: a.user.email, password: a.password } });
  const newLogin = await f.request('/api/auth/login', { method: 'POST', input: { email: a.user.email, password: nextSecret } });
  assert.equal(oldLogin.status, 401); assert.equal(newLogin.status, 200);
  record('password-change-revokes-all-sessions', [before, changed, oldSession, secondOldSession, oldLogin, newLogin], { source: ['src/identity-sqlite.mjs:changePassword'] });
});

test('expiry is enforced by the server at the configured boundary', async t => {
  const f = await fixture(t, { sessionSeconds: 60 }); const a = await f.account('alpha@example.test');
  f.advance(59000); const before = await f.request('/api/state', { auth: a });
  f.advance(1000); const expired = await f.request('/api/state', { auth: a });
  assert.equal(before.status, 200); assert.equal(expired.status, 401);
  record('expiry-boundary', [before, expired], { test_clock: true, configured_test_seconds: 60, production_seconds: SESSION_SECONDS });
});

test('both directions deny foreign reads, edits, deletes and related mutations without changing either diary', async t => {
  const f = await fixture(t); const a = await f.account('alpha@example.test'); const b = await f.account('beta@example.test');
  for (const account of [a, b]) {
    const plan = await f.request('/api/plans', { method: 'POST', input: planInput, auth: account }); assert.equal(plan.status, 200); account.plan = plan.body.data.entity;
    const task = await f.request(`/api/plans/${account.plan.id}/tasks`, { method: 'POST', input: taskInput, auth: account }); assert.equal(task.status, 200); account.task = task.body.data.entity;
  }
  const beforeA = (await f.request('/api/state', { auth: a })).body.data;
  const beforeB = (await f.request('/api/state', { auth: b })).body.data;
  const pairs = [];
  for (const [attacker, target] of [[a, b], [b, a]]) {
    for (const [path, method, input] of [
      [`/api/tasks/${target.task.id}`, 'GET', undefined],
      [`/api/tasks/${target.task.id}`, 'PATCH', { ...taskInput, expected_version: 1 }],
      [`/api/tasks/${target.task.id}`, 'DELETE', undefined],
      [`/api/tasks/${target.task.id}/complete`, 'POST', { request_id: randomUUID() }],
      [`/api/tasks/${target.task.id}/restore`, 'POST', {}],
      [`/api/tasks/${target.task.id}/executions`, 'POST', { started_at: '2026-10-02T00:00:00Z', ended_at: '2026-10-02T00:01:00Z', actual_minutes: 1 }],
      [`/api/plans/${target.plan.id}/tasks`, 'POST', taskInput],
      [`/api/plans/${target.plan.id}/reviews`, 'POST', { improvement: '합성 위조 시도' }]
    ]) {
      // GET success gives a stable positive control without altering the other account's state.
      const allowed = await f.request(`/api/tasks/${attacker.task.id}`, { auth: attacker });
      const denied = await f.request(path, { method, input, auth: attacker });
      assert.equal(allowed.status, 200); assert.equal(denied.status, 404);
      pairs.push({ allowed, denied });
    }
  }
  const afterA = (await f.request('/api/state', { auth: a })).body.data;
  const afterB = (await f.request('/api/state', { auth: b })).body.data;
  assert.deepEqual(afterA, beforeA); assert.deepEqual(afterB, beforeB);
  // Separate own-record controls show the same PATCH/DELETE methods are supported.
  // They run after both unchanged snapshots, so the denial comparison stays exact.
  const controls = [];
  for (const owner of [a, b]) {
    const created = await f.request(`/api/plans/${owner.plan.id}/tasks`, { method: 'POST', input: taskInput, auth: owner });
    assert.equal(created.status, 200);
    const path = `/api/tasks/${created.body.data.entity.id}`;
    const updated = await f.request(path, { method: 'PATCH', input: { ...taskInput, title: '내 기록 수정 성공 대조', expected_version: 1 }, auth: owner });
    const removed = await f.request(path, { method: 'DELETE', auth: owner });
    assert.equal(updated.status, 200); assert.equal(removed.status, 200); controls.push(updated, removed);
  }
  record('bidirectional-ownership', [...pairs.flatMap(pair => [pair.allowed, pair.denied]), ...controls], { directions: ['A-to-B', 'B-to-A'], required_read_update_delete_denials: 6, tested_related_denials: 10, both_diaries_unchanged_during_denial_tests: true, own_patch_and_delete_controls_run_after_comparison: true, before_counts: [beforeA.tasks.length, beforeB.tasks.length], after_counts: [afterA.tasks.length, afterB.tasks.length], source: ['src/http.mjs:withStore', 'src/identity-sqlite.mjs:withDiary', 'src/store-sqlite.mjs:requireRow'] });
});

test('query, header and body account spoofing cannot select another diary, and export contains only the caller', async t => {
  const f = await fixture(t); const a = await f.account('alpha@example.test'); const b = await f.account('beta@example.test');
  for (const account of [a, b]) { const result = await f.request('/api/plans', { method: 'POST', input: { ...planInput, title: account.user.email }, auth: account }); assert.equal(result.status, 200); }
  const own = await f.request('/api/state', { auth: a });
  const query = await f.request(`/api/state?user_id=${b.user.id}`, { auth: a });
  const header = await f.request('/api/state', { auth: a, headers: { 'X-User-ID': b.user.id } });
  const body = await f.request('/api/state', { method: 'POST', auth: a, input: { user_id: b.user.id } });
  const exported = await f.request('/api/export', { auth: a });
  for (const result of [query, header, body]) { assert.equal(result.status, 200); assert.deepEqual(result.body.data, own.body.data); }
  assert.equal(exported.status, 200); assert.match(exported.response.headers.get('content-disposition'), /attachment/);
  assert.deepEqual(exported.body.plans, own.body.data.plans); assert.ok(!JSON.stringify(exported.body).includes(b.user.email));
  record('account-hints-list-and-export', [own, query, header, body, exported], { own_records_only: true, source: ['src/http.mjs:state and export', 'src/identity-sqlite.mjs:withDiary'] });
});

test('account deletion requires current password and exact account confirmation, removes own data and preserves the other account', async t => {
  const f = await fixture(t); const a = await f.account('alpha@example.test'); const b = await f.account('beta@example.test');
  const plan = await f.request('/api/plans', { method: 'POST', input: planInput, auth: a }); assert.equal(plan.status, 200);
  const ownFile = join(f.directory, 'accounts', `${a.user.id}.sqlite`); assert.equal(existsSync(ownFile), true);
  const beforeB = (await f.request('/api/state', { auth: b })).body.data;
  const wrong = await f.request('/api/auth/account', { method: 'DELETE', auth: a, input: { current_password: a.password, confirm: b.user.email } }); assert.equal(wrong.status, 400);
  const deleted = await f.request('/api/auth/account', { method: 'DELETE', auth: a, input: { current_password: a.password, confirm: a.user.email } }); assert.equal(deleted.status, 200);
  const oldSession = await f.request('/api/state', { auth: a }); assert.equal(oldSession.status, 401);
  const oldLogin = await f.request('/api/auth/login', { method: 'POST', input: { email: a.user.email, password: a.password } }); assert.equal(oldLogin.status, 401);
  assert.deepEqual((await f.request('/api/state', { auth: b })).body.data, beforeB);
  for (const suffix of ['', '-wal', '-shm']) assert.equal(existsSync(ownFile + suffix), false);
  const db = new DatabaseSync(join(f.directory, 'identity.sqlite')); assert.equal(db.prepare('SELECT count(*) AS n FROM users WHERE id=?').get(a.user.id).n, 0); db.close();
  record('disposable-account-deletion', [plan, wrong, deleted, oldSession, oldLogin], { data_origin: 'synthetic disposable fixture', own_database_and_sidecar_files_removed: true, other_account_unchanged: true });
});

test('persistent account login throttling denies the eleventh attempt and allows a later window', async t => {
  const f = await fixture(t); const a = await f.account('alpha@example.test');
  const wrong = secret(); let allowedFailure;
  for (let n = 0; n < 9; n++) {
    allowedFailure = await f.request('/api/auth/login', { method: 'POST', input: { email: a.user.email, password: wrong } });
    assert.equal(allowedFailure.status, 401);
  }
  const blocked = await f.request('/api/auth/login', { method: 'POST', input: { email: a.user.email, password: a.password } });
  assert.equal(blocked.status, 429);
  f.advance(5 * 60 * 1000);
  const recovered = await f.request('/api/auth/login', { method: 'POST', input: { email: a.user.email, password: a.password } });
  assert.equal(recovered.status, 200);
  record('login-rate-limit-window', [allowedFailure, blocked, recovered], { limit: '10 attempts per account per 5 minutes', clock: 'synthetic window advance' });
});
