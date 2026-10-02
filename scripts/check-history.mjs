import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
process.loadEnvFile('.env.cloud.local');process.loadEnvFile('.env.local');
const keys=['T07_PG_PASSWORD','VERCEL_OIDC_TOKEN'];
const secrets=keys.map(x=>process.env[x]).filter(x=>x?.length>16);
const list=spawnSync('git',['rev-list','--objects','HEAD'],{encoding:'utf8'});assert.equal(list.status,0);
const ids=list.stdout.trim().split('\n').map(x=>x.split(' ')[0]);
const data=spawnSync('git',['cat-file','--batch'],{input:ids.join('\n')+'\n',maxBuffer:64*1024*1024});assert.equal(data.status,0);
let position=0,blobs=0;
while(position<data.stdout.length){const end=data.stdout.indexOf(10,position);const header=data.stdout.subarray(position,end).toString();const [,type,size]=header.split(' ');const length=Number(size);assert.ok(Number.isSafeInteger(length));const content=data.stdout.subarray(end+1,end+1+length);position=end+length+2;if(type!=='blob')continue;blobs++;for(const secret of secrets)assert.ok(!content.includes(Buffer.from(secret)),'Known deployment credential appears in Git blob; value omitted.');}
const report={checked_at:new Date().toISOString(),scope:'All reachable HEAD Git blobs scanned against exact local T07 DB password and Vercel OIDC token; not an exhaustive detector of unknown secret types',git_objects:ids.length,blobs,known_credential_values_found:0,credentials:'[EXCLUDED]'};
await writeFile('verification/history-secret-check.json',JSON.stringify(report,null,2)+'\n');console.log(`Git history known-credential check passed: ${blobs} blobs.`);
