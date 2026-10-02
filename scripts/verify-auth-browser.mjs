// Run only against the isolated synthetic server documented in HANDOFF.md.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const base = 'http://127.0.0.1:8010';
const bun = process.env.T07_BROWSE_BUN;
const cli = process.env.T07_BROWSE_CLI;
assert.ok(bun && cli, 'Set T07_BROWSE_BUN and T07_BROWSE_CLI to the installed gstack browse runtime.');
const health = await fetch(base + '/api/health').then(r => r.json());
assert.equal(health.authentication, true);
const email = `browser-${randomBytes(5).toString('hex')}@example.test`;
const password = randomBytes(24).toString('base64url');
const checks = [];
await mkdir('verification', { recursive: true });
function browse(...args) {
  const result = spawnSync(bun, ['run', cli, ...args], { encoding: 'utf8', timeout: 30000 });
  // Never emit invocation arguments, form values or browser logs on failure.
  assert.equal(result.status, 0, `gstack command ${args[0]} failed; inspect local ignored browser logs.`);
  return result.stdout;
}
function observed(expression) { return browse('js', expression).includes('true'); }
async function until(expression) {
  for (let attempt = 0; attempt < 25; attempt++) {
    if (observed(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail('Expected browser state was not reached.');
}
function checkpoint(name) { checks.push({ name, passed: true }); }
const paths = ['verification/login-desktop.png', 'verification/login-mobile.png', 'verification/authenticated-synthetic.png'];
browse('viewport', '1280x900');
browse('goto', base);
await until("!document.getElementById('auth-panel').hidden && document.getElementById('diary-shell').hidden");
browse('screenshot', resolve(paths[0])); checkpoint('anonymous login screen, private diary hidden');
browse('viewport', '375x812');
assert.ok(observed('document.documentElement.scrollWidth <= innerWidth'));
browse('screenshot', resolve(paths[1])); checkpoint('mobile login has no horizontal overflow at 375px');
browse('viewport', '1280x900');
browse('click', '#auth-register-tab');
browse('fill', '#auth-email', email); browse('fill', '#auth-password', password); browse('click', '#auth-submit');
await until("document.getElementById('auth-message').textContent.includes('가입했습니다')");
checkpoint('synthetic account registered through the form');
browse('fill', '#auth-password', password); browse('click', '#auth-submit');
await until("!document.getElementById('diary-shell').hidden && document.getElementById('save-status').textContent.includes('서버')");
await until("!document.getElementById('synthetic-banner').hidden"); checkpoint('login opens only the synthetic account diary');
browse('click', '#new-plan-button');
browse('fill', '[name="title"]', '브라우저 합성 인증 검사');
browse('fill', '[name="expected_minutes"]', '10');
browse('fill', '[name="success_criteria"]', '실사용 기록과 분리한 로그인 뒤 저장 검사');
browse('click', '#editor-dialog button[type="submit"]');
await until("document.getElementById('workspace-title').textContent === '브라우저 합성 인증 검사'");
checkpoint('authenticated UI creates a plan with CSRF-protected storage');
browse('goto', base);
await until("document.getElementById('workspace-title').textContent === '브라우저 합성 인증 검사'");
checkpoint('browser reload preserves both session and own saved plan');
browse('screenshot', resolve(paths[2]));
browse('viewport', '375x812');
assert.ok(observed('document.documentElement.scrollWidth <= innerWidth'));
checkpoint('authenticated diary has no horizontal overflow at 375px');
browse('click', '#logout-button');
await until("!document.getElementById('auth-panel').hidden && document.getElementById('diary-shell').hidden");
checkpoint('logout returns to public login screen');
browse('goto', base + '/diary');
await until("location.pathname === '/' && document.getElementById('diary-shell').hidden");
checkpoint('direct private page after logout redirects to login');
browse('fill', '#auth-email', email); browse('fill', '#auth-password', 'synthetic-wrong-password'); browse('click', '#auth-submit');
await until("document.getElementById('auth-message').textContent === '아이디 또는 비밀번호를 확인해 주세요.'");
assert.ok(observed("document.getElementById('auth-password').value === ''"));
checkpoint('wrong login gives generic error and clears password field');
browse('viewport', '1280x900'); browse('goto', base);
const report = { checked_at: new Date().toISOString(), data_origin: 'synthetic', scope: 'Isolated gstack Chromium + local synthetic server; not live deployment or actual five-day use', checks, screenshots: paths, credentials: '[REDACTED; disposable test account only]' };
await writeFile('verification/auth-browser.json', JSON.stringify(report, null, 2) + '\n');
console.log(`Browser checks passed: ${checks.length}. Synthetic data only; credentials omitted.`);
