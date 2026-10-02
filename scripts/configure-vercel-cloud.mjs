import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
process.loadEnvFile('.env.cloud.local');
const project=JSON.parse(readFileSync('.vercel/project.json','utf8'));
assert.equal(project.projectName,'skt-aleph-project-7-diary-auth');
assert.equal(process.env.T07_PROJECT_REF,'vagluzmvitdtshjknxrp');
const cli=process.env.T07_VERCEL_CLI;
assert.ok(cli,'Set T07_VERCEL_CLI to the verified installed Vercel CLI entry.');
for(const key of ['T07_PROJECT_REF','T07_PG_HOST','T07_PG_PORT','T07_PG_USER','T07_PG_PASSWORD','T07_PG_CA']){
 assert.ok(process.env[key]);
 const result=spawnSync(process.execPath,[cli,'env','add',key,'production,preview','--sensitive','--yes'],{input:process.env[key]+'\n',encoding:'utf8',timeout:30000});
 // CLI output may contain user input, so never print it, including on failure.
 assert.equal(result.status,0,`Environment key ${key} was not configured; raw CLI output omitted.`);
 console.log(`Encrypted environment configured: ${key}`);
}
