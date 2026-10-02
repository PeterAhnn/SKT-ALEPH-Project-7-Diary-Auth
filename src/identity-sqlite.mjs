import { DatabaseSync } from 'node:sqlite';
import { scrypt, randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createSqliteStore } from './store-sqlite.mjs';
import { problem } from './validation.mjs';

const derive = promisify(scrypt);
export const PASSWORD_SETTINGS = Object.freeze({ N: 32768, r: 8, p: 3, maxmem: 128 * 1024 * 1024 });
export const SESSION_SECONDS = 8 * 60 * 60;
const digest = value => createHash('sha256').update(value).digest('hex');
const loginMessage = '아이디 또는 비밀번호를 확인해 주세요.';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function email(value) {
  if (typeof value !== 'string' || value.length > 254) throw problem(400, '이메일 형식의 아이디를 입력해 주세요.', 'VALIDATION');
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw problem(400, '이메일 형식의 아이디를 입력해 주세요.', 'VALIDATION');
  return normalized;
}
function password(value, newPassword = false) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 1024 || value.length < (newPassword ? 12 : 1)) {
    throw problem(400, '비밀번호는 12자 이상, UTF-8 1,024바이트 이하로 입력해 주세요.', 'VALIDATION');
  }
  return value; // Passwords are never trimmed or normalized silently.
}
export async function hashPassword(value) {
  password(value, true);
  const salt = randomBytes(16);
  const hash = await derive(value, salt, 32, PASSWORD_SETTINGS);
  return `scrypt$32768$8$3$${salt.toString('hex')}$${hash.toString('hex')}`;
}
async function verifyPassword(value, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  const valid = parts.length === 6 && parts.slice(0, 4).join('$') === 'scrypt$32768$8$3' && /^[0-9a-f]{32}$/.test(parts[4]) && /^[0-9a-f]{64}$/.test(parts[5]);
  const salt = valid ? Buffer.from(parts[4], 'hex') : Buffer.alloc(16);
  const expected = valid ? Buffer.from(parts[5], 'hex') : Buffer.alloc(32);
  const computed = await derive(value, salt, 32, PASSWORD_SETTINGS);
  return timingSafeEqual(computed, expected) && valid;
}
const publicUser = row => ({ id: row.id, email: row.email, created_at: row.created_at });

