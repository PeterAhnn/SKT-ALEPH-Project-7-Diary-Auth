import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteStore } from '../src/store-sqlite.mjs';
import { cloudPool } from '../src/identity-postgres.mjs';
import { createHandler } from '../src/http.mjs';
import { createServer } from 'node:http';
import { createIdentityStore } from '../src/identity-sqlite.mjs';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('serverless request without a native socket can register and log in without trusting forwarded IP',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'t07-serverless-'));
 const identity=createIdentityStore({directory,recordOrigin:'synthetic'});
 const handler=createHandler({identity,secureCookies:true});
 const server=createServer((req,res)=>handler(new Proxy(req,{get(target,key){if(key==='socket')return undefined;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}}),res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const input={email:'socket-fixture@example.test',password:'synthetic-serverless-password'};
  for(const [path,status]of[['register',201],['login',200]]){
   const r=await fetch(`http://127.0.0.1:${server.address().port}/api/auth/${path}`,{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':'untrusted.example'},body:JSON.stringify(input)});
   assert.equal(r.status,status);if(path==='login')assert.match(r.headers.get('set-cookie'),/; Secure/);
  }
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await identity.close();await rm(directory,{recursive:true,force:true});}
});

test('cloud snapshot hydration round-trips twelve tables and rejects malformed ownership-independent structure atomically',async()=>{
 const source=createSqliteStore({filename:':memory:',recordOrigin:'synthetic'});const target=createSqliteStore({filename:':memory:',recordOrigin:'synthetic'});
 try{
  await source.mutate('plan.create',{title:'합성 저장',description:'실사용 아님',start_date:'2026-10-02',end_date:'2026-10-06',priority:'medium',success_criteria:'정확한 복원',expected_minutes:0});
  const snapshot=await source.exportState();assert.equal(Object.keys(snapshot).length,12);
  const invalid=structuredClone(snapshot);invalid.tasks.push({id:'invalid'});
  await assert.rejects(()=>target.restoreSnapshot(invalid));assert.equal((await target.state()).plans.length,0);
  await target.restoreSnapshot(snapshot);assert.deepEqual(await target.exportState(),snapshot);
  await assert.rejects(()=>target.restoreSnapshot(snapshot),{status:409});
 }finally{await source.close();await target.close();}
});
test('cloud configuration rejects inherited T06 and foreign hosts and keeps TLS verification enabled',async()=>{
 const env={T07_PROJECT_REF:'vagluzmvitdtshjknxrp',T07_PG_HOST:'aws-0-ap-northeast-2.pooler.supabase.com',T07_PG_PORT:'6543',T07_PG_USER:'t07_server.vagluzmvitdtshjknxrp',T07_PG_PASSWORD:'synthetic-config-value-only'};
 assert.throws(()=>cloudPool({...env,T07_PROJECT_REF:'yynsaokvquggrbdrmalr'}));
 assert.throws(()=>cloudPool({...env,T07_PG_HOST:'foreign.example'}));
 assert.throws(()=>cloudPool({...env,T07_PG_USER:'postgres.vagluzmvitdtshjknxrp'}));
 const pool=cloudPool(env);assert.equal(pool.options.ssl.rejectUnauthorized,true);assert.equal(pool.options.max,2);await pool.end();
});
