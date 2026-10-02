// Disposable synthetic accounts on the real public HTTPS deployment. No simulated days.
import assert from 'node:assert/strict';
import { randomBytes,createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { cloudPool,createPostgresIdentity } from '../src/identity-postgres.mjs';
process.loadEnvFile('.env.cloud.local');
assert.equal(process.env.T07_PROJECT_REF,'vagluzmvitdtshjknxrp');
const pool=cloudPool(),base='https://skt-aleph-project-7-diary-auth.vercel.app';
const seeded=process.env.T07_QA_SEED_ACCOUNTS==='synthetic';
const fixture=seeded?createPostgresIdentity({pool,recordOrigin:'synthetic'}):null;
const fixtureBucket='production-fixture-'+randomBytes(12).toString('hex');
const accounts=[],secrets=[process.env.T07_PG_PASSWORD],passwords=[],checks=[];
const secret=()=>{const value=randomBytes(24).toString('base64url');secrets.push(value);passwords.push(value);return value;};
const redact=value=>Array.isArray(value)?value.map(redact):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/^(?:password|current_password|csrf|cookie|x-csrf-token|set-cookie)$/i.test(key)?'[REDACTED]':redact(item)])):value;
async function request(path,{method='GET',input,auth,headers={}}={}){
 const sent={...(input?{'Content-Type':'application/json'}:{}),...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrf}:{}),...headers};
 const response=await fetch(base+path,{method,headers:sent,body:input?JSON.stringify(input):undefined,redirect:'manual'});
 const raw=await response.text();let body;try{body=JSON.parse(raw);}catch{body=raw;}
 for(const value of passwords)assert.ok(!raw.includes(value),'Raw response contains a disposable input password; value omitted.');
 return {path,method,status:response.status,body,input,headers:sent,response};
}
function record(name,requests=[],extra={}){checks.push({name,passed:true,requests:requests.map(r=>({path:r.path,method:r.method,status:r.status,input:redact(r.input),headers:redact(r.headers),response:typeof r.body==='string'?'[HTML omitted]':redact(r.body)})),...extra});}
async function login(a){const r=await request('/api/auth/login',{method:'POST',input:{email:a.email,password:a.password}});assert.equal(r.status,200,`login status ${r.status}`);const cookie=r.response.headers.get('set-cookie');assert.match(cookie,/; Secure/);assert.match(cookie,/; HttpOnly/);assert.match(cookie,/; SameSite=Strict/);a.cookie=cookie.split(';')[0];a.csrf=r.body.data.csrf;secrets.push(a.cookie.slice('pds_session='.length),a.csrf);return r;}
async function account(password){const email=`production-${randomBytes(6).toString('hex')}@example.test`;let user,r;if(seeded){user=await fixture.register({email,password},fixtureBucket);}else{r=await request('/api/auth/register',{method:'POST',input:{email,password}});assert.equal(r.status,201,`register status ${r.status}`);user=r.body.data.user;}const a={...user,email,password};accounts.push(a);await pool.query("UPDATE t07_private.users SET record_origin='synthetic' WHERE id=$1",[a.id]);a.registration=r;a.login=await login(a);return a;}
async function state(a){const r=await request('/api/state',{auth:a});assert.equal(r.status,200,`state status ${r.status}`);assert.equal(r.body.meta.record_origin,'synthetic');return {data:r.body.data,observation:r.body.observation};}
const planInput={title:'공개 배포 합성 검사',description:'실제 사용자 자료 아님',start_date:new Date().toISOString().slice(0,10),end_date:'2026-12-31',priority:'medium',success_criteria:'HTTPS 인증 및 소유자 차단',expected_minutes:0};
const taskInput={title:'배포 합성 할 일',notes:'실사용 기록 아님',due_date:null,priority:'medium',tags:['synthetic'],expected_minutes:0};
const before=Number((await pool.query('SELECT count(*) AS n FROM t07_private.users')).rows[0].n);
let completed=false;
try{
 const root=await request('/'),direct=await request('/diary'),anonymous=await request('/api/state');assert.equal(root.status,200);assert.ok(root.body.includes('auth-panel'));assert.equal(direct.status,303);assert.equal(direct.response.headers.get('location'),'/');assert.equal(anonymous.status,401);record('public-without-account-and-private-denial',[root,direct,anonymous]);
 const shared=secret(),a=await account(shared),b=await account(shared);
 const hashes=(await pool.query('SELECT password_digest FROM t07_private.users WHERE id=ANY($1::uuid[]) ORDER BY id',[accounts.map(x=>x.id)])).rows.map(x=>x.password_digest);assert.equal(hashes.length,2);assert.notEqual(hashes[0],hashes[1]);
 let duplicate;if(seeded){await assert.rejects(()=>fixture.register({email:a.email,password:shared},fixtureBucket),{status:409});}else{duplicate=await request('/api/auth/register',{method:'POST',input:{email:a.email,password:shared}});assert.equal(duplicate.status,409);}
 const wrong=secret(),wrongLogin=await request('/api/auth/login',{method:'POST',input:{email:a.email,password:wrong}}),missing=await request('/api/auth/login',{method:'POST',input:{email:`missing-${randomBytes(6).toString('hex')}@example.test`,password:wrong}});assert.equal(wrongLogin.status,401);assert.deepEqual(wrongLogin.body,missing.body);record(seeded?'fixture-password-storage-and-public-secure-login':'registration-password-and-secure-cookie',[a.registration,a.login,b.registration,b.login,duplicate,wrongLogin,missing].filter(Boolean),{stored_synthetic_hashes:hashes,secure_httponly_samesite:true,account_setup_transport:seeded?'trusted server adapter, distinct synthetic throttle bucket; not a public registration request':'public HTTPS',duplicate_setup_transport:seeded?'trusted server adapter':'public HTTPS'});
 const allowed=await request('/api/state',{auth:a}),noCsrf=await request('/api/plans',{method:'POST',auth:a,input:planInput,headers:{'X-CSRF-Token':''}}),origin=await request('/api/plans',{method:'POST',auth:a,input:planInput,headers:{Origin:'https://untrusted.example'}});assert.equal(allowed.status,200);assert.equal(noCsrf.status,403);assert.equal(origin.status,403);assert.equal((await state(a)).data.plans.length,0);record('csrf-origin-denial',[allowed,noCsrf,origin]);
 const own=[];
 for(const owner of[a,b]){const p=await request('/api/plans',{method:'POST',auth:owner,input:planInput});assert.equal(p.status,200);const t=await request(`/api/plans/${p.body.data.entity.id}/tasks`,{method:'POST',auth:owner,input:taskInput});assert.equal(t.status,200);owner.task=t.body.data.entity;const read=await request(`/api/tasks/${owner.task.id}`,{auth:owner});assert.equal(read.status,200);own.push(p,t,read);}
 const beforeA=await state(a),beforeB=await state(b),denials=[];
 for(const [owner,foreign]of[[a,b.task],[b,a.task]])for(const method of['GET','PATCH','DELETE']){const r=await request(`/api/tasks/${foreign.id}`,{method,auth:owner,...(method==='PATCH'?{input:{expected_version:1,...taskInput,title:'외부 수정'}}:{})});assert.equal(r.status,404);denials.push(r);}
 assert.deepEqual(await state(a),beforeA);assert.deepEqual(await state(b),beforeB);
 const query=await request(`/api/state?user_id=${b.id}`,{auth:a,headers:{'X-User-Id':b.id}}),body=await request('/api/state',{method:'POST',auth:a,input:{user_id:b.id}});assert.equal(query.status,200);assert.equal(body.status,200);assert.deepEqual(query.body.data,beforeA.data);assert.deepEqual(body.body.data,beforeA.data);
 const exported=await request('/api/export',{auth:a});assert.equal(exported.status,200);assert.equal(exported.body.schema_version,3);assert.equal(exported.body.record_origin,'synthetic');assert.ok(!JSON.stringify(exported.body).includes(b.task.id));record('two-way-read-edit-delete-isolation',own.concat(denials,query,body,exported),{six_denials:true,full_state_unchanged:true,counts_before:[1,1],counts_after:[1,1],export_other_account_absent:true});
 const update=await request(`/api/tasks/${a.task.id}`,{method:'PATCH',auth:a,input:{expected_version:1,...taskInput,title:'자기 자료 정상 수정'}}),remove=await request(`/api/tasks/${a.task.id}`,{method:'DELETE',auth:a});assert.equal(update.status,200);assert.equal(remove.status,200);record('own-edit-delete-success',[update,remove]);
 const oldA={...a},beforeLogout=await request('/api/state',{auth:oldA}),logout=await request('/api/auth/logout',{method:'POST',auth:oldA}),afterLogout=await request('/api/state',{auth:oldA});assert.equal(beforeLogout.status,200);assert.equal(logout.status,200);assert.equal(afterLogout.status,401);await login(a);record('same-old-auth-after-logout',[beforeLogout,logout,afterLogout],{same_url_method_cookie:true});
 const oldB={...b};await login(b);const secondB={...b},next=secret(),change=await request('/api/auth/password',{method:'POST',auth:b,input:{current_password:b.password,password:next}});assert.equal(change.status,200);const firstDenied=await request('/api/state',{auth:oldB}),secondDenied=await request('/api/state',{auth:secondB});assert.equal(firstDenied.status,401);assert.equal(secondDenied.status,401);b.password=next;await login(b);record('password-change-all-sessions-denied',[change,firstDenied,secondDenied]);
 const oldToken=a.cookie.slice('pds_session='.length);await pool.query('UPDATE t07_private.sessions SET expires_at=$1 WHERE token_hash=$2',[new Date(Date.now()-1000).toISOString(),createHash('sha256').update(oldToken).digest('hex')]);const expired=await request('/api/state',{auth:a});assert.equal(expired.status,401);await login(a);record('forced-test-session-expiry',[expired],{actual_eight_hour_wait:false,test_account_only:true});
 const beforeOther=await state(b),deleted=await request('/api/auth/account',{method:'DELETE',auth:a,input:{current_password:a.password,confirm:a.email}}),deletedDenied=await request('/api/state',{auth:a});assert.equal(deleted.status,200);assert.equal(deletedDenied.status,401);assert.deepEqual(await state(b),beforeOther);record('delete-own-account-other-state-retained',[deleted,deletedDenied]);
 const cli=process.env.T07_VERCEL_CLI;assert.ok(cli,'Set the verified Vercel CLI entry for runtime log verification.');
 const logs=spawnSync(process.execPath,[cli,'logs','--environment','production','--since','15m','--limit','100','--json','--scope','peter-ahns-projects'],{encoding:'utf8',timeout:30000});
 assert.equal(logs.status,0,'Runtime log fetch failed; raw output omitted.');
 for(const value of secrets)assert.ok(!logs.stdout.includes(value),'Runtime logs contain a disposable credential; value omitted.');
 record('raw-password-response-and-runtime-log-scan',[],{all_test_passwords_absent_from_raw_responses:true,test_passwords_tokens_csrf_and_db_password_absent_from_fetched_logs:true,log_scope:'Production, latest 15m, maximum 100 entries; limited snapshot, not all historical logs'});
 completed=true;
 console.log(`Public HTTPS API checks passed: ${checks.length}; synthetic accounts only.`);
}finally{
 if(accounts.length)await pool.query('DELETE FROM t07_private.users WHERE id=ANY($1::uuid[])',[accounts.map(x=>x.id)]);
 const after=Number((await pool.query('SELECT count(*) AS n FROM t07_private.users')).rows[0].n);
 const ownRemaining=Number((await pool.query('SELECT count(*) AS n FROM t07_private.users WHERE id=ANY($1::uuid[])',[accounts.map(x=>x.id)])).rows[0].n);assert.equal(ownRemaining,0);
 const report={checked_at:new Date().toISOString(),url:base,data_origin:'synthetic',scope:seeded?'Actual public HTTPS API; account/duplicate setup through isolated server fixture bucket, real clock, no simulated observations':'Actual public HTTPS deployment API; real server time, no simulated five-day use',completed,checks,user_count_before:before,user_count_after:after,external_user_delta:after-before,cleanup_assertion:'Only this helper\'s created UUIDs absent; unrelated users may register during QA',own_accounts_remaining:ownRemaining,disposable_accounts_cleaned:accounts.length,credentials:'[REDACTED]'};
 const serialized=JSON.stringify(report,null,2);for(const value of secrets)assert.ok(!serialized.includes(value));await writeFile(completed?'verification/production-api.json':`verification/production-api-failed-${Date.now()}.json`,serialized+'\n');await pool.end();
}
