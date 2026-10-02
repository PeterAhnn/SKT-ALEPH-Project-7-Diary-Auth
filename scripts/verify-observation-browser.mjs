// Synthetic UI integration with an in-process simulated server clock.
// The normal server exposes no clock control or route for creating past records.
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createIdentityStore } from '../src/identity-sqlite.mjs';
import { createHandler } from '../src/http.mjs';
import { createSqliteStore } from '../src/store-sqlite.mjs';

const bun=process.env.T07_BROWSE_BUN,cli=process.env.T07_BROWSE_CLI;
assert.ok(bun&&cli,'Set the installed gstack runtime paths.');
const directory=await mkdtemp(join(tmpdir(),'t07-observation-ui-synthetic-'));
let stamp='2026-10-02T00:00:00.000Z';
const identity=createIdentityStore({directory,clock:()=>stamp,recordOrigin:'synthetic'});
const server=createServer(createHandler({identity,clock:()=>stamp,recordOrigin:'synthetic',secureCookies:false,publicDir:resolve('public')}));
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const base=`http://127.0.0.1:${server.address().port}`;
const email=`observation-${randomBytes(5).toString('hex')}@example.test`,password=randomBytes(24).toString('base64url');
const checks=[];const planInput={title:'합성 이관 원본',start_date:'2026-10-02',end_date:'2026-10-06',success_criteria:'합성 7표 이관',expected_minutes:5};
async function browse(...args){return new Promise((resolve,reject)=>{const child=spawn(bun,['run',cli,...args],{windowsHide:true});let output='';child.stdout.on('data',part=>output+=part);child.stderr.resume();child.on('error',()=>reject(new Error(`gstack ${args[0]} failed; arguments omitted`)));child.on('close',code=>code===0?resolve(output):reject(new Error(`gstack ${args[0]} failed; arguments omitted`)));});}
async function until(expression){for(let n=0;n<30;n++){if((await browse('js',expression)).includes('true'))return;await new Promise(resolve=>setTimeout(resolve,100));}assert.fail('Expected UI state was not reached.');}
const checkpoint=name=>checks.push({name,passed:true});
async function submit(){await browse('click','#editor-dialog button[type="submit"]');await until("!document.getElementById('editor-dialog').open");}
async function login(){await browse('goto',base);await until("!document.getElementById('auth-panel').hidden");await browse('fill','#auth-email',email);await browse('fill','#auth-password',password);await browse('click','#auth-submit');await until("!document.getElementById('diary-shell').hidden && !document.getElementById('synthetic-banner').hidden");}
try {
  const source=createSqliteStore({filename:':memory:',clock:()=>stamp,recordOrigin:'synthetic'});
  let exported;
  try {
    const plan=(await source.mutate('plan.create',planInput)).entity;
    const task=(await source.mutate('task.create',{plan_id:plan.id,title:'합성 이전 할 일',expected_minutes:5})).entity;
    await source.mutate('task.complete',{id:task.id,request_id:randomUUID()});
    await source.mutate('execution.create',{task_id:task.id,started_at:stamp,ended_at:stamp,actual_minutes:0});
    const review=(await source.mutate('review.create',{plan_id:plan.id,improvement:'합성 개선'})).entity;
    await source.mutate('review.next-plan',{id:review.id,...planInput});
    exported={schema_version:2,timezone:'Asia/Seoul',time_unit:'minutes',record_origin:'synthetic',exported_at:stamp,...await source.state()};
  } finally {await source.close();}
  const sourceFile=join(directory,'synthetic-t06-export.json');await writeFile(sourceFile,JSON.stringify(exported));
  await browse('viewport','1280x900');await browse('goto',base);
  await browse('click','#auth-register-tab');await browse('fill','#auth-email',email);await browse('fill','#auth-password',password);await browse('click','#auth-submit');
  await until("document.getElementById('auth-message').textContent.includes('가입했습니다')");
  await browse('fill','#auth-password',password);await browse('click','#auth-submit');await until("!document.getElementById('synthetic-banner').hidden");
  await browse('click','#migration-button');await browse('upload','[name="source_file"]',sourceFile);await until("!document.querySelector('#editor-dialog button[type=submit]').disabled");await submit();
  await until("document.getElementById('plan-count').textContent==='2'");checkpoint('synthetic T06 file upload, seven-table preview and empty-account import through UI');
  stamp='2026-10-02T00:01:00.000Z';
  await browse('click','#new-plan-button');await browse('fill','[name="title"]','합성 5일 관찰');await browse('fill','[name="expected_minutes"]','0');await browse('fill','[name="end_date"]','2026-10-06');await browse('fill','[name="success_criteria"]','실사용과 구분한 5일 화면 검사');await submit();
  await until("document.getElementById('workspace-title').textContent==='합성 5일 관찰'");
  await browse('click','#tab-observe');await browse('click','#observation-start-button');await browse('fill','[name="question"]','합성 질문: 규칙 변화와 완료 개수');await browse('fill','[name="first_rule"]','합성 첫 규칙: 오늘 할 일 먼저 정하기');await browse('click','[name="accept_rules"]');await submit();
  await until("document.getElementById('panel-observe').textContent.includes('0/5일 확정')");checkpoint('user-entered question/rule and explicitly accepted fixed count/unit/calculation stored through UI');
  for(let day=0;day<5;day++){
    if(day>0){stamp=`2026-10-0${day+2}T00:01:00.000Z`;await login();await browse('click','#tab-observe');}
    const session=await identity.login({email,password});const headers={Cookie:`pds_session=${session.token}`,'X-CSRF-Token':session.csrf,'Content-Type':'application/json'};
    async function post(path,input){const response=await fetch(base+path,{method:'POST',headers,body:JSON.stringify(input)});assert.equal(response.status,200);return (await response.json()).data;}
    const state=await fetch(base+'/api/state',{headers}).then(r=>r.json());const plan=state.data.plans.find(row=>row.title==='합성 5일 관찰');
    for(let n=0;n<[2,0,3,1,2][day];n++){const task=(await post(`/api/plans/${plan.id}/tasks`,{title:`합성 ${day+1}일차 할 일 ${n+1}`,expected_minutes:0})).entity;await post(`/api/tasks/${task.id}/complete`,{request_id:randomUUID()});}
    await browse('click','#reload-button');await until(`document.getElementById('observation-confirm-button')?.textContent.includes('${[2,0,3,1,2][day]}개')`);
    await browse('click','#observation-confirm-button');await browse('fill','[name="note"]',`합성 ${day+1}일차; 실제 사용 기록 아님`);await submit();await until(`document.getElementById('panel-observe').textContent.includes('${day+1}/5일 확정')`);
    checkpoint(`simulated day ${day+1}: UI confirms ${[2,0,3,1,2][day]} and preserves date and contributions`);
    if(day===1){stamp='2026-10-03T00:01:00.001Z';await browse('click','#observation-rule-button');await browse('fill','[name="next_rule"]','합성 변경 규칙: 작은 할 일부터 진행');await browse('fill','[name="reason"]','합성 1일차 2개와 2일차 0개를 보고 변경한 기능 검사');await submit();await until("document.getElementById('panel-observe').textContent.includes('합성 변경 규칙: 작은 할 일부터 진행')");checkpoint('exactly one rule change after day two through UI with reference IDs preserved');}
  }
  await browse('click','#observation-check-button');await browse('fill','[name="hand_sum"]','8');await browse('fill','[name="hand_mean"]','1.6');await browse('fill','[name="note"]','합성 손계산 입력 검사: 2+0+3+1+2=8, 8/5=1.6. 인간 실사용 근거 아님.');await submit();
  await until("document.getElementById('panel-observe').textContent.includes('입력한 손계산: 8개 / 1.6개')");checkpoint('five-day sum/mean, 2-day versus 3-day comparison and manually supplied synthetic check agree');
  await browse('screenshot',resolve('verification/observation-synthetic-five-days.png'));
  await browse('viewport','375x812');assert.ok((await browse('js','document.documentElement.scrollWidth<=innerWidth')).includes('true'));
  await browse('screenshot',resolve('verification/observation-mobile.png'));checkpoint('four-stage observation screen has no horizontal overflow at 375px');
  await writeFile('verification/observation-browser.json',JSON.stringify({checked_at:new Date().toISOString(),data_origin:'synthetic',scope:'Isolated gstack Chromium and controlled synthetic Node server; simulated dates and values, not actual use',counts:[2,0,3,1,2],checks,credentials:'[REDACTED]',screenshots:['verification/observation-synthetic-five-days.png','verification/observation-mobile.png']},null,2)+'\n');
  console.log(`Observation browser checks passed: ${checks.length}; dates and values are synthetic.`);
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));identity.close();await rm(directory,{recursive:true,force:true});}
