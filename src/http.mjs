import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { seoulToday } from '../public/core.mjs';
import { problem, validate } from './validation.mjs';
import { validateLegacyExport } from './migration.mjs';

const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.mjs': ['app.mjs', 'text/javascript; charset=utf-8'], '/core.mjs': ['core.mjs', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'] };
const csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
assets['/auth.mjs'] = ['auth.mjs', 'text/javascript; charset=utf-8'];
assets['/observation-core.mjs'] = ['observation-core.mjs', 'text/javascript; charset=utf-8'];
assets['/diary'] = assets['/'];
function sessionToken(req) {
  const matches = (req.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith('pds_session='));
  return matches.length === 1 ? matches[0].slice('pds_session='.length) : null;
}
function cookie(value, secure, maxAge = 8 * 60 * 60) {
  return `pds_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
function checkCsrf(req, expected) {
  const value = req.headers['x-csrf-token'];
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value) || !timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(expected, 'hex'))) {
    throw problem(403, '앱 화면을 다시 열고 저장해 주세요.', 'CSRF');
  }
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
async function body(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw problem(415, 'JSON 형식으로 요청해 주세요.', 'UNSUPPORTED_MEDIA_TYPE');
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 65536) throw problem(413, '입력 자료가 너무 큽니다. 64KB 이하로 줄여 주세요.', 'PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw problem(400, '입력 형식을 읽을 수 없습니다.', 'VALIDATION'); }
}
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.host.toLowerCase() !== (req.headers.host || '').toLowerCase()) throw new Error();
  } catch { throw problem(403, '앱 화면을 다시 열고 저장해 주세요.', 'ORIGIN'); }
}
function route(method, path) {
  if (method === 'POST' && path === '/api/plans') return ['plan.create', {}];
  const matches = [
    ['PATCH', /^\/api\/plans\/([^/]+)$/, 'plan.update', 'id'],
    ['POST', /^\/api\/plans\/([^/]+)\/tasks$/, 'task.create', 'plan_id'],
    ['PATCH', /^\/api\/tasks\/([^/]+)$/, 'task.update', 'id'],
    ['DELETE', /^\/api\/tasks\/([^/]+)$/, 'task.delete', 'id'],
    ['POST', /^\/api\/tasks\/([^/]+)\/(complete|reopen|restore)$/, null, 'id'],
    ['POST', /^\/api\/tasks\/([^/]+)\/executions$/, 'execution.create', 'task_id'],
    ['POST', /^\/api\/plans\/([^/]+)\/reviews$/, 'review.create', 'plan_id'],
    ['POST', /^\/api\/reviews\/([^/]+)\/next-plan$/, 'review.next-plan', 'id']
  ];
  for (const [verb, pattern, action, key] of matches) {
    const match = path.match(pattern);
    if (verb === method && match) return [action || `task.${match[2]}`, { [key]: decodeURIComponent(match[1]) }];
  }
  return null;
}
export function createHandler({ identity, publicDir, secureCookies = true, clock = () => new Date().toISOString(), recordOrigin = 'user' }) {
  return async function handler(req, res) {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      const path = new URL(req.url, 'http://diary.invalid').pathname;
      if (req.method === 'GET' && path === '/api/health') return json(res, 200, { ok: true, storage: identity?.kind || 'unconfigured', authentication: true, record_origin: recordOrigin });
      if (path.startsWith('/api/') && !identity) throw problem(503, '인증 저장소 연결을 준비하고 있습니다.', 'UNAVAILABLE');
      const token = sessionToken(req);
      const session = await identity?.authenticate(token);
      if (req.method === 'GET' && path === '/api/auth/session') return json(res, 200, { ok: true, data: session || { user: null } });
      if (req.method === 'POST' && ['/api/auth/register', '/api/auth/login'].includes(path)) {
        checkOrigin(req);
        const input = await body(req);
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['email', 'password'].includes(k))) throw problem(400, '가입·로그인 입력을 확인해 주세요.', 'VALIDATION');
        // Serverless request wrappers may omit the native socket. A shared
        // fallback bucket remains conservative; untrusted IP headers are ignored.
        const remoteAddress = req.socket?.remoteAddress || 'unknown';
        if (path.endsWith('/register')) return json(res, 201, { ok: true, data: { user: await identity.register(input, remoteAddress) } });
        const loggedIn = await identity.login(input, remoteAddress);
        if (token) await identity.logout(token); // Re-login rotates an existing browser session.
        res.setHeader('Set-Cookie', cookie(loggedIn.token, secureCookies));
        return json(res, 200, { ok: true, data: { user: loggedIn.user, csrf: loggedIn.csrf, expires_at: loggedIn.expires_at } });
      }
      if (path.startsWith('/api/') && !session) throw problem(401, '로그인한 뒤 내 기록을 열어 주세요.', 'UNAUTHENTICATED');
      if (path.startsWith('/api/') && !['GET', 'HEAD'].includes(req.method)) { checkOrigin(req); checkCsrf(req, session.csrf); }
      if (req.method === 'POST' && path === '/api/auth/logout') {
        await identity.logout(token);
        res.setHeader('Set-Cookie', cookie('', secureCookies, 0));
        return json(res, 200, { ok: true, data: { logged_out: true } });
      }
      if (req.method === 'POST' && path === '/api/auth/password') {
        const input = await body(req);
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['current_password', 'password'].includes(k))) throw problem(400, '비밀번호 변경 입력을 확인해 주세요.', 'VALIDATION');
        await identity.changePassword(session.user.id, input, token);
        res.setHeader('Set-Cookie', cookie('', secureCookies, 0));
        return json(res, 200, { ok: true, data: { logged_out: true, all_sessions_revoked: true } });
      }
      if (req.method === 'DELETE' && path === '/api/auth/account') {
        const input = await body(req);
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['current_password', 'confirm'].includes(k))) throw problem(400, '계정 삭제 입력을 확인해 주세요.', 'VALIDATION');
        await identity.deleteAccount(session.user.id, input, token);
        res.setHeader('Set-Cookie', cookie('', secureCookies, 0));
        return json(res, 200, { ok: true, data: { account_deleted: true, diary_deleted: true } });
      }
      const withStore = callback => identity.withDiary(session.user.id, callback, token);
      if (req.method === 'POST' && ['/api/migration/preview','/api/migration/import'].includes(path)) {
        const input = await body(req);
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['exported','expected_digest'].includes(key))) throw problem(400, '이관 입력을 확인해 주세요.', 'VALIDATION');
        const data = path.endsWith('/preview') ? validateLegacyExport(input.exported) : await withStore(store => store.importLegacy(input.exported, input.expected_digest));
        return json(res, 200, { ok: true, data });
      }
      const studyStart = path.match(/^\/api\/plans\/([^/]+)\/observation$/);
      const studyMutation = path.match(/^\/api\/observations\/([^/]+)\/(days|rule|check)$/);
      if (req.method === 'POST' && (studyStart || studyMutation)) {
        const input = await body(req);
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.hasOwn(input, studyStart ? 'plan_id' : 'id')) throw problem(400, '관찰 입력·경로를 확인해 주세요.', 'VALIDATION');
        const data = await withStore(store => store.mutateObservation(studyStart ? 'start' : studyMutation[2] === 'days' ? 'day' : studyMutation[2], { ...input, ...(studyStart ? { plan_id: studyStart[1] } : { id: studyMutation[1] }) }));
        return json(res, 200, { ok: true, data });
      }
      if (req.method === 'GET' && path === '/api/observations') return json(res, 200, { ok: true, data: await withStore(store => store.observationState()) });
      if (['GET', 'POST'].includes(req.method) && path === '/api/state') {
        if (req.method === 'POST') {
          const input = await body(req);
          if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['user_id', 'account_id'].includes(k))) throw problem(400, '목록 입력을 확인해 주세요.', 'VALIDATION');
          // Client-supplied ownership hints are deliberately ignored. Only the session chooses the diary.
        }
        const bundle = await withStore(store => store.stateBundle());
        return json(res, 200, { ok: true, ...bundle, meta: {
          storage: identity.kind, timezone: 'Asia/Seoul', time_unit: 'minutes', today: seoulToday(new Date(clock())), authentication: true, user: session.user, record_origin: session.user.record_origin || recordOrigin } });
      }
      if (req.method === 'GET' && path === '/api/export') {
        const exportedAt = clock();
        res.setHeader('Content-Disposition', `attachment; filename="pds-diary-${seoulToday(new Date(exportedAt))}.json"`);
        return json(res, 200, { schema_version: 3, exported_at: exportedAt, timezone: 'Asia/Seoul', time_unit: 'minutes', observation_unit: '개', record_origin: session.user.record_origin || recordOrigin, ...await withStore(store => store.exportState()) });
      }
      const single = path.match(/^\/api\/(plans|tasks|executions|reviews)\/([^/]+)$/);
      if (req.method === 'GET' && single) {
        const state = await withStore(store => store.state());
        const entity = state[single[1]].find(row => row.id === single[2]);
        if (!entity) throw problem(404, '해당 기록을 찾을 수 없습니다.', 'NOT_FOUND');
        return json(res, 200, { ok: true, data: { entity } });
      }
      const operation = route(req.method, path);
      if (operation) {
        checkOrigin(req);
        const [action, reference] = operation;
        const input = req.method === 'DELETE' ? {} : await body(req);
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw problem(400, '입력 형식은 JSON 객체여야 합니다.', 'VALIDATION');
        if (Object.keys(reference).some(k => Object.hasOwn(input, k) && input[k] !== reference[k])) throw problem(400, '요청 경로와 기록 ID가 다릅니다.', 'VALIDATION');
        const data = await withStore(store => store.mutate(action, validate(action, { ...input, ...reference })));
        return json(res, 200, { ok: true, data });
      }
      if (req.method === 'GET' && path === '/diary' && !session) {
        res.writeHead(303, { Location: '/' });
        return res.end();
      }
      const asset = assets[path];
      if (asset && ['GET', 'HEAD'].includes(req.method) && publicDir) {
        const content = await readFile(join(publicDir, asset[0]));
        res.writeHead(200, { 'Content-Type': asset[1] });
        return res.end(req.method === 'HEAD' ? undefined : content);
      }
      return json(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '요청한 화면이나 기록을 찾을 수 없습니다.' } });
    } catch (error) {
      const status = [400, 401, 403, 404, 409, 413, 415, 429].includes(error.status) ? error.status : 503;
      if (status === 503) console.error('T07 storage failure', { code: /^[A-Z0-9_]{1,48}$/.test(error.code || '') ? error.code : 'UNCLASSIFIED', type: error.constructor?.name === 'TypeError' ? 'TypeError' : 'Error' });
      const message = status === 503 ? '저장소에 연결하지 못했습니다. 입력을 유지한 채 잠시 뒤 다시 시도해 주세요.' : error.message;
      const code = error.code || ({ 400: 'VALIDATION', 403: 'ORIGIN', 404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 415: 'UNSUPPORTED_MEDIA_TYPE' }[status] || 'UNAVAILABLE');
      if (!res.headersSent) json(res, status, { ok: false, error: { code, message } });
      else res.end();
    }
  };
}
