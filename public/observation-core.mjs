import { seoulToday } from './core.mjs';

export const OBSERVATION_RULES = Object.freeze({
  metric: '완료한 할 일 수', unit: '개', timezone: 'Asia/Seoul', days: 5,
  calculation: '관찰 시작 이후 선택한 계획의 완료 이벤트를 한국 날짜별 고유 할 일 ID로 센다. 같은 날 재완료는 한 번, 다른 날 재완료는 그 날짜에 한 번 센다. 삭제해도 과거 완료는 유지한다.',
  missing: '확정하지 않은 날은 미기록이다. 확인한 0개만 실제 0으로 센다. 미기록은 평균 분모와 5일 수에서 제외한다.',
  duplicate: '중복 요청 ID는 기존 결과를 반환한다. 같은 날짜의 같은 할 일 ID는 한 번만 센다.',
  outlier: '큰 값도 그대로 보존하고 메모로 설명한다. 임의로 제거하거나 다른 값으로 바꾸지 않는다.',
  rounding: '합계는 정수, 평균은 합계/확정 일수의 원값과 소수 1자리 half-up 표시값을 함께 보존한다.',
  week_start: '월요일', comparison: '변경 전 2일과 변경 후 3일을 같은 지표·단위·계산으로 비교한다.'
});
export function completionContribution(state, study, date) {
  const ids = new Set(state.tasks.filter(task => task.plan_id === study.plan_id).map(task => task.id));
  const events = state.completion_events.filter(event => ids.has(event.task_id) && event.completed_at >= study.created_at && seoulToday(new Date(event.completed_at)) === date);
  return { count: new Set(events.map(event => event.task_id)).size, task_ids: [...new Set(events.map(event => event.task_id))].sort(), event_ids: events.map(event => event.id).sort() };
}
export function summarizeDays(days) {
  const sum = days.reduce((total, day) => total + day.count, 0);
  return { days: days.length, sum, mean: days.length ? sum / days.length : null, mean_display: days.length ? (Math.round(sum * 10 / days.length) / 10).toFixed(1) : null };
}
export function observationSummary(observation, studyId) {
  const days = observation.observation_days.filter(day => day.study_id === studyId).sort((a, b) => a.ordinal - b.ordinal);
  const change = observation.observation_changes.find(row => row.study_id === studyId) || null;
  return { days, change, total: summarizeDays(days), before: summarizeDays(days.filter(day => day.ordinal <= 2)), after: summarizeDays(days.filter(day => day.ordinal >= 3)), complete: days.length === 5 && Boolean(change) };
}
