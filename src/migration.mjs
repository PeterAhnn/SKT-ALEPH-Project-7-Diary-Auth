import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { problem } from './validation.mjs';

export const LEGACY_TABLES = ['plans','plan_history','tasks','executions','completion_events','request_receipts','reviews'];
const jsonColumns = { tags: 'tags_json', snapshot: 'snapshot_json', response: 'response_json' };
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function legacyDigest(data) {
  const sorted = Object.fromEntries(LEGACY_TABLES.map(table => [table, [...data[table]].sort((a,b) => (a.id || a.request_id).localeCompare(b.id || b.request_id))]));
  return createHash('sha256').update(JSON.stringify(canonical(sorted))).digest('hex');
}
export function insertLegacyRows(db, exported) {
  db.exec('PRAGMA defer_foreign_keys=ON');
  for (const table of LEGACY_TABLES) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
    for (const row of exported[table]) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('row');
      const encoded = Object.fromEntries(Object.entries(row).map(([key,value]) => Object.hasOwn(jsonColumns,key) ? [jsonColumns[key], JSON.stringify(value)] : [key,value]));
      if (Object.keys(encoded).length !== columns.length || Object.keys(encoded).some(key => !columns.includes(key))) throw new Error('columns');
      for (const [key,value] of Object.entries(encoded)) {
        if (key === 'id' || key.endsWith('_id')) {
          if (value !== null && (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))) throw new Error('id');
        }
        if (['start_date','end_date','due_date'].includes(key) && value !== null) {
          if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value+'T00:00:00Z').toISOString().slice(0,10) !== value) throw new Error('date');
        }
        if (['created_at','updated_at','completed_at','started_at','ended_at','deleted_at'].includes(key) && value !== null && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(new Date(value).getTime()))) throw new Error('timestamp');
      }
      db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...columns.map(key=>encoded[key]));
    }
  }
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('foreign keys');
  for (const history of exported.plan_history) if (history.snapshot?.id !== history.plan_id || history.snapshot?.version !== history.version) throw new Error('history snapshot');
  for (const receipt of exported.request_receipts) if (receipt.response?.entity?.id !== receipt.resource_id) throw new Error('receipt');
}
export function validateLegacyExport(exported) {
  if (!exported || exported.schema_version !== 2 || exported.timezone !== 'Asia/Seoul' || exported.time_unit !== 'minutes' || !LEGACY_TABLES.every(table => Array.isArray(exported[table]))) throw problem(400, 'T06 전체 7표·한국 시간·분 단위의 schema_version 2 JSON을 선택해 주세요.', 'VALIDATION');
  if (exported.exported_at !== undefined && (typeof exported.exported_at !== 'string' || !Number.isFinite(new Date(exported.exported_at).getTime()))) throw problem(400,'이관 파일의 내보낸 시각을 확인해 주세요.','VALIDATION');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(new URL('../db/sqlite.sql', import.meta.url), 'utf8'));
    db.exec('BEGIN'); insertLegacyRows(db, exported); db.exec('COMMIT');
  } catch { throw problem(400, '이관 자료의 필드·날짜·ID·중복·표 관계를 확인해 주세요. 현재 자료는 변경하지 않았습니다.', 'VALIDATION'); }
  finally { db.close(); }
  return { source_digest: legacyDigest(exported), counts: Object.fromEntries(LEGACY_TABLES.map(table => [table, exported[table].length])), source_exported_at: exported.exported_at ?? null, source_record_origin: exported.record_origin ?? 'unspecified' };
}
export function importLegacy({ db, transaction, now, exported, expectedDigest }) {
  const preview = validateLegacyExport(exported);
  if (expectedDigest !== preview.source_digest) throw problem(409, '미리보기 이후 파일 내용이 달라졌습니다. 다시 확인해 주세요.', 'CONFLICT');
  return transaction(() => {
    const tables = [...LEGACY_TABLES,'observation_studies','observation_days','observation_changes','observation_checks','migration_receipts'];
    if (tables.some(table => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n)) throw problem(409, '이관은 비어 있는 내 계정에만 가능합니다. 기존 자료를 덮어쓰지 않습니다.', 'CONFLICT');
    insertLegacyRows(db, exported);
    const receipt = { id: randomUUID(), source_digest: preview.source_digest, source_exported_at: preview.source_exported_at, counts_json: JSON.stringify(preview.counts), created_at: now() };
    db.prepare('INSERT INTO migration_receipts VALUES (?,?,?,?,?)').run(receipt.id, receipt.source_digest, receipt.source_exported_at, receipt.counts_json, receipt.created_at);
    return { imported: true, receipt: { ...receipt, counts: preview.counts, counts_json: undefined } };
  });
}
