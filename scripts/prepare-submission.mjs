import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';

// This prepares review files only. It neither changes diary records nor submits.
const commit = process.argv[2];
if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit ?? '')) {
  throw new Error('Pass a verified lowercase full commit hash.');
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (git('rev-parse', `${commit}^{commit}`) !== commit) throw new Error('Commit mismatch');
git('merge-base', '--is-ancestor', 'b9de0298cd200961eac56286c6a6a55299947a96', commit);
const repo = 'https://github.com/PeterAhnn/SKT-ALEPH-Project-7-Diary-Auth';
const result = 'https://skt-aleph-project-7-diary-auth.vercel.app/';
const source = `${repo}/commit/${commit}`;
const actual = JSON.parse(git('show', `${commit}:verification/observation-restart-20261006.json`));
const submission = git('show', `${commit}:docs/SUBMISSION.md`);
const section = title => {
  const body = submission.split(`## ${title}\n`)[1];
  if (!body) throw new Error(`Missing section: ${title}`);
  return body.split('\n## ')[0].trim().split('\n')
    .filter(line => line.startsWith('- ')).map(line => line.slice(2)).join('\n');
};
const confirmation = section('재현·통과 확인 4가지 (권장)');
const judgment = section('AI와 내 판단 3줄 (권장)');
for (const [name, value, count] of [['confirmation', confirmation, 4], ['judgment', judgment, 3]]) {
  if (value.length > 1500 || value.split('\n').length !== count) throw new Error(`${name} format/length`);
}
if (!judgment.includes('직접 확인하고 수정')) throw new Error('Human answer missing');
let explanation = git('show', `${commit}:docs/AUTH-IMPLEMENTATION.md`);
if ((explanation.match(/^## [①②③④⑤⑥]/gm) ?? []).length !== 6) throw new Error('Six sections missing');
explanation = explanation.replace(/\]\((\.{1,2}\/[^)]+)\)/g, (_, relative) => {
  const target = posix.normalize(posix.join('docs', relative));
  if (target.startsWith('../')) throw new Error('Link outside repository');
  git('cat-file', '-e', `${commit}:${target}`);
  return `](${repo}/blob/${commit}/${target})`;
});
const report = `# T07 인증 구현 설명서 · 제출 준비본\n\n**미제출·실제 관찰 미완료.** ${actual.client_review_date} 실제 계정 export 확인: 확정 ${actual.confirmed_days}/5일, 할 일 ${actual.observation_plan_tasks}개, 규칙 변경 ${actual.rule_changes}건, 손계산 ${actual.manual_checks}건. 기존 기록을 보존하고 오늘 새 관찰을 시작했다. 등록한 할 일은 미완료 계획이며 합성 검사를 실제 5일로 세지 않는다.\n\n결과물 URL (필수): ${result}\n\n소스 저장소 URL (필수): ${source}\n\n${explanation}\n\n## 재현·통과 확인 4가지\n\n${confirmation}\n\n## AI와 내 판단 3줄\n\n${judgment}\n`;
const paste = `T07 미제출 준비본 — 실제 5일 최종 확인 전 제출하지 않음\n\n결과물 URL (필수)\n${result}\n\n소스 저장소 URL (필수)\n${source}\n\n재현·통과 확인 4가지\n${confirmation}\n\nAI와 내 판단 3줄\n${judgment}\n`;
for (const file of ['.env.local', '.env.cloud.local']) if (existsSync(file)) process.loadEnvFile(file);
const known = ['VERCEL_OIDC_TOKEN', 'T07_PG_PASSWORD'].map(k => process.env[k]).filter(v => v?.length > 16);
for (const privatePath of ['.test-data/user-evidence/card-5-current-export-20261002.json', '.test-data/user-evidence/card-5-current-export-20261006.json', '.test-data/user-evidence/observation-restart-export-20261006.json']) if (existsSync(privatePath)) {
  const data = JSON.parse(await readFile(privatePath, 'utf8'));
  for (const study of data.observation_studies ?? []) {
    for (const key of ['id', 'plan_id', 'user_id']) if (study[key]) known.push(study[key]);
  }
}
for (const value of [report, paste]) {
  if (known.some(secret => value.includes(secret))) throw new Error('Known private value detected; value omitted');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sb_secret_[A-Za-z0-9_-]{16,}|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{30,}|postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@/.test(value)) {
    throw new Error('Credential pattern detected; value omitted');
  }
}
const out = '.test-data/submission-prep';
await mkdir(out, { recursive: true });
const files = [['T07-AUTH-EXPLANATION-DRAFT.md', report], ['T07-PASTE-FIELDS.txt', paste]];
const metadata = [];
for (const [name, value] of files) {
  const bytes = Buffer.byteLength(value);
  await writeFile(`${out}/${name}`, value, 'utf8');
  metadata.push({ name, bytes, sha256: createHash('sha256').update(value).digest('hex') });
}
const manifest = {
  prepared_at: new Date().toISOString(), status: 'draft-not-submitted', source_commit: commit,
  result_url: result, source_url: source,
  confirmation_chars: confirmation.length, judgment_chars: judgment.length,
  optional_attachment: files[0][0], attachment_count: 1, attachment_bytes: metadata[0].bytes,
  attachment_limits_passed: metadata[0].bytes > 0 && metadata[0].bytes <= 8 * 1024 * 1024,
  six_explanation_sections: true, pinned_relative_links_resolve_in_git: true,
  known_credential_and_prior_study_identifier_scan_passed: true,
  scan_limit: 'Selected patterns and locally available known credential/prior study identifier values; not proof of absence of every secret.',
  actual_record_status: `${actual.client_review_date}: ${actual.confirmed_days}/5 confirmed days; actual observation incomplete.`,
  files: metadata
};
await writeFile(`${out}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
