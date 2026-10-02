import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile,mkdtemp,rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteStore } from '../src/store-sqlite.mjs';
import { validateLegacyExport, legacyDigest, LEGACY_TABLES } from '../src/migration.mjs';
const evidence=[];
after(async()=>writeFile('verification/migration-local.json',JSON.stringify({checked_at:new Date().toISOString(),data_origin:'synthetic',scope:'Generated synthetic T06-shaped fixture into isolated in-memory databases; not real user migration',checks:evidence},null,2)+'\n'));
const planInput={title:'합성 이전 계획',description:'실사용 아님',start_date:'2026-10-02',end_date:'2026-10-06',priority:'medium',success_criteria:'7표 이관 검사',expected_minutes:10};
async function fixture(t){
  const source=createSqliteStore({filename:':memory:',clock:()=> '2026-10-02T00:00:00.000Z',recordOrigin:'synthetic'});t.after(()=>source.close());
  const plan=(await source.mutate('plan.create',planInput)).entity;
  const task=(await source.mutate('task.create',{plan_id:plan.id,title:'합성 할 일',expected_minutes:3})).entity;
  await source.mutate('task.complete',{id:task.id,request_id:randomUUID()});
  await source.mutate('execution.create',{task_id:task.id,started_at:'2026-10-02T00:00:00Z',ended_at:'2026-10-02T00:01:00Z',actual_minutes:1});
  const review=(await source.mutate('review.create',{plan_id:plan.id,improvement:'합성 개선'})).entity;
  await source.mutate('review.next-plan',{id:review.id,...planInput});
  const exported={schema_version:2,timezone:'Asia/Seoul',time_unit:'minutes',record_origin:'synthetic',exported_at:'2026-10-02T00:00:00Z',...await source.state()};
  const target=createSqliteStore({filename:':memory:',recordOrigin:'synthetic'});t.after(()=>target.close());return {source,target,exported};
}
test('one atomic migration preserves all seven tables, IDs, timestamps, values, JSON and cyclic review links',async t=>{
  const f=await fixture(t);const original=await f.source.state();const preview=validateLegacyExport(f.exported);
  const result=await f.target.importLegacy(f.exported,preview.source_digest);assert.equal(result.imported,true);assert.deepEqual(await f.target.state(),original);
  const receipt=(await f.target.exportState()).migration_receipts[0];assert.equal(receipt.source_digest,preview.source_digest);assert.deepEqual(receipt.counts,preview.counts);
  const before=await f.target.exportState();await assert.rejects(()=>f.target.importLegacy(f.exported,preview.source_digest),{status:409});assert.deepEqual(await f.target.exportState(),before);
  assert.deepEqual(await f.source.state(),original);
  evidence.push({name:'atomic-seven-table-import',counts:preview.counts,source_digest:preview.source_digest,all_ids_dates_values_and_relationships_preserved:true,source_unchanged:true,repeat_import_denied:true});
});
test('preview rejects broken relationships, invalid dates, unknown columns and duplicates without modifying destination',async t=>{
  const f=await fixture(t);const before=await f.target.exportState();
  for (const corrupt of [data=>{data.tasks[0].plan_id=randomUUID();},data=>{data.plans[0].start_date='2026-02-30';},data=>{data.tasks[0].owner_id=randomUUID();},data=>{data.tasks.push(data.tasks[0]);},data=>{data.plan_history[0].snapshot.id=randomUUID();}]){
    const invalid=structuredClone(f.exported);corrupt(invalid);assert.throws(()=>validateLegacyExport(invalid),{status:400});await assert.rejects(()=>f.target.importLegacy(invalid,'invalid'),{status:400});
    assert.deepEqual(await f.target.exportState(),before);
  }
  evidence.push({name:'invalid-source-no-mutation',rejected:['foreign key','invalid calendar date','unknown owner column','duplicate ID','history snapshot mismatch'],destination_unchanged:true});
});
test('nonempty destination and modified data after preview are denied while row order does not change digest',async t=>{
  const f=await fixture(t);const preview=validateLegacyExport(f.exported);
  const reordered=structuredClone(f.exported);for(const name of LEGACY_TABLES)reordered[name].reverse();assert.equal(legacyDigest(reordered),preview.source_digest);
  const changed=structuredClone(f.exported);changed.tasks[0].notes='미리보기 이후 변경';await assert.rejects(()=>f.target.importLegacy(changed,preview.source_digest),{status:409});
  await f.target.mutate('plan.create',planInput);const before=await f.target.exportState();await assert.rejects(()=>f.target.importLegacy(f.exported,preview.source_digest),{status:409});assert.deepEqual(await f.target.exportState(),before);
  evidence.push({name:'preview-and-empty-destination',modified_source_denied:true,nonempty_destination_preserved:true,canonical_digest_ignores_row_order:true});
});
test('a database failure after earlier table inserts rolls back every imported row and the migration receipt',async t=>{
  const f=await fixture(t);const directory=await mkdtemp(join(tmpdir(),'t07-import-rollback-'));const filename=join(directory,'synthetic.sqlite');
  const target=createSqliteStore({filename,recordOrigin:'synthetic'});t.after(async()=>{await target.close();await rm(directory,{recursive:true,force:true});});
  const db=new DatabaseSync(filename);db.exec("CREATE TRIGGER simulated_import_failure BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT,'synthetic_storage_failure'); END;");db.close();
  const before=await target.exportState();const preview=validateLegacyExport(f.exported);
  await assert.rejects(()=>target.importLegacy(f.exported,preview.source_digest),{status:500});assert.deepEqual(await target.exportState(),before);
  evidence.push({name:'failed-import-rollback',fault:'synthetic task insertion failure after plans/history were inserted',all_tables_and_receipt_unchanged:true});
});
