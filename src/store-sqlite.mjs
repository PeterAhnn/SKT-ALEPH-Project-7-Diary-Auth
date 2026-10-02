import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { observationOperations } from './observation-store.mjs';
import { importLegacy } from './migration.mjs';

const TABLES = ['plans', 'plan_history', 'tasks', 'executions', 'completion_events', 'request_receipts', 'reviews'];
const PLAN_FIELDS = ['title', 'description', 'start_date', 'end_date', 'priority', 'success_criteria', 'expected_minutes'];
const TASK_FIELDS = ['title', 'notes', 'due_date', 'priority', 'expected_minutes'];
function failure(status, message) { return Object.assign(new Error(message), { status }); }
function text(value, limit, required = false) {
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) throw failure(400, '입력 항목의 내용이나 길이를 확인해 주세요.');
  return value;
}
function minutes(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1000000) throw failure(400, '시간은 허용 범위의 0 이상 정수로 입력해 주세요.');
  return value;
}
function date(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw failure(400, '날짜 형식을 확인해 주세요.');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw failure(400, '존재하는 날짜를 입력해 주세요.');
  return value;
}
function priority(value) {
  if (!['high', 'medium', 'low'].includes(value)) throw failure(400, '우선순위를 확인해 주세요.');
  return value;
}
function tags(value) {
  if (!Array.isArray(value) || value.length > 20) throw failure(400, '태그를 확인해 주세요.');
  return value.map(tag => text(tag, 40, true));
}
function planFields(payload) {
  const result = { title: text(payload.title, 160, true), description: text(payload.description ?? '', 4000), start_date: date(payload.start_date), end_date: date(payload.end_date), priority: priority(payload.priority ?? 'medium'), success_criteria: text(payload.success_criteria, 2000, true), expected_minutes: minutes(payload.expected_minutes ?? 0) };
  if (result.end_date < result.start_date) throw failure(400, '계획 종료일은 시작일 이후여야 합니다.');
  return result;
}
function taskFields(payload) {
  return { title: text(payload.title, 160, true), notes: text(payload.notes ?? '', 4000), due_date: date(payload.due_date ?? null, true), priority: priority(payload.priority ?? 'medium'), tags: tags(payload.tags ?? []), expected_minutes: minutes(payload.expected_minutes ?? 0) };
}
function decoded(row) {
  if (!row) return undefined;
  const value = { ...row };
  for (const [column, key] of [['tags_json', 'tags'], ['snapshot_json', 'snapshot'], ['response_json', 'response']]) {
    if (column in value) { value[key] = JSON.parse(value[column]); delete value[column]; }
  }
  return value;
}

