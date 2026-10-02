import { DatabaseSync } from 'node:sqlite';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createSqliteStore } from '../src/store-sqlite.mjs';
import { createIdentityStore } from '../src/identity-sqlite.mjs';
import { OBSERVATION_RULES } from '../public/observation-core.mjs';
const prefix=join(tmpdir(),'t07-contract-');
const directory=await mkdtemp(prefix);
assert.ok(resolve(directory).startsWith(resolve(prefix)));
const diaryFile=join(directory,'diary.sqlite');
const diary=createSqliteStore({filename:diaryFile,recordOrigin:'synthetic'});
const identity=createIdentityStore({directory:join(directory,'identity'),recordOrigin:'synthetic'});
await diary.close();identity.close();
function catalog(filename){
  const db=new DatabaseSync(filename,{readOnly:true});
  try{return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>({name,columns:db.prepare(`PRAGMA table_info("${name}")`).all(),foreign_keys:db.prepare(`PRAGMA foreign_key_list("${name}")`).all(),indexes:db.prepare(`PRAGMA index_list("${name}")`).all(),immutable_triggers:db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=? ORDER BY name").all(name).map(row=>row.name)}));}finally{db.close();}
}
try{
 const contract={schema_version:3,task:'T07',generated_at:new Date().toISOString(),actual_engine:'SQLite through Node node:sqlite',scope:'Local implementation schema extracted from isolated empty databases; not production PostgreSQL catalog',ownership:'Authenticated server UUID selects one account diary file; client ownership hints do not select a file',inherited_diary_contract:'contracts/pds-schema-v2.json preserves historical T06 production contract',source_files:['src/identity-sqlite.mjs','db/sqlite.sql','db/observation.sql','src/observation-store.mjs'],identity_tables:catalog(join(directory,'identity','identity.sqlite')),account_tables:catalog(diaryFile),export:{schema_version:3,identity_or_sessions_exported:false,diary_tables:7,observation_tables:['observation_studies','observation_days','observation_changes','observation_checks'],migration_tables:['migration_receipts'],time_unit:'minutes',observation_unit:'개',timezone:'Asia/Seoul'},observation_rules:OBSERVATION_RULES,day_confirmation:'Only the server Korean current date. A day is immutable after confirmation; no additional completion may be inserted on a sealed date.',rule_change:'Exactly once after confirmed day 2 and before day 3 completion/confirmation; references exact day 1/day 2 IDs.',migration:'T06 schema_version 2, seven tables; preview canonical SHA256; validated foreign keys and row columns; all-or-nothing insert into empty account only.'};
 await writeFile('contracts/t07-schema-v3.json',JSON.stringify(contract,null,2)+'\n');
 console.log(`T07 contract written: ${contract.identity_tables.length} identity tables, ${contract.account_tables.length} account tables.`);
}finally{await rm(directory,{recursive:true,force:true});}
