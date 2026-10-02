import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIdentityStore } from '../src/identity-sqlite.mjs';
import { createHandler } from '../src/http.mjs';

test('observation and migration endpoints require auth/CSRF, select only server account, and export all own observation tables',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'t07-observation-api-'));const stamp='2026-10-02T00:00:00Z';
  const identity=createIdentityStore({directory,clock:()=>stamp,recordOrigin:'synthetic'});
  const server=createServer(createHandler({identity,clock:()=>stamp,recordOrigin:'synthetic',secureCookies:false}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));identity.close();await rm(directory,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const accounts=[];for(const email of ['a@example.test','b@example.test']){const password=randomBytes(18).toString('base64url');await identity.register({email,password});const session=await identity.login({email,password});accounts.push({Cookie:`pds_session=${session.token}`,'X-CSRF-Token':session.csrf});}
  async function request(path,{method='GET',input,headers=accounts[0]}={}){const response=await fetch(base+path,{method,headers:{...headers,...(input?{'Content-Type':'application/json'}:{})},body:input?JSON.stringify(input):undefined});return {status:response.status,body:await response.json()};}
  const plan=(await request('/api/plans',{method:'POST',input:{title:'합성 관찰',start_date:'2026-10-02',end_date:'2026-10-06',success_criteria:'합성 검사',expected_minutes:0}})).body.data.entity;
  const setup={question:'합성 질문',first_rule:'합성 규칙',accept_rules:true};
  assert.equal((await request(`/api/plans/${plan.id}/observation`,{method:'POST',input:setup,headers:{}})).status,401);
  assert.equal((await request(`/api/plans/${plan.id}/observation`,{method:'POST',input:setup,headers:{Cookie:accounts[0].Cookie}})).status,403);
  assert.equal((await request(`/api/plans/${plan.id}/observation`,{method:'POST',input:setup,headers:accounts[1]})).status,404);
  const study=(await request(`/api/plans/${plan.id}/observation`,{method:'POST',input:setup})).body.data.entity;
  const before=(await request('/api/state')).body;
  for(const [suffix,input] of [['days',{expected_date:'2026-10-02'}],['rule',{next_rule:'새 규칙',reason:'합성',day_one_id:randomUUID(),day_two_id:randomUUID()}],['check',{hand_sum:0,hand_mean:'0.0',note:'합성'}]])assert.equal((await request(`/api/observations/${study.id}/${suffix}`,{method:'POST',input,headers:accounts[1]})).status,404);
  assert.equal((await request('/api/observations',{headers:accounts[1]})).body.data.observation_studies.length,0);
  assert.equal((await request('/api/observations',{headers:{}})).status,401);
  assert.deepEqual((await request('/api/state')).body,before);
  for(const path of ['/api/migration/preview','/api/migration/import'])assert.equal((await request(path,{method:'POST',input:{exported:{}},headers:{}})).status,401);
  assert.equal((await request('/api/migration/preview',{method:'POST',input:{exported:{},user_id:'forged'}})).status,400);
  const day=await request(`/api/observations/${study.id}/days`,{method:'POST',input:{expected_date:'2026-10-02',note:'합성 0개'}});assert.equal(day.status,200);assert.equal(day.body.data.entity.count,0);
  const exported=(await request('/api/export')).body;assert.equal(exported.schema_version,3);assert.equal(exported.observation_studies.length,1);assert.equal(exported.observation_days.length,1);assert.equal(exported.observation_unit,'개');
  assert.equal((await request('/api/export',{headers:accounts[1]})).body.observation_studies.length,0);
});
