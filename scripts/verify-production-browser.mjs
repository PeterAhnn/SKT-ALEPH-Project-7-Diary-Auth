// Real HTTPS UI, disposable synthetic account; no actual observation dates are recorded.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { cloudPool } from '../src/identity-postgres.mjs';
process.loadEnvFile('.env.cloud.local');
assert.equal(process.env.T07_PROJECT_REF,'vagluzmvitdtshjknxrp');
const base='https://skt-aleph-project-7-diary-auth.vercel.app',pool=cloudPool();
const bun=process.env.T07_BROWSE_BUN,cli=process.env.T07_BROWSE_CLI;
assert.ok(bun&&cli);
const email=`production-browser-${randomBytes(6).toString('hex')}@example.test`,password=randomBytes(24).toString('base64url');
const checks=[],paths=['verification/production-login-desktop.png','verification/production-login-mobile.png','verification/production-authenticated-synthetic.png'];
let ownId;
function browse(...args){const r=spawnSync(bun,['run',cli,...args],{encoding:'utf8',timeout:30000});assert.equal(r.status,0,`gstack ${args[0]} failed; arguments and raw browser output omitted.`);return r.stdout;}
function observed(expression){return browse('js',expression).includes('true');}
async function until(expression){for(let attempt=0;attempt<30;attempt++){if(observed(expression))return;await new Promise(resolve=>setTimeout(resolve,150));}assert.fail('Expected UI state not reached; raw output omitted.');}
function record(name){checks.push({name,passed:true});}
try{
 browse('viewport','1280x900');browse('goto',base);
 await until("!document.getElementById('auth-panel').hidden && document.getElementById('diary-shell').hidden");
 browse('screenshot',resolve(paths[0]));record('anonymous public login screen without signup or hosting login');
 browse('viewport','375x812');assert.ok(observed('document.documentElement.scrollWidth <= innerWidth'));browse('screenshot',resolve(paths[1]));record('375px login has no horizontal overflow');
 browse('viewport','1280x900');browse('click','#auth-register-tab');browse('fill','#auth-email',email);browse('fill','#auth-password',password);browse('click','#auth-submit');
 await until("document.getElementById('auth-message').textContent.includes('가입했습니다')");
 const own=(await pool.query('SELECT id FROM t07_private.users WHERE email=$1',[email])).rows[0];assert.ok(own);ownId=own.id;
 await pool.query("UPDATE t07_private.users SET record_origin='synthetic' WHERE id=$1",[ownId]);record('real HTTPS registration form creates disposable test account');
 browse('fill','#auth-password',password);browse('click','#auth-submit');
 await until("!document.getElementById('diary-shell').hidden && document.getElementById('save-status').textContent.includes('서버')");
 await until("!document.getElementById('synthetic-banner').hidden");record('HTTPS login opens own diary and synthetic label');
 browse('click','#new-plan-button');browse('fill','[name="title"]','공개 화면 합성 검사');browse('fill','[name="expected_minutes"]','10');browse('fill','[name="success_criteria"]','공개 운영 UI 기능 검사');browse('click','#editor-dialog button[type="submit"]');
 await until("document.getElementById('workspace-title').textContent === '공개 화면 합성 검사'");record('authenticated UI saves own plan');
 browse('goto',base);await until("document.getElementById('workspace-title').textContent === '공개 화면 합성 검사'");browse('screenshot',resolve(paths[2]));record('reload keeps HTTPS session and persisted plan');
 browse('viewport','375x812');assert.ok(observed('document.documentElement.scrollWidth <= innerWidth'));record('375px authenticated diary has no horizontal overflow');
 browse('click','#logout-button');await until("!document.getElementById('auth-panel').hidden && document.getElementById('diary-shell').hidden");record('logout returns to login');
 browse('goto',base+'/diary');await until("location.pathname === '/' && document.getElementById('diary-shell').hidden");record('direct diary URL after logout redirects');
 browse('fill','#auth-email',email);browse('fill','#auth-password','synthetic-wrong-password');browse('click','#auth-submit');await until("document.getElementById('auth-message').textContent === '아이디 또는 비밀번호를 확인해 주세요.'");assert.ok(observed("document.getElementById('auth-password').value === ''"));record('generic wrong login error and password field cleared');
 console.log(`Public HTTPS browser checks passed: ${checks.length}; synthetic only.`);
}finally{
 if(ownId)await pool.query('DELETE FROM t07_private.users WHERE id=$1',[ownId]);
 assert.equal((await pool.query('SELECT count(*) AS n FROM t07_private.users WHERE email=$1',[email])).rows[0].n,'0');
 browse('viewport','1280x900');browse('goto',base);
 await writeFile('verification/production-browser.json',JSON.stringify({checked_at:new Date().toISOString(),url:base,data_origin:'synthetic',scope:'Actual public HTTPS UI in isolated gstack Chromium; no actual five-day observations',checks,screenshots:paths,disposable_account_cleaned:!!ownId,credentials:'[REDACTED]'},null,2)+'\n');await pool.end();
}
