import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['public', 'src', 'api', 'scripts', 'tests', 'db', 'docs', 'contracts', 'records', 'verification'];
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return (await Promise.all(entries.map(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))).flat();
}
const rootFiles = ['server.mjs', 'README.md', 'HANDOFF.md', 'AGENTS.md', 'SKT-ALEPH-project-guide.md', 'ALEPH-SUBMISSION-TEMPLATE.md', 'ALEPH-TASK-READBACK-TEMPLATE.md', 'package.json', 'package-lock.json', 'vercel.json', '.env.example'];
const files = [...rootFiles.filter(existsSync), ... (await Promise.all(roots.map(walk))).flat()].filter(file => /\.(?:mjs|html|css|sql|json|md|txt)$/.test(file) || file === '.env.example');
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
if (existsSync('.env.cloud.local')) process.loadEnvFile('.env.cloud.local');
const taskSecrets = ['VERCEL_OIDC_TOKEN', 'T07_PG_PASSWORD'].map(key => [key, process.env[key]]).filter(([,value]) => value?.length > 16);
let failures = 0;
for (const file of files) {
  const source = await readFile(file, 'utf8');
  for (const [key,value] of taskSecrets) if (source.includes(value)) { console.error(`${file}: ${key} credential detected (value omitted)`); failures++; }
  if (file.endsWith('.mjs')) {
    const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (checked.status !== 0) { console.error(checked.stderr); failures++; }
  }
  for (const [label, expression] of [
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['Supabase secret', /sb_secret_[A-Za-z0-9_-]{16,}/],
    ['GitHub token', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
    ['database credentials', /postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@/]
  ]) if (expression.test(source)) { console.error(`${relative('.', file)}: ${label} detected (value omitted)`); failures++; }
  if (file.startsWith('public') && /\b(?:SUPABASE_PUBLISHABLE_KEY|SUPABASE_SERVICE_ROLE_KEY|sb_secret_)\b/.test(source)) {
    console.error(`${file}: server configuration in client source`); failures++;
  }
}
if (failures) process.exitCode = 1;
else console.log(`Source check passed: syntax and credential patterns in ${files.length} files. This scan cannot prove absence of every possible secret.`);
