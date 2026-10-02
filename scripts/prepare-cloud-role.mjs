// Writes a random dedicated DB credential only to ignored local env storage.
// SQL bootstrap contains its SCRAM verifier, never the password itself.
import { randomBytes,pbkdf2Sync,createHmac,createHash } from 'node:crypto';
import { mkdirSync,writeFileSync,existsSync } from 'node:fs';
const path='.env.cloud.local';
if(existsSync(path))throw Error('Cloud credentials already exist; do not silently rotate them.');
const password=randomBytes(32).toString('base64url');const salt=randomBytes(16);
const salted=pbkdf2Sync(password,salt,4096,32,'sha256');
const clientKey=createHmac('sha256',salted).update('Client Key').digest();
const storedKey=createHash('sha256').update(clientKey).digest('base64');
const serverKey=createHmac('sha256',salted).update('Server Key').digest('base64');
const verifier=`SCRAM-SHA-256$4096:${salt.toString('base64')}$${storedKey}:${serverKey}`;
mkdirSync('.test-data/cloud',{recursive:true});
writeFileSync(path,`T07_PROJECT_REF=vagluzmvitdtshjknxrp\nT07_PG_HOST=aws-0-ap-northeast-2.pooler.supabase.com\nT07_PG_PORT=6543\nT07_PG_USER=t07_server.vagluzmvitdtshjknxrp\nT07_PG_PASSWORD=${password}\n`);
const sql=`CREATE ROLE t07_server LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${verifier}';\nGRANT CONNECT ON DATABASE postgres TO t07_server;\n`;
writeFileSync('.test-data/cloud/role-bootstrap.sql',sql);
console.log('Dedicated credential written to ignored .env.cloud.local; SQL contains a SCRAM verifier only.');