export function createSqliteStore({ filename = '.data/diary.sqlite', clock = () => new Date().toISOString(), recordOrigin = 'user' } = {}) {
  if (!['user', 'synthetic'].includes(recordOrigin)) throw failure(400, '기록 종류 설정을 확인해 주세요.');
  const file = filename === ':memory:' ? filename : resolve(filename);
  let db;
  try {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    db = new DatabaseSync(file);
    db.exec(readFileSync(new URL('../db/sqlite.sql', import.meta.url), 'utf8'));
  } catch { db?.close(); throw failure(500, '저장소를 열지 못했습니다. 서버 설정을 확인해 주세요.'); }
  let closed = false;
  const now = () => {
    const value = new Date(clock());
    if (!Number.isFinite(value.getTime())) throw failure(500, '저장 시각을 확인하지 못했습니다.');
    return value.toISOString();
  };
  const find = (table, id) => decoded(db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id));
  const requireRow = (table, id, active = false) => {
    if (typeof id !== 'string' || !id.trim() || id.length > 128) throw failure(400, '기록 ID를 확인해 주세요.');
    const row = find(table, id);
    if (!row || (active && row.deleted_at)) throw failure(404, '해당 기록을 찾을 수 없습니다.');
    return row;
  };
  const version = (row, expected) => { if (!Number.isSafeInteger(expected) || row.version !== expected) throw failure(409, '다른 변경이 저장되었습니다. 최신 자료를 확인한 뒤 다시 시도해 주세요.'); };
  const insert = (table, value) => {
    const columns = Object.keys(value);
    db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(value));
  };
  const update = (table, id, value) => { db.prepare(`UPDATE ${table} SET ${Object.keys(value).map(key => `${key}=?`).join(',')} WHERE id=?`).run(...Object.values(value), id); };
  const history = plan => insert('plan_history', { id: randomUUID(), plan_id: plan.id, version: plan.version, snapshot_json: JSON.stringify(plan), created_at: plan.updated_at });
  const createPlan = (payload, stamp, fromReview = null) => {
    const plan = { id: randomUUID(), ...planFields(payload), version: 1, source_review_id: fromReview?.id ?? null, carried_improvement: fromReview?.improvement ?? '', record_origin: recordOrigin, created_at: stamp, updated_at: stamp };
    insert('plans', plan); history(plan); return plan;
  };
  function transaction(callback, write = true) {
    if (closed) throw failure(503, '저장소가 닫혀 있습니다.');
    try { db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN'); const result = callback(); db.exec('COMMIT'); return result; }
    catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* No open transaction after BEGIN failure. */ }
      if (error.status) throw error;
      if (/constraint|immutable_history/i.test(error.message)) throw failure(400, '자료 형식이나 연결된 기록을 확인해 주세요.');
      if (/locked|busy/i.test(error.message)) throw failure(409, '저장 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
      throw failure(500, '자료를 저장하지 못했습니다. 다시 시도해 주세요.');
    }
  }
  const diaryState = () => Object.fromEntries(TABLES.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY ${table === 'completion_events' ? 'completed_at' : 'created_at'}, ${table === 'request_receipts' ? 'request_id' : 'id'}`).all().map(decoded)]));
  const observation = observationOperations({ db, transaction, now, requireRow, recordOrigin, diaryState });
  return {
    kind: 'sqlite',
    async observationState() { return observation.state(); },
    async stateBundle() { return transaction(() => ({ data: diaryState(), observation: observation.snapshot() }), false); },
    async mutateObservation(action, input) { return observation.mutate(action, input); },
    async exportState() { return transaction(() => ({ ...diaryState(), ...observation.snapshot() }), false); },
    async importLegacy(exported, expectedDigest) { return importLegacy({ db, transaction, now, exported, expectedDigest }); },
    async state() {
      return transaction(diaryState, false);
    },
    async mutate(action, payload = {}) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw failure(400, '입력 자료를 확인해 주세요.');
      return transaction(() => {
        const stamp = now();
        if (action === 'plan.create') return { entity: createPlan(payload, stamp), changed: true };
        if (action === 'plan.update') {
          const current = requireRow('plans', payload.id); version(current, payload.expected_version);
          update('plans', current.id, { ...planFields({ ...current, ...Object.fromEntries(PLAN_FIELDS.filter(key => key in payload).map(key => [key, payload[key]])) }), version: current.version + 1, updated_at: stamp });
          const entity = find('plans', current.id); history(entity); return { entity, changed: true };
        }
        if (action === 'task.create') {
          requireRow('plans', payload.plan_id);
          const fields = taskFields(payload); const { tags: taskTags, ...rest } = fields;
          const task = { id: randomUUID(), plan_id: payload.plan_id, ...rest, tags_json: JSON.stringify(taskTags), status: 'pending', completion_cycle: 0, version: 1, deleted_at: null, record_origin: recordOrigin, created_at: stamp, updated_at: stamp };
          insert('tasks', task); return { entity: decoded(task), changed: true };
        }
        if (action === 'task.update') {
          const current = requireRow('tasks', payload.id, true); version(current, payload.expected_version);
          const { tags: taskTags, ...fields } = taskFields({ ...current, ...Object.fromEntries([...TASK_FIELDS, 'tags'].filter(key => key in payload).map(key => [key, payload[key]])) });
          update('tasks', current.id, { ...fields, tags_json: JSON.stringify(taskTags), version: current.version + 1, updated_at: stamp });
          return { entity: find('tasks', current.id), changed: true };
        }
        if (action === 'task.complete' || action === 'task.reopen') {
          text(payload.request_id, 128, true);
          const receipt = db.prepare('SELECT * FROM request_receipts WHERE request_id=?').get(payload.request_id);
          if (receipt) {
            if (receipt.action !== action || receipt.resource_id !== payload.id) throw failure(409, '요청 식별자가 다른 작업에 사용되었습니다. 새 요청으로 다시 시도해 주세요.');
            return { ...JSON.parse(receipt.response_json), replayed: true };
          }
          const current = requireRow('tasks', payload.id, true); let changed = false; let event;
          if (action === 'task.complete') {
            if (current.status === 'pending') {
              observation.guardCompletion(current, stamp);
              event = { id: randomUUID(), task_id: current.id, cycle: current.completion_cycle, request_id: payload.request_id, completed_at: stamp };
              insert('completion_events', event);
              update('tasks', current.id, { status: 'completed', version: current.version + 1, updated_at: stamp }); changed = true;
            } else event = decoded(db.prepare('SELECT * FROM completion_events WHERE task_id=? AND cycle=?').get(current.id, current.completion_cycle));
          } else if (current.status === 'completed') {
            update('tasks', current.id, { status: 'pending', completion_cycle: current.completion_cycle + 1, version: current.version + 1, updated_at: stamp }); changed = true;
          }
          const result = { entity: find('tasks', current.id), changed, ...(event ? { event } : {}) };
          insert('request_receipts', { request_id: payload.request_id, action, resource_id: current.id, response_json: JSON.stringify(result), created_at: stamp });
          return result;
        }
        if (action === 'task.delete' || action === 'task.restore') {
          const current = requireRow('tasks', payload.id); const shouldChange = action === 'task.delete' ? !current.deleted_at : Boolean(current.deleted_at);
          if (shouldChange) update('tasks', current.id, { deleted_at: action === 'task.delete' ? stamp : null, version: current.version + 1, updated_at: stamp });
          return { entity: find('tasks', current.id), changed: shouldChange };
        }
        if (action === 'execution.create') {
          requireRow('tasks', payload.task_id, true);
          if (typeof payload.started_at !== 'string' || typeof payload.ended_at !== 'string') throw failure(400, '실행 시작·종료 시각을 확인해 주세요.');
          const started = new Date(payload.started_at); const ended = new Date(payload.ended_at);
          if (!Number.isFinite(started.getTime()) || !Number.isFinite(ended.getTime()) || ended < started) throw failure(400, '실행 시작·종료 시각을 확인해 주세요.');
          const entity = { id: randomUUID(), task_id: payload.task_id, started_at: started.toISOString(), ended_at: ended.toISOString(), actual_minutes: minutes(payload.actual_minutes), blocked_reason: text(payload.blocked_reason ?? '', 4000), record_origin: recordOrigin, created_at: stamp };
          insert('executions', entity); return { entity, changed: true };
        }
        if (action === 'review.create') {
          requireRow('plans', payload.plan_id);
          const entity = { id: randomUUID(), plan_id: payload.plan_id, improvement: text(payload.improvement, 2000, true), next_plan_id: null, record_origin: recordOrigin, created_at: stamp };
          insert('reviews', entity); return { entity, changed: true };
        }
        if (action === 'review.next-plan') {
          const review = requireRow('reviews', payload.id);
          if (review.next_plan_id) return { entity: requireRow('plans', review.next_plan_id), changed: false, review };
          const entity = createPlan(payload, stamp, review); update('reviews', review.id, { next_plan_id: entity.id });
          return { entity, changed: true, review: find('reviews', review.id) };
        }
        throw failure(400, '지원하지 않는 작업입니다.');
      });
    },
    async close() { if (!closed) { db.close(); closed = true; } }
  };
}
