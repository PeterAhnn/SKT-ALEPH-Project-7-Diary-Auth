// Explicit synthetic integration against the dedicated T07 PostgreSQL only.
// Simulated dates belong to disposable test accounts, never actual usage.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes,randomUUID,createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPostgresIdentity,cloudPool } from '../src/identity-postgres.mjs';
import { createHandler } from '../src/http.mjs';
import { legacyDigest } from '../src/migration.mjs';

process.loadEnvFile('.env.cloud.local');
assert.equal(process.env.T07_PROJECT_REF,'vagluzmvitdtshjknxrp');
const pool=cloudPool();let stamp=new Date().toISOString();
const identity=createPostgresIdentity({pool,recordOrigin:'synthetic',clock:()=>stamp});
const server=createServer(createHandler({identity,secureCookies:false,recordOrigin:'synthetic',clock:()=>stamp,publicDir:fileURLToPath(new URL('../public',import.meta.url))}));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const accounts=[];const secretValues=[];const checks=[];
const secret=()=>{const value=randomBytes(24).toString('base64url');secretValues.push(value);return value;};
function redact(value){if(!value||typeof value!=='object')return value;if(Array.isArray(value))return value.map(redact);return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/^(password|current_password|token|csrf|cookie|x-csrf-token|set-cookie)$/i.test(key)?'[REDACTED]':redact(item)]));}
async function request(path,{method='GET',input,auth,headers={}}={}){
 const sent={...(input?{'Content-Type':'application/json'}:{}),...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrf}:{}),...headers};
 const response=await fetch(base+path,{method,headers:sent,body:input?JSON.stringify(input):undefined,redirect:'manual'});
 const raw=await response.text();let body;try{body=JSON.parse(raw);}catch{body=raw;}
 return {path,method,status:response.status,body,headers:sent,input,response};
}
function record(name,requests=[],extra={}){checks.push({name,passed:true,requests:requests.map(r=>({path:r.path,method:r.method,status:r.status,headers:redact(r.headers),input:redact(r.input),response:redact(r.body)})),...extra});}
async function login(account){const result=await request('/api/auth/login',{method:'POST',input:{email:account.email,password:account.password}});assert.equal(result.status,200);account.cookie=result.response.headers.get('set-cookie').split(';')[0];account.token=account.cookie.slice(12);account.csrf=result.body.data.csrf;secretValues.push(account.token,account.csrf);return result;}
async function account(shared){const email=`cloud-${randomBytes(6).toString('hex')}@example.test`;const password=shared||secret();const created=await request('/api/auth/register',{method:'POST',input:{email,password}});assert.equal(created.status,201);const row={...created.body.data.user,password,created};accounts.push(row);row.loggedIn=await login(row);return row;}
async function state(auth){const result=await request('/api/state',{auth});assert.equal(result.status,200);return {data:result.body.data,observation:result.body.observation};}
const planInput={title:'합성 클라우드 검사',description:'실제 사용자 기록 아님',start_date:stamp.slice(0,10),end_date:'2026-12-31',priority:'medium',success_criteria:'분리·이관·관찰 검사',expected_minutes:0};
const taskInput={title:'합성 할 일',notes:'시험 자료',due_date:null,priority:'medium',tags:['synthetic'],expected_minutes:0};
async function plan(auth,title=planInput.title){const r=await request('/api/plans',{method:'POST',auth,input:{...planInput,title}});assert.equal(r.status,200);return r.body.data.entity;}
async function task(auth,planId){const r=await request(`/api/plans/${planId}/tasks`,{method:'POST',auth,input:taskInput});assert.equal(r.status,200);return r.body.data.entity;}
const beforeUsers=Number((await pool.query('SELECT count(*) AS n FROM t07_private.users')).rows[0].n);
try{
 assert.equal((await pool.query('SELECT current_user AS role')).rows[0].role,'t07_server');
 const shared=secret();const a=await account(shared);const b=await account(shared);
 const hashes=(await pool.query('SELECT password_digest FROM t07_private.users WHERE id=ANY($1::uuid[]) ORDER BY id',[accounts.map(x=>x.id)])).rows.map(row=>row.password_digest);
 assert.equal(hashes.length,2);assert.notEqual(hashes[0],hashes[1]);assert.ok(hashes.every(hash=>!hash.includes(shared)));
 const duplicate=await request('/api/auth/register',{method:'POST',input:{email:a.email.toUpperCase(),password:shared}});assert.equal(duplicate.status,409);
 const wrong=secret();const wrongLogin=await request('/api/auth/login',{method:'POST',input:{email:a.email,password:wrong}});const missing=await request('/api/auth/login',{method:'POST',input:{email:'absent-'+randomUUID()+'@example.test',password:wrong}});assert.equal(wrongLogin.status,401);assert.deepEqual(wrongLogin.body,missing.body);
 record('registration-and-storage',[a.created,a.loggedIn,b.created,duplicate,wrongLogin,missing],{stored_synthetic_hashes:hashes,different_salts:true});
 const allowed=await request('/api/state',{auth:a});const denied=await request('/api/state');assert.equal(denied.status,401);
 const noCsrf=await request('/api/plans',{method:'POST',auth:a,input:planInput,headers:{'X-CSRF-Token':''}});const origin=await request('/api/plans',{method:'POST',auth:a,input:planInput,headers:{Origin:'https://untrusted.example'}});assert.equal(noCsrf.status,403);assert.equal(origin.status,403);assert.equal((await state(a)).data.plans.length,0);
 record('anonymous-and-csrf',[allowed,denied,noCsrf,origin]);
 const ap=await plan(a),bp=await plan(b);const at=await task(a,ap.id),bt=await task(b,bp.id);
 const beforeA=await state(a),beforeB=await state(b);const denials=[];
 const sqlClient=await pool.connect();try{
  await sqlClient.query('BEGIN');await sqlClient.query("SELECT set_config('t07.user_id',$1,true)",[a.id]);
  const visible=await sqlClient.query('SELECT user_id FROM t07_private.diaries');assert.deepEqual(visible.rows.map(row=>row.user_id),[a.id]);
  assert.equal((await sqlClient.query('SELECT user_id FROM t07_private.diaries WHERE user_id=$1',[b.id])).rowCount,0);
  await sqlClient.query('ROLLBACK');
 }finally{sqlClient.release();}record('postgres-owner-row-policy',[],{server_session_owner_context_only:true,foreign_snapshot_invisible:true});
 for(const [owner,foreign]of[[a,bt],[b,at]])for(const method of['GET','PATCH','DELETE']){const r=await request(`/api/tasks/${foreign.id}`,{method,auth:owner,...(method==='PATCH'?{input:{expected_version:1,...taskInput,title:'외부 변경'}}:{})});assert.equal(r.status,404);denials.push(r);}
 assert.deepEqual(await state(a),beforeA);assert.deepEqual(await state(b),beforeB);
 const forged=await request('/api/state?user_id='+b.id,{auth:a,headers:{'X-User-Id':b.id}});assert.equal(forged.status,200);assert.deepEqual(forged.body.data,beforeA.data);
 record('bidirectional-ownership',denials.concat(forged),{six_denials:true,full_states_unchanged:true,before_task_counts:[1,1],after_task_counts:[1,1]});
 await assert.rejects(()=>identity.withDiary(a.id,async store=>{await store.mutate('plan.create',planInput);throw Error('Synthetic callback failure');},a.token),{status:503});
 assert.deepEqual(await state(a),beforeA);record('postgres-transaction-rollback',[],{complete_snapshot_unchanged:true});
 const concurrent=await Promise.all([plan(a,'합성 동시 계획 1'),plan(a,'합성 동시 계획 2')]);assert.equal(concurrent.length,2);assert.equal((await state(a)).data.plans.length,3);
 const requestId=randomUUID();const completed=await Promise.all([request(`/api/tasks/${at.id}/complete`,{method:'POST',auth:a,input:{request_id:requestId}}),request(`/api/tasks/${at.id}/complete`,{method:'POST',auth:a,input:{request_id:requestId}})]);assert.ok(completed.every(r=>r.status===200));assert.equal((await state(a)).data.completion_events.length,1);
 record('concurrent-writes-and-replay',completed,{both_plan_writes_retained:true,one_completion_event:true});
 const persistenceBefore=await state(a);const second=createPostgresIdentity({pool,recordOrigin:'synthetic',clock:()=>stamp});assert.deepEqual(await second.withDiary(a.id,store=>store.stateBundle(),a.token),persistenceBefore);record('fresh-adapter-persistence');
 const old={...a};const beforeLogout=await request('/api/state',{auth:old});const logout=await request('/api/auth/logout',{method:'POST',auth:old});const afterLogout=await request('/api/state',{auth:old});assert.equal(beforeLogout.status,200);assert.equal(logout.status,200);assert.equal(afterLogout.status,401);await login(a);record('same-value-after-logout',[beforeLogout,logout,afterLogout],{same_url_method_cookie:true});
 const oldB={...b};const extraLogin=await login(b);const secondOldB={...b};const next=secret();const change=await request('/api/auth/password',{method:'POST',auth:b,input:{current_password:b.password,password:next}});assert.equal(change.status,200);const rejected1=await request('/api/state',{auth:oldB});const rejected2=await request('/api/state',{auth:secondOldB});assert.equal(rejected1.status,401);assert.equal(rejected2.status,401);b.password=next;await login(b);record('password-change-revokes-all',[extraLogin,change,rejected1,rejected2]);
 const source=await request('/api/export',{auth:a});assert.equal(source.status,200);assert.equal(source.body.schema_version,3);assert.equal(source.body.record_origin,'synthetic');assert.ok(!JSON.stringify(source.body).includes(bt.id));
 const c=await account();const legacy={...source.body,schema_version:2};const preview=await request('/api/migration/preview',{method:'POST',auth:c,input:{exported:legacy}});assert.equal(preview.status,200);const imported=await request('/api/migration/import',{method:'POST',auth:c,input:{exported:legacy,expected_digest:preview.body.data.source_digest}});assert.equal(imported.status,200);const exportedC=await request('/api/export',{auth:c});assert.equal(legacyDigest(exportedC.body),legacyDigest(legacy));record('whole-seven-table-migration',[preview,imported],{all_row_values_digest_match:true,source_is_synthetic:true});
 const observationPlan=await plan(a,'합성 가상 5일');const started=await request(`/api/plans/${observationPlan.id}/observation`,{method:'POST',auth:a,input:{question:'합성 질문',first_rule:'합성 첫 규칙',accept_rules:true}});assert.equal(started.status,200);const study=started.body.data.entity;const days=[];
 for(const [index,count]of[2,0,3,1,2].entries()){
  if(index){stamp=new Date(new Date(stamp).getTime()+86400000).toISOString();await login(a);}
  for(let i=0;i<count;i++){const row=await task(a,observationPlan.id);const r=await request(`/api/tasks/${row.id}/complete`,{method:'POST',auth:a,input:{request_id:randomUUID()}});assert.equal(r.status,200);}
  const date=new Date(new Date(stamp).getTime()+9*3600000).toISOString().slice(0,10);const r=await request(`/api/observations/${study.id}/days`,{method:'POST',auth:a,input:{expected_date:date,note:'합성 가상 날짜: 실제 관찰 아님'}});assert.equal(r.status,200);assert.equal(r.body.data.entity.count,count);days.push(r.body.data.entity);
  if(index===1){stamp=new Date(new Date(stamp).getTime()+1).toISOString();const r=await request(`/api/observations/${study.id}/rule`,{method:'POST',auth:a,input:{next_rule:'합성 변경 규칙',reason:'기능 시험일 뿐 실제 판단 아님',day_one_id:days[0].id,day_two_id:days[1].id}});assert.equal(r.status,200);}
 }
 const hand=await request(`/api/observations/${study.id}/check`,{method:'POST',auth:a,input:{hand_sum:8,hand_mean:'1.6',note:'합성 입력: 2+0+3+1+2=8, 8/5=1.6'}});assert.equal(hand.status,200);
 const full=await request('/api/export',{auth:a});assert.equal(full.body.observation_days.length,5);assert.equal(full.body.observation_changes.length,1);assert.equal(full.body.observation_checks.length,1);await identity.withDiary(a.id,store=>store.stateBundle(),a.token);record('simulated-five-day-persistence',[hand],{dates:days.map(d=>d.date),counts:[2,0,3,1,2],one_change:true,all_twelve_tables_exported:true,actual_usage:false});
 const expired={...a};await pool.query('UPDATE t07_private.sessions SET expires_at=$1 WHERE token_hash=$2',[new Date(new Date(stamp).getTime()-1).toISOString(),createHash('sha256').update(a.token).digest('hex')]);const expiration=await request('/api/state',{auth:expired});assert.equal(expiration.status,401);await login(a);record('forced-synthetic-expiration',[expiration],{expiry_forced_on_test_session:true,actual_eight_hour_wait:false});
 await login(b);const bBeforeDelete=await state(b);const deleted=await request('/api/auth/account',{method:'DELETE',auth:a,input:{current_password:a.password,confirm:a.email}});assert.equal(deleted.status,200);const aDenied=await request('/api/state',{auth:a});assert.equal(aDenied.status,401);assert.deepEqual(await state(b),bBeforeDelete);assert.equal((await pool.query('SELECT count(*) AS n FROM t07_private.diaries WHERE user_id=$1',[a.id])).rows[0].n,'0');record('account-delete-cascade',[deleted,aDenied],{other_account_unchanged:true,diary_and_sessions_removed:true});
 console.log(`Cloud integration checks passed: ${checks.length}; all accounts and dates are synthetic.`);
}finally{
 // Only UUIDs successfully created by this helper are eligible for cleanup.
 if(accounts.length)await pool.query('DELETE FROM t07_private.users WHERE id=ANY($1::uuid[])',[accounts.map(row=>row.id)]);
 const afterUsers=Number((await pool.query('SELECT count(*) AS n FROM t07_private.users')).rows[0].n);assert.equal(afterUsers,beforeUsers);
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 const report={checked_at:new Date().toISOString(),data_origin:'synthetic',scope:'Real dedicated T07 PostgreSQL with local HTTP adapter; controlled simulated observation dates, not actual use or public Vercel QA',project_ref:process.env.T07_PROJECT_REF,checks,disposable_accounts_cleaned:accounts.length,user_count_before:beforeUsers,user_count_after:afterUsers,credentials:'[REDACTED]'};
 const serialized=JSON.stringify(report,null,2);for(const value of secretValues)assert.ok(!serialized.includes(value));assert.ok(!serialized.includes(process.env.T07_PG_PASSWORD));await writeFile('verification/cloud-integration.json',serialized+'\n');await identity.close();
}
