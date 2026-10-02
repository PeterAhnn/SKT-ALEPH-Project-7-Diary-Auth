// Uses the existing Git credential helper, without printing or persisting its token.
import { spawnSync } from 'node:child_process';
const credentials=spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',timeout:20000,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}});
if(credentials.status!==0){console.error('Existing Git authentication unavailable; credential details omitted.');process.exit(1);}
const fields=Object.fromEntries(credentials.stdout.trim().split(/\r?\n/).map(line=>[line.slice(0,line.indexOf('=')),line.slice(line.indexOf('=')+1)]));
if(!fields.password)throw Error('No existing Git credential available.');
const result=spawnSync('gh',process.argv.slice(2),{encoding:'utf8',env:{...process.env,GH_TOKEN:fields.password},timeout:120000});
for(const output of [result.stdout,result.stderr])if(output){if(output.includes(fields.password))throw Error('Unsafe output suppressed.');process.stdout.write(output);}
process.exit(result.status??1);
