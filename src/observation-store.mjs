import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { OBSERVATION_RULES, completionContribution, summarizeDays } from '../public/observation-core.mjs';
import { seoulToday } from '../public/core.mjs';
import { problem } from './validation.mjs';

function inputFields(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) throw problem(400, '관찰 입력 항목을 확인해 주세요.', 'VALIDATION');
}
function text(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw problem(400, '질문·계획 규칙·이유를 허용 길이 안에서 입력해 주세요.', 'VALIDATION');
  return value.trim();
}
function decoded(row) {
  if (!row) return row;
  const value = { ...row };
  for (const name of ['rules', 'contribution', 'counts']) if (`${name}_json` in value) { value[name] = JSON.parse(value[`${name}_json`]); delete value[`${name}_json`]; }
  return value;
}
export function observationOperations({ db, transaction, now, requireRow, recordOrigin, diaryState }) {
  db.exec(readFileSync(new URL('../db/observation.sql', import.meta.url), 'utf8'));
  const tables = ['observation_studies', 'observation_days', 'observation_changes', 'observation_checks', 'migration_receipts'];
  for (const table of tables) for (const operation of ['UPDATE', 'DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'immutable_history'); END;`);
  const snapshot = () => Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY created_at,id`).all().map(decoded)]));
  const insert = (table, row) => db.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
  const requireStudy = id => {
    if (typeof id !== 'string' || id.length > 128) throw problem(400, '관찰 ID를 확인해 주세요.', 'VALIDATION');
    const study = decoded(db.prepare('SELECT * FROM observation_studies WHERE id=?').get(id));
    if (!study) throw problem(404, '해당 관찰을 찾을 수 없습니다.', 'NOT_FOUND');
    return study;
  };
  const daysFor = id => db.prepare('SELECT * FROM observation_days WHERE study_id=? ORDER BY ordinal').all(id).map(decoded);
  const changeFor = id => decoded(db.prepare('SELECT * FROM observation_changes WHERE study_id=?').get(id));
  function guardCompletion(task, stamp) {
    const study = db.prepare('SELECT * FROM observation_studies WHERE plan_id=?').get(task.plan_id);
    if (!study) return;
    const days = daysFor(study.id);
    const date = seoulToday(new Date(stamp));
    if (days.length >= 5 || days.some(day => day.date === date)) throw problem(409, '확정한 관찰 날짜에는 완료를 추가할 수 없습니다. 다음 날짜 또는 새 계획에서 진행해 주세요.', 'OBSERVATION_SEALED');
    if (days.length >= 2 && !changeFor(study.id)) throw problem(409, '2일차를 마쳤습니다. 계획 규칙 하나를 변경한 뒤 3일차를 시작해 주세요.', 'RULE_CHANGE_REQUIRED');
    if (!days.length && date !== seoulToday(new Date(study.created_at))) throw problem(409, '관찰 시작 날짜의 1일차 확인이 없습니다. 새 관찰 계획으로 시작해 주세요.', 'MISSED_FIRST_DAY');
  }
  return {
    snapshot,
    state: () => transaction(snapshot, false),
    guardCompletion,
    mutate(action, input) {
      return transaction(() => {
        const stamp = now(); const date = seoulToday(new Date(stamp));
        if (action === 'start') {
          inputFields(input, ['plan_id','question','first_rule','accept_rules']);
          requireRow('plans', input.plan_id);
          if (input.accept_rules !== true) throw problem(400, '계산·누락·중복 규칙을 확인해 주세요.', 'VALIDATION');
          if (db.prepare('SELECT id FROM observation_studies WHERE plan_id=?').get(input.plan_id)) throw problem(409, '이미 시작한 관찰의 질문·지표·계산 규칙은 바꿀 수 없습니다.', 'CONFLICT');
          if (db.prepare('SELECT e.id FROM completion_events e JOIN tasks t ON t.id=e.task_id WHERE t.plan_id=? LIMIT 1').get(input.plan_id)) throw problem(409, '완료 기록이 없는 새 계획에서 관찰을 시작해 주세요. 과거 자료는 그대로 보존됩니다.', 'CONFLICT');
          const row = { id: randomUUID(), plan_id: input.plan_id, question: text(input.question, 2000), first_rule: text(input.first_rule, 2000), rules_json: JSON.stringify(OBSERVATION_RULES), record_origin: recordOrigin, created_at: stamp };
          insert('observation_studies', row); return { entity: decoded(row), changed: true };
        }
        inputFields(input, action === 'day' ? ['id','expected_date','note'] : action === 'check' ? ['id','hand_sum','hand_mean','note'] : ['id','next_rule','reason','day_one_id','day_two_id']);
        const study = requireStudy(input.id); const days = daysFor(study.id); const change = changeFor(study.id);
        if (action === 'day') {
          if (input.expected_date !== date) throw problem(409, '한국 날짜가 바뀌었습니다. 새로 불러온 뒤 오늘 기록을 확인해 주세요.', 'DATE_CHANGED');
          if (days.length >= 5 || days.some(day => day.date === date)) throw problem(409, '이 날짜는 이미 확정했거나 5일 관찰을 마쳤습니다.', 'CONFLICT');
          if (!days.length && date !== seoulToday(new Date(study.created_at))) throw problem(409, '시작 날짜의 1일차 확인이 없습니다. 새 관찰 계획으로 시작해 주세요.', 'MISSED_FIRST_DAY');
          if (days.length && (date <= days.at(-1).date || stamp <= days.at(-1).created_at)) throw problem(409, '서로 다른 날짜를 실제 시각 순서로 기록해 주세요.', 'CONFLICT');
          if (days.length >= 2 && (!change || stamp <= change.created_at)) throw problem(409, '2일차 뒤 계획 규칙 변경을 먼저 기록해 주세요.', 'RULE_CHANGE_REQUIRED');
          if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 4000)) throw problem(400, '메모는 4,000자 이하로 입력해 주세요.', 'VALIDATION');
          const contribution = completionContribution(diaryState(), study, date);
          const row = { id: randomUUID(), study_id: study.id, ordinal: days.length + 1, date, count: contribution.count, contribution_json: JSON.stringify(contribution), note: input.note ?? '', created_at: stamp };
          insert('observation_days', row); return { entity: decoded(row), changed: true };
        }
        if (action === 'rule') {
          if (days.length !== 2 || change || stamp <= days[1].created_at) throw problem(409, '규칙은 2일차 확정 뒤·3일차 시작 전에 한 번만 바꿀 수 있습니다.', 'CONFLICT');
          if (input.day_one_id !== days[0].id || input.day_two_id !== days[1].id) throw problem(400, '실제 1일차와 2일차 기록을 정확히 참조해 주세요.', 'VALIDATION');
          const nextRule = text(input.next_rule, 2000);
          if (nextRule === study.first_rule) throw problem(400, '변경할 계획 규칙은 이전 규칙과 달라야 합니다.', 'VALIDATION');
          const row = { id: randomUUID(), study_id: study.id, day_one_id: days[0].id, day_two_id: days[1].id, previous_rule: study.first_rule, next_rule: nextRule, reason: text(input.reason, 4000), created_at: stamp };
          insert('observation_changes', row); return { entity: row, changed: true };
        }
        if (action === 'check') {
          if (days.length !== 5 || !change || db.prepare('SELECT id FROM observation_checks WHERE study_id=?').get(study.id)) throw problem(409, '5일과 규칙 변경을 마친 뒤 대조를 한 번 저장할 수 있습니다.', 'CONFLICT');
          const summary = summarizeDays(days);
          if (!Number.isSafeInteger(input.hand_sum) || input.hand_sum !== summary.sum || input.hand_mean !== summary.mean_display) throw problem(400, '입력한 합계·평균이 5일 화면과 다릅니다. 날짜별 값을 다시 더하고 평균을 소수 1자리로 확인해 주세요.', 'VALIDATION');
          const row = { id: randomUUID(), study_id: study.id, hand_sum: input.hand_sum, hand_mean: input.hand_mean, note: text(input.note,4000), created_at: stamp };
          insert('observation_checks',row); return { entity: row, changed: true };
        }
        throw problem(400, '지원하지 않는 관찰 작업입니다.', 'VALIDATION');
      });
    }
  };
}
