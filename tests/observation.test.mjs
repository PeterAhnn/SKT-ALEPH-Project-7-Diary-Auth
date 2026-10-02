import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteStore } from '../src/store-sqlite.mjs';
import { observationSummary, OBSERVATION_RULES } from '../public/observation-core.mjs';

const evidence=[];
after(async()=>writeFile('verification/observation-local.json',JSON.stringify({checked_at:new Date().toISOString(),data_origin:'synthetic',scope:'Isolated SQLite with explicitly simulated server clock; not actual five-day use',checks:evidence},null,2)+'\n'));
const planInput={title:'합성 관찰 계획',description:'실사용 아님',start_date:'2026-10-02',end_date:'2026-10-10',priority:'medium',success_criteria:'순서·개수 검사',expected_minutes:0};
async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'t07-observation-')); const file=join(dir,'synthetic.sqlite');
  let stamp='2026-10-02T00:00:00.000Z';
  let store=createSqliteStore({filename:file,clock:()=>stamp,recordOrigin:'synthetic'});
  t.after(async()=>{await store.close();await rm(dir,{recursive:true,force:true});});
  const plan=(await store.mutate('plan.create',planInput)).entity;
  return {file,plan,get store(){return store;},advance(ms){stamp=new Date(new Date(stamp).getTime()+ms).toISOString();},set(value){stamp=value;},async restart(){await store.close();store=createSqliteStore({filename:file,clock:()=>stamp,recordOrigin:'synthetic'});},async task(){return (await store.mutate('task.create',{plan_id:plan.id,title:'합성 할 일',expected_minutes:0})).entity;},async complete(task){return store.mutate('task.complete',{id:task.id,request_id:randomUUID()});},async start(changes={}){return (await store.mutateObservation('start',{plan_id:plan.id,question:'합성 규칙 검사 질문',first_rule:'합성 첫 규칙',accept_rules:true,...changes})).entity;},async day(study,date,note='합성 날짜 확인'){return (await store.mutateObservation('day',{id:study.id,expected_date:date,note})).entity;}};
}
test('starting observation freezes the selected metric/rules and rejects false consent, owner hints, repeats and historical plans',async t=>{
  const f=await fixture(t);
  await assert.rejects(()=>f.start({accept_rules:false}),{status:400});
  await assert.rejects(()=>f.start({unit:'분'}),{status:400});
  await assert.rejects(()=>f.start({user_id:randomUUID()}),{status:400});
  const study=await f.start(); assert.deepEqual(study.rules,OBSERVATION_RULES);
  await assert.rejects(()=>f.start(),{status:409});
  const db=new DatabaseSync(f.file);
  assert.throws(()=>db.prepare('UPDATE observation_studies SET question=? WHERE id=?').run('위조 변경',study.id),/immutable_history/); db.close();
  const g=await fixture(t);await g.complete(await g.task());await assert.rejects(()=>g.start(),{status:409});
  evidence.push({name:'frozen-setup',metric:study.rules.metric,unit:study.rules.unit,unknown_fields_rejected:true,immutable:true,past_completions_not_reclassified:true});
});
test('five distinct dates enforce one rule change and keep deduplicated contributions, zero, comparisons and manual check',async t=>{
  const f=await fixture(t);const study=await f.start();
  const first=await f.task(); const second=await f.task(); const pending=await f.task();
  await f.complete(first);await f.complete(first); await f.store.mutate('task.reopen',{id:first.id,request_id:randomUUID()});await f.complete(first);await f.complete(second);
  await f.store.mutate('task.delete',{id:first.id});
  const day1=await f.day(study,'2026-10-02');assert.equal(day1.count,2);assert.equal(day1.contribution.event_ids.length,3);
  await assert.rejects(()=>f.day(study,'2026-10-02'),{status:409});await assert.rejects(()=>f.complete(pending),{status:409});
  await assert.rejects(()=>f.store.mutateObservation('rule',{id:study.id,next_rule:'새 규칙',reason:'합성',day_one_id:day1.id,day_two_id:randomUUID()}),{status:409});
  f.advance(86400000);const day2=await f.day(study,'2026-10-03');assert.equal(day2.count,0);
  f.advance(86400000);await assert.rejects(()=>f.complete(pending),{status:409});await assert.rejects(()=>f.day(study,'2026-10-04'),{status:409});
  await assert.rejects(()=>f.store.mutateObservation('rule',{id:study.id,next_rule:'새 규칙',reason:'합성',day_one_id:randomUUID(),day_two_id:day2.id}),{status:400});
  const change=(await f.store.mutateObservation('rule',{id:study.id,next_rule:'합성 변경 규칙',reason:'합성 1일차 2개, 2일차 0개를 참조',day_one_id:day1.id,day_two_id:day2.id})).entity;
  await assert.rejects(()=>f.store.mutateObservation('rule',{id:study.id,next_rule:'두 번째 변경',reason:'합성',day_one_id:day1.id,day_two_id:day2.id}),{status:409});
  f.advance(1);
  for (const [date,count] of [['2026-10-04',3],['2026-10-05',1],['2026-10-06',2]]) {
    for(let n=0;n<count;n++)await f.complete(await f.task()); await f.day(study,date);
    f.advance(86400000);
  }
  const saved=await f.store.observationState();const summary=observationSummary(saved,study.id);
  assert.deepEqual(summary.days.map(row=>row.count),[2,0,3,1,2]);assert.equal(summary.complete,true);
  assert.deepEqual(summary.total,{days:5,sum:8,mean:1.6,mean_display:'1.6'});assert.equal(summary.before.mean_display,'1.0');assert.equal(summary.after.mean_display,'2.0');
  await assert.rejects(()=>f.day(study,'2026-10-07'),{status:409});await assert.rejects(()=>f.complete(pending),{status:409});
  await assert.rejects(()=>f.store.mutateObservation('check',{id:study.id,hand_sum:9,hand_mean:'1.8',note:'합성 잘못된 계산'}),{status:400});
  const checked=(await f.store.mutateObservation('check',{id:study.id,hand_sum:8,hand_mean:'1.6',note:'합성 계산: 2+0+3+1+2=8, 8/5=1.6'})).entity;
  const exported=await f.store.exportState();assert.equal(exported.observation_days.length,5);assert.equal(exported.observation_changes.length,1);assert.equal(exported.observation_checks.length,1);
  assert.ok(change.created_at>day2.created_at && change.created_at<summary.days[2].created_at);
  const before=await f.store.observationState();await f.restart();assert.deepEqual(await f.store.observationState(),before);
  evidence.push({name:'five-day-sequence',dates:summary.days.map(row=>row.date),counts:summary.days.map(row=>row.count),total:summary.total,before:summary.before,after:summary.after,change,manual_check:checked,same_day_duplicate_completion_deduplicated:true,zero_explicitly_confirmed:true,deleted_task_contributes_to_past_count:true,sixth_day_denied:true,rule_change_once:true,restart_preserved:true});
});
test('server Korean date rejects backdating and changes at UTC 15:00 while missing remains distinct from confirmed zero',async t=>{
  const f=await fixture(t);f.set('2026-10-02T14:59:55.000Z');const study=await f.start();
  await assert.rejects(()=>f.day(study,'2026-10-01'),{status:409});
  assert.equal(observationSummary(await f.store.observationState(),study.id).total.mean,null);
  const day1=await f.day(study,'2026-10-02');assert.equal(day1.count,0);
  f.advance(5000);const day2=await f.day(study,'2026-10-03');assert.equal(day2.count,0);
  assert.equal(observationSummary(await f.store.observationState(),study.id).total.mean,0);
  const g=await fixture(t);const missed=await g.start();g.advance(86400000);await assert.rejects(()=>g.day(missed,'2026-10-03'),{status:409});
  evidence.push({name:'server-date-and-missing',utc_boundary:'15:00',distinct_korean_dates:[day1.date,day2.date],missing_mean:null,confirmed_zero_mean:0,backdating_rejected:true,missed_initial_date_requires_new_study:true});
});
test('day, rule and manual rows are immutable and post-confirmation task edits/deletion do not rewrite history',async t=>{
  const f=await fixture(t);const study=await f.start();const task=await f.task();await f.complete(task);const day=await f.day(study,'2026-10-02');
  await f.store.mutate('task.delete',{id:task.id});assert.deepEqual((await f.store.observationState()).observation_days[0],day);
  const db=new DatabaseSync(f.file);assert.throws(()=>db.prepare('DELETE FROM observation_days WHERE id=?').run(day.id),/immutable_history/);assert.throws(()=>db.prepare('UPDATE observation_days SET count=99 WHERE id=?').run(day.id),/immutable_history/);db.close();
  evidence.push({name:'immutable-day-contributions',original_count:1,after_delete_count:1,direct_sql_change_denied:true});
});