// Identity and per-account diaries live under a dedicated T07 directory.
// T06 databases and cloud credentials are never opened by this adapter.
export function createIdentityStore({ directory = '.data/t07', clock = () => new Date().toISOString(), recordOrigin = 'user', sessionSeconds = SESSION_SECONDS } = {}) {
  const root = resolve(directory);
  const accountDirectory = join(root, 'accounts');
  mkdirSync(accountDirectory, { recursive: true });
  const db = new DatabaseSync(join(root, 'identity.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_digest TEXT NOT NULL,
      created_at TEXT NOT NULL, deleted_at TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS auth_attempts (
      bucket TEXT PRIMARY KEY, window_start INTEGER NOT NULL, attempts INTEGER NOT NULL
    ) STRICT;`);
  let activeDerivations = 0;
  async function bounded(callback) {
    if (activeDerivations >= 4) throw problem(429, '요청이 많습니다. 잠시 뒤 다시 시도해 주세요.', 'RATE_LIMIT');
    activeDerivations++;
    try { return await callback(); } finally { activeDerivations--; }
  }
  function transaction(callback) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = callback(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function throttle(bucket, max, windowMs) {
    const now = new Date(clock()).getTime();
    return transaction(() => {
      db.prepare('DELETE FROM auth_attempts WHERE window_start < ?').run(now - 60 * 60 * 1000);
      const previous = db.prepare('SELECT * FROM auth_attempts WHERE bucket=?').get(bucket);
      const fresh = !previous || now - previous.window_start >= windowMs;
      const attempts = fresh ? 1 : previous.attempts + 1;
      db.prepare('INSERT INTO auth_attempts VALUES (?,?,?) ON CONFLICT(bucket) DO UPDATE SET window_start=excluded.window_start, attempts=excluded.attempts')
        .run(bucket, fresh ? now : previous.window_start, attempts);
      return attempts <= max;
    });
  }
  function diaryFilename(userId) {
    if (!uuid.test(userId)) throw problem(401, '다시 로그인해 주세요.', 'UNAUTHENTICATED');
    return join(accountDirectory, `${userId}.sqlite`);
  }
  function requireActive(userId) {
    const row = db.prepare('SELECT * FROM users WHERE id=? AND deleted_at IS NULL').get(userId);
    if (!row) throw problem(401, '다시 로그인해 주세요.', 'UNAUTHENTICATED');
    return row;
  }
  return {
    kind: 'sqlite', directory: root,
    async register(input, remoteAddress = 'unknown') {
      const address = email(input.email); const secret = password(input.password, true);
      if (!throttle(`signup:${digest(remoteAddress)}`, 10, 60 * 60 * 1000)) throw problem(429, '요청이 많습니다. 잠시 뒤 다시 시도해 주세요.', 'RATE_LIMIT');
      const stored = await bounded(() => hashPassword(secret));
      const row = { id: randomUUID(), email: address, password_digest: stored, created_at: clock() };
      try { db.prepare('INSERT INTO users(id,email,password_digest,created_at) VALUES (?,?,?,?)').run(row.id, row.email, row.password_digest, row.created_at); }
      catch (error) {
        if (/UNIQUE/.test(error.message)) throw problem(409, '가입을 완료할 수 없습니다. 기존 계정으로 로그인하거나 다른 아이디를 사용해 주세요.', 'REGISTRATION');
        throw error;
      }
      return publicUser(row);
    },
    async login(input, remoteAddress = 'unknown') {
      const address = email(input.email); const secret = password(input.password);
      const ipAllowed = throttle(`login-ip:${digest(remoteAddress)}`, 30, 5 * 60 * 1000);
      const accountAllowed = throttle(`login-account:${digest(address)}`, 10, 5 * 60 * 1000);
      if (!ipAllowed || !accountAllowed) throw problem(429, '요청이 많습니다. 잠시 뒤 다시 시도해 주세요.', 'RATE_LIMIT');
      const before = db.prepare('SELECT * FROM users WHERE email=? AND deleted_at IS NULL').get(address);
      const valid = await bounded(() => verifyPassword(secret, before?.password_digest));
      const current = db.prepare('SELECT * FROM users WHERE email=? AND deleted_at IS NULL').get(address);
      if (!valid || !current || current.password_digest !== before?.password_digest) throw problem(401, loginMessage, 'LOGIN');
      const token = randomBytes(32).toString('base64url');
      const stamp = clock();
      const expires = new Date(new Date(stamp).getTime() + sessionSeconds * 1000).toISOString();
      transaction(() => {
        db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(stamp);
        db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(digest(token), current.id, stamp, expires);
      });
      return { user: publicUser(current), token, csrf: digest(`csrf:${token}`), expires_at: expires };
    },
    authenticate(token) {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const row = db.prepare(`SELECT u.id,u.email,u.created_at,s.expires_at FROM sessions s
        JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.deleted_at IS NULL`).get(digest(token), clock());
      return row ? { user: publicUser(row), csrf: digest(`csrf:${token}`), expires_at: row.expires_at } : null;
    },
    logout(token) { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token)); },
    async changePassword(userId, input) {
      const current = requireActive(userId);
      const allowed = throttle(`reauth:${userId}`, 10, 5 * 60 * 1000);
      if (!allowed) throw problem(429, '요청이 많습니다. 잠시 뒤 다시 시도해 주세요.', 'RATE_LIMIT');
      const oldSecret = password(input.current_password); const newSecret = password(input.password, true);
      const nextDigest = await bounded(async () => {
        if (!await verifyPassword(oldSecret, current.password_digest)) throw problem(401, loginMessage, 'LOGIN');
        return hashPassword(newSecret);
      });
      transaction(() => {
        const changed = db.prepare('UPDATE users SET password_digest=? WHERE id=? AND password_digest=? AND deleted_at IS NULL').run(nextDigest, userId, current.password_digest);
        if (!changed.changes) throw problem(401, '다시 로그인해 주세요.', 'UNAUTHENTICATED');
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
      });
    },
    async deleteAccount(userId, input) {
      const current = requireActive(userId);
      if (input.confirm !== current.email) throw problem(400, '계정 아이디를 정확히 입력해 주세요.', 'VALIDATION');
      if (!throttle(`reauth:${userId}`, 10, 5 * 60 * 1000)) throw problem(429, '요청이 많습니다. 잠시 뒤 다시 시도해 주세요.', 'RATE_LIMIT');
      const valid = await bounded(() => verifyPassword(password(input.current_password), current.password_digest));
      if (!valid) throw problem(401, loginMessage, 'LOGIN');
      transaction(() => {
        const changed = db.prepare('UPDATE users SET deleted_at=? WHERE id=? AND password_digest=? AND deleted_at IS NULL').run(clock(), userId, current.password_digest);
        if (!changed.changes) throw problem(401, '다시 로그인해 주세요.', 'UNAUTHENTICATED');
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
      });
      // A cleanup failure leaves the account disabled, never readable again.
      const file = diaryFilename(userId);
      for (const suffix of ['', '-wal', '-shm']) if (existsSync(file + suffix)) unlinkSync(file + suffix);
      db.prepare('DELETE FROM users WHERE id=?').run(userId);
    },
    async withDiary(userId, callback) {
      requireActive(userId);
      const store = createSqliteStore({ filename: diaryFilename(userId), clock, recordOrigin });
      try { return await callback(store); } finally { await store.close(); }
    },
    close() { db.close(); }
  };
}
