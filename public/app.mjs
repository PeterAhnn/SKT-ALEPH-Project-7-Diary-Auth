import { aggregate, selectTasks, seoulToday } from './core.mjs';

const $ = (id) => document.getElementById(id);
const ui = {
  state: { plans: [], plan_history: [], tasks: [], executions: [], completion_events: [], request_receipts: [], reviews: [] },
  meta: null,
  selectedId: null,
  stage: 'plan',
  filters: { search: '', status: 'all', priority: 'all', tag: '', sort: 'due' },
  loading: false,
};
const priorities = { high: '높음', medium: '보통', low: '낮음' };
const sortRules = {
  due: '마감일 빠른 순(미정은 맨 뒤) → 우선순위 높음 → 생성 시각 빠른 순 → ID 순',
  priority: '우선순위 높음 → 마감일 빠른 순(미정은 맨 뒤) → 생성 시각 빠른 순 → ID 순',
  created: '생성 시각 최근 순 → ID 순',
};
let toastTimer;
let dialogBusy = false;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function button(text, className, handler) {
  const node = el('button', text, `button ${className || 'secondary'}`);
  node.type = 'button';
  if (handler) node.addEventListener('click', handler);
  return node;
}
function selectedPlan() { return ui.state.plans.find((plan) => plan.id === ui.selectedId); }
function taskById(id) { return ui.state.tasks.find((task) => task.id === id); }
function today() { return ui.meta?.today || seoulToday(); }
function number(value) { return Number(value || 0).toLocaleString('ko-KR'); }
function dateText(value) { return value ? value.replaceAll('-', '.') : '미정'; }
function periodText(plan) { return `${dateText(plan.start_date)} — ${dateText(plan.end_date)}`; }
function timestampText(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}
function localSeoul(value = new Date().toISOString()) {
  const date = new Date(value);
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
}
function toUtc(seoulInput) {
  const date = new Date(`${seoulInput}:00+09:00`);
  if (Number.isNaN(date.getTime())) throw new Error('시작·종료 시각을 올바르게 입력해 주세요.');
  return date.toISOString();
}
function priorityBadge(priority) { return el('span', priorities[priority] || priority, `priority ${priority}`); }
function notify(message, isError = false) {
  clearTimeout(toastTimer);
  const toast = $('toast');
  toast.textContent = message;
  toast.className = `toast${isError ? ' error' : ''}`;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, isError ? 7500 : 4200);
}
function showConnectionError(message) {
  $('connection-error').hidden = false;
  $('connection-message').textContent = message;
  $('save-status').textContent = '불러오기를 마치지 못했습니다. 입력한 내용은 열린 창에 유지됩니다.';
}
async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, { ...options, headers: { ...options.headers, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.method && options.method !== 'GET' ? { 'X-CSRF-Token': ui.csrf || '' } : {}) }, cache: 'no-store' });
  } catch {
    throw new Error('서버에 연결하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.');
  }
  let result;
  try { result = await response.json(); } catch { throw new Error('서버 응답을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'); }
  if (!response.ok || result.ok !== true) {
    const error = new Error(result.error?.message || '저장하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.');
    error.status = response.status;
    if (response.status === 401) window.dispatchEvent(new Event('pds-session-ended'));
    throw error;
  }
  return result;
}
async function loadState({ announce = false } = {}) {
  if (ui.loading) return false;
  ui.loading = true;
  $('reload-button').disabled = true;
  $('connection-retry').disabled = true;
  try {
    const result = await api('/api/state');
    ui.state = result.data;
    ui.meta = result.meta;
    if (!ui.state.plans.some((plan) => plan.id === ui.selectedId)) {
      const sorted = [...ui.state.plans].sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
      ui.selectedId = sorted.find(plan => plan.start_date <= today() && plan.end_date >= today())?.id || sorted[0]?.id || null;
    }
    $('connection-error').hidden = true;
    $('synthetic-banner').hidden = ui.meta.record_origin !== 'synthetic';
    render();
    $('save-status').textContent = `서버에 저장된 기록 · 마지막 확인 ${timestampText(new Date().toISOString())}`;
    $('export-button').disabled = false;
    if (announce) notify('저장된 기록을 새로 불러왔습니다.');
    return true;
  } catch (error) {
    showConnectionError(error.message);
    return false;
  } finally {
    ui.loading = false;
    $('reload-button').disabled = false;
    $('connection-retry').disabled = false;
  }
}
async function mutate(path, method, payload) {
  const result = await api(path, { method, ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}) });
  // Saving and reloading are separate outcomes. A failed reload must not resubmit a saved execution.
  return result.data;
}
function pickPlan(id, stage = ui.stage) {
  ui.selectedId = id;
  ui.filters = { ...ui.filters, search: '', status: 'all', priority: 'all', tag: '' };
  ui.stage = stage;
  render();
}
function setStage(stage, focus = false) {
  ui.stage = stage;
  for (const current of ['plan', 'do', 'see']) {
    const active = current === stage;
    $(`tab-${current}`).classList.toggle('active', active);
    $(`tab-${current}`).setAttribute('aria-selected', String(active));
    $(`tab-${current}`).tabIndex = active ? 0 : -1;
    $(`panel-${current}`).hidden = !active;
  }
  if (focus) $(`tab-${stage}`).focus();
}
function render() {
  renderSidebar();
  const plan = selectedPlan();
  $('workspace-title').textContent = plan?.title || '내 기록을 시작해 보세요';
  $('plan-period').textContent = plan ? `선택한 계획 · ${periodText(plan)}` : 'PLAN → DO → SEE';
  $('today-label').textContent = `한국 시간 오늘 ${dateText(today())}`;
  renderPlan();
  renderDo();
  renderSee();
  setStage(ui.stage);
}
function renderSidebar() {
  $('plan-count').textContent = number(ui.state.plans.length);
  const list = $('plan-list');
  list.replaceChildren();
  const plans = [...ui.state.plans].sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  if (!plans.length) {
    list.append(el('p', '아직 저장한 계획이 없어요. 실제로 진행할 계획 하나부터 시작하세요.', 'sidebar-empty'));
    return;
  }
  for (const plan of plans) {
    const choice = el('button', null, `plan-choice${plan.id === ui.selectedId ? ' selected' : ''}`);
    choice.type = 'button';
    choice.setAttribute('aria-pressed', String(plan.id === ui.selectedId));
    choice.append(el('strong', plan.title), el('small', periodText(plan)));
    const meta = el('span', null, 'plan-choice-meta');
    const count = ui.state.tasks.filter((task) => task.plan_id === plan.id && !task.deleted_at).length;
    meta.append(priorityBadge(plan.priority), el('span', `할 일 ${number(count)}개`));
    choice.append(meta);
    choice.addEventListener('click', () => pickPlan(plan.id));
    list.append(choice);
  }
}
function emptyState(title, message, actionText, handler, compact = false) {
  const box = el('div', null, `empty-card${compact ? ' compact' : ''}`);
  if (!compact) box.append(el('div', '↗', 'empty-symbol'));
  box.append(el('h3', title), el('p', message));
  if (actionText) box.append(button(actionText, 'primary', handler));
  return box;
}
function card(title, description, action) {
  const node = el('section', null, 'card');
  const heading = el('div', null, 'card-heading');
  const labels = el('div');
  labels.append(el('h3', title));
  if (description) labels.append(el('p', description));
  heading.append(labels);
  if (action) heading.append(action);
  node.append(heading);
  return node;
}
function addDetail(dl, label, value, fullSpan = false) {
  const group = el('div', null, fullSpan ? 'full-span' : undefined);
  group.append(el('dt', label));
  const dd = el('dd');
  dd.append(value instanceof Node ? value : document.createTextNode(String(value)));
  group.append(dd);
  dl.append(group);
}
function readableMemo(text, { className, threshold, label }) {
  if (text.length <= threshold) return el('p', text, className);
  const block = el('div', null, `memo-block ${className}`);
  // Only the preview is shortened. The full saved text remains available verbatim in the details.
  const firstParagraph = text.split(/\r?\n/).find(line => line.trim()
    && !/^\[(?:승인 가져오기|가져오기 항목|가져오기 실행):/.test(line.trim()))?.trim() || '';
  const segments = [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(firstParagraph)].map(part => part.segment);
  let preview = segments.slice(0, threshold).join('');
  if (segments.length > threshold) {
    const sentenceEnd = [...preview.matchAll(/[.!?。](?=\s|$)/g)].at(-1)?.index;
    if (sentenceEnd !== undefined && sentenceEnd > 30) preview = preview.slice(0, sentenceEnd + 1);
    else preview = `${preview.trimEnd()}…`;
  }
  if (text.includes('AI 협업') && !preview.includes('AI 협업')) preview = `AI 협업 · ${preview}`;
  block.append(el('p', preview || '전체 기록을 펼쳐 확인하세요.', 'memo-preview'));
  const details = el('details', null, 'memo-details');
  const summary = el('summary', `${label} 전체 보기`);
  details.append(summary, el('p', text, 'memo-full'));
  details.addEventListener('toggle', () => { summary.textContent = details.open ? `${label} 접기` : `${label} 전체 보기`; });
  block.append(details);
  return block;
}
function planDetails(plan) {
  const dl = el('dl', null, 'detail-grid');
  addDetail(dl, '계획 기간', periodText(plan));
  addDetail(dl, '우선순위', priorityBadge(plan.priority));
  addDetail(dl, '예상 시간', `${number(plan.expected_minutes)}분`);
  addDetail(dl, '저장 버전', `v${plan.version}`);
  addDetail(dl, '성공 기준', plan.success_criteria, true);
  return dl;
}
function renderPlan() {
  const panel = $('panel-plan');
  panel.replaceChildren();
  const plan = selectedPlan();
  if (!plan) {
    panel.append(emptyState('작은 계획 하나부터', '내 계정에 실제 계획을 적으세요. 계획을 세운 뒤 할 일과 실제 기록을 연결할 수 있어요.', '첫 계획 세우기', () => openPlanForm()));
    return;
  }
  const stack = el('div', null, 'panel-stack');
  const current = card('지금의 계획', '처음의 생각과 달라져도 이전 계획은 이력에 남아요.', button('계획 수정', 'secondary small', () => openPlanForm(plan)));
  if (plan.carried_improvement) {
    const carried = el('div', null, 'carried-note');
    carried.append(el('small', '이전 돌아보기에서 이어 온 개선'), el('p', plan.carried_improvement));
    current.append(carried);
  }
  if (plan.description) current.append(readableMemo(plan.description, { className: 'plan-description', threshold: 220, label: '계획 설명' }));
  current.append(planDetails(plan));
  const metadata = el('p', null, 'metadata');
  metadata.append(document.createTextNode('계획 ID '), el('code', plan.id), el('br'), document.createTextNode(`처음 저장 ${timestampText(plan.created_at)} · 마지막 수정 ${timestampText(plan.updated_at)} (한국 시간)`));
  current.append(metadata);
  const histories = ui.state.plan_history.filter((history) => history.plan_id === plan.id).sort((a, b) => b.version - a.version);
  const historyCard = card('계획의 발자취', `같은 계획 ID의 수정 이력 ${number(histories.length)}개. 저장된 이전 버전은 그대로 보존됩니다.`);
  const historyList = el('div', null, 'history-list');
  for (const history of histories) {
    const entry = el('details', null, 'history-entry');
    const label = `v${history.version} ${history.version === plan.version ? '· 현재 계획' : '· 이전 계획'} — ${timestampText(history.created_at)} (한국 시간)`;
    entry.append(el('summary', label));
    const snapshot = history.snapshot || {};
    entry.append(el('p', snapshot.title || '', 'plan-description'));
    if (snapshot.description) entry.append(readableMemo(snapshot.description, { className: 'plan-description', threshold: 220, label: '이 버전의 계획 설명' }));
    entry.append(planDetails(snapshot));
    if (snapshot.carried_improvement) entry.append(el('p', `이어 온 개선: ${snapshot.carried_improvement}`, 'carried-note'));
    entry.append(el('p', `계획 ID ${history.plan_id}`, 'metadata'));
    historyList.append(entry);
  }
  historyCard.append(historyList);
  stack.append(current, historyCard);
  panel.append(stack);
}
function filterSelect(label, name, options) {
  const wrapper = el('label', label);
  const select = el('select');
  select.name = name;
  select.id = `filter-${name}`;
  for (const [value, title] of options) {
    const option = el('option', title);
    option.value = value;
    select.append(option);
  }
  select.value = ui.filters[name];
  select.addEventListener('change', () => { ui.filters[name] = select.value; renderTaskResults(); });
  wrapper.append(select);
  return wrapper;
}
function renderDo() {
  const panel = $('panel-do');
  panel.replaceChildren();
  const plan = selectedPlan();
  if (!plan) {
    panel.append(emptyState('기록을 연결할 계획이 필요해요', '계획을 먼저 세우면 그 안에 할 일을 만들고 실제로 한 일을 기록할 수 있어요.', '계획 세우기', () => openPlanForm()));
    return;
  }
  const stack = el('div', null, 'panel-stack');
  const tasksCard = card('한 걸음씩, 할 일', '완료 여부와 실제 실행 기록을 따로 남깁니다.', button('＋ 할 일 추가', 'primary small', () => openTaskForm()));
  const filters = el('div', null, 'filters');
  const searchLabel = el('label', '검색');
  const search = el('input');
  search.id = 'filter-search';
  search.type = 'search';
  search.placeholder = '제목, 메모, 태그 검색';
  search.value = ui.filters.search;
  search.addEventListener('input', () => { ui.filters.search = search.value; renderTaskResults(); });
  searchLabel.append(search);
  const tags = [...new Set(ui.state.tasks.filter((task) => task.plan_id === plan.id && !task.deleted_at).flatMap((task) => task.tags || []))].sort((a, b) => a.localeCompare(b, 'ko'));
  if (ui.filters.tag && !tags.includes(ui.filters.tag)) ui.filters.tag = '';
  filters.append(searchLabel,
    filterSelect('상태', 'status', [['all', '전체 상태'], ['pending', '진행 중'], ['completed', '완료']]),
    filterSelect('우선순위', 'priority', [['all', '전체 우선순위'], ['high', '높음'], ['medium', '보통'], ['low', '낮음']]),
    filterSelect('태그', 'tag', [['', '전체 태그'], ...tags.map((tag) => [tag, tag])]),
    filterSelect('정렬', 'sort', [['due', '마감일 빠른 순'], ['priority', '우선순위 높은 순'], ['created', '최근 만든 순']]));
  tasksCard.append(filters, el('p', null, 'sort-rule'));
  tasksCard.lastChild.id = 'sort-rule';
  const taskResults = el('div');
  taskResults.id = 'task-results';
  tasksCard.append(taskResults);
  const deleted = ui.state.tasks.filter((task) => task.plan_id === plan.id && task.deleted_at).sort((a, b) => b.deleted_at.localeCompare(a.deleted_at) || a.id.localeCompare(b.id));
  if (deleted.length) {
    const details = el('details', null, 'deleted-list');
    details.append(el('summary', `삭제한 할 일 ${number(deleted.length)}개 · 실행 이력은 보존됩니다`));
    for (const task of deleted) {
      const row = el('div', null, 'deleted-row');
      row.append(el('span', task.title), button('복원', 'secondary small', (event) => quickMutation(event.currentTarget, `/api/tasks/${task.id}/restore`, 'POST', {}, '할 일을 복원했습니다.')));
      details.append(row);
    }
    tasksCard.append(details);
  }
  const executionCard = card('실제로 한 일', '시작·종료는 한국 시간입니다. 실행을 적어도 원래 예상 시간은 바뀌지 않아요.', button('＋ 실행 기록', 'secondary small', () => openExecutionForm()));
  const taskIds = new Set(ui.state.tasks.filter((task) => task.plan_id === plan.id && !task.deleted_at).map((task) => task.id));
  const executions = ui.state.executions.filter((execution) => taskIds.has(execution.task_id)).sort((a, b) => b.started_at.localeCompare(a.started_at) || a.id.localeCompare(b.id));
  if (!executions.length) executionCard.append(emptyState('아직 실제 기록이 없어요', '실제로 수행한 시작·종료 시각과 소요 시간을 해당 할 일에 연결하세요.', '실행 기록하기', () => openExecutionForm(), true));
  else {
    const list = el('div', null, 'execution-list');
    executions.forEach((execution) => list.append(executionRow(execution)));
    executionCard.append(list);
  }
  stack.append(tasksCard, executionCard);
  panel.append(stack);
  renderTaskResults();
}
function renderTaskResults() {
  const container = $('task-results');
  if (!container) return;
  container.replaceChildren();
  $('sort-rule').textContent = `화면에서 검색·필터·정렬합니다. 동률 처리: ${sortRules[ui.filters.sort]}`;
  const tasks = selectTasks(ui.state.tasks, { planId: ui.selectedId, ...ui.filters });
  const allTasks = ui.state.tasks.filter((task) => task.plan_id === ui.selectedId && !task.deleted_at);
  const stats = el('div', null, 'task-results');
  stats.append(el('span', `${number(tasks.length)}개 표시 · 전체 ${number(allTasks.length)}개`), el('span', '실제 소요 시간은 실행 기록에 저장'));
  container.append(stats);
  if (!tasks.length) {
    if (!allTasks.length) container.append(emptyState('계획을 할 일로 나눠 보세요', '실제로 해야 할 일을 적고 마감일과 예상 시간을 정하세요.', '첫 할 일 추가', () => openTaskForm(), true));
    else container.append(emptyState('조건에 맞는 할 일이 없어요', '검색어나 필터를 바꿔 다른 기록을 확인할 수 있어요.', '필터 초기화', () => { ui.filters = { search: '', status: 'all', priority: 'all', tag: '', sort: ui.filters.sort }; renderDo(); }, true));
    return;
  }
  const list = el('div', null, 'task-list');
  for (const task of tasks) list.append(taskRow(task));
  container.append(list);
}
function taskRow(task) {
  const row = el('article', null, `task-row ${task.status}`);
  row.dataset.taskId = task.id;
  const toggle = el('button', task.status === 'completed' ? '✓' : '', 'task-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-label', `${task.title}: ${task.status === 'completed' ? '진행 중으로 되돌리기' : '완료하기'}`);
  toggle.setAttribute('aria-pressed', String(task.status === 'completed'));
  toggle.addEventListener('click', () => {
    const completed = task.status === 'completed';
    const action = completed ? 'reopen' : 'complete';
    quickMutation(toggle, `/api/tasks/${task.id}/${action}`, 'POST', { request_id: crypto.randomUUID() }, completed ? '진행 중으로 되돌렸습니다. 완료 이력은 보존됩니다.' : '완료로 저장했습니다. 같은 완료는 중복 기록되지 않습니다.');
  });
  const main = el('div', null, 'task-main');
  const top = el('div', null, 'task-topline');
  top.append(el('h4', task.title, 'task-title'), priorityBadge(task.priority));
  main.append(top);
  if (task.notes) main.append(readableMemo(task.notes, { className: 'task-notes', threshold: 160, label: '메모' }));
  const meta = el('div', null, 'task-meta');
  const overdue = task.status !== 'completed' && task.due_date && task.due_date < today();
  meta.append(el('span', `마감 ${dateText(task.due_date)}${overdue ? ' · 지연' : ''}`, overdue ? 'overdue-label' : undefined), el('span', `예상 ${number(task.expected_minutes)}분`), el('span', task.status === 'completed' ? '현재 완료' : '진행 중'));
  for (const tag of task.tags || []) meta.append(el('span', `#${tag}`, 'tag'));
  main.append(meta);
  const actions = el('div', null, 'task-actions');
  const executionCount = ui.state.executions.filter((execution) => execution.task_id === task.id).length;
  actions.append(button('실행 적기', 'secondary', () => openExecutionForm(task)), button('수정', 'ghost', () => openTaskForm(task)), button(`기록 보기 ${number(executionCount)}`, 'ghost', () => openTaskDetails(task)), button('삭제', 'ghost', () => openDeleteTask(task)));
  main.append(actions);
  row.append(toggle, main);
  return row;
}
function executionRow(execution) {
  const row = el('article', null, 'execution-row');
  row.dataset.executionId = execution.id;
  const labels = el('div');
  labels.append(el('strong', taskById(execution.task_id)?.title || '연결된 할 일'));
  const time = el('time', `${timestampText(execution.started_at)} → ${timestampText(execution.ended_at)} (한국 시간)`);
  time.dateTime = execution.started_at;
  labels.append(time);
  const duration = el('div', null, 'execution-time');
  duration.append(document.createTextNode(number(execution.actual_minutes)), el('small', '분'));
  row.append(labels, duration);
  if (execution.blocked_reason?.trim()) row.append(el('p', `막힌 이유 · ${execution.blocked_reason}`, 'blocked-note'));
  return row;
}
const metricDefinitions = [
  ['planned', '계획 수', '개', '삭제되지 않은 할 일'],
  ['completed', '완료 수', '개', '지금 완료 상태인 할 일'],
  ['overdue', '지연 수', '개', '마감일이 지난 미완료'],
  ['blocked', '막힘 수', '개', '막힌 이유가 있는 할 일'],
  ['expected_minutes', '예상 시간', '분', '할 일의 예상 시간 합계'],
  ['actual_minutes', '실제 시간', '분', '연결된 실행 시간 합계'],
  ['delta_minutes', '시간 차이', '분', '실제 − 예상'],
];
function renderSee() {
  const panel = $('panel-see');
  panel.replaceChildren();
  const plan = selectedPlan();
  if (!plan) {
    panel.append(emptyState('계획과 실제 사이를 돌아보세요', '계획과 실행 기록을 쌓으면 차이가 보여요. 다음 계획에 반영할 개선 한 가지를 남겨 보세요.', '계획부터 시작', () => openPlanForm()));
    return;
  }
  const stack = el('div', null, 'panel-stack');
  stack.append(el('p', `이 계획의 기간 ${periodText(plan)}. 아래 숫자를 누르면 계산에 기여한 기록을 확인할 수 있어요. 삭제한 할 일은 집계에서 제외합니다.`, 'see-intro'));
  const values = aggregate(ui.state, plan.id, today());
  const metrics = el('div', null, 'metric-grid');
  for (const [key, title, unit, footnote] of metricDefinitions) {
    const metric = el('button', null, 'metric-card');
    metric.type = 'button';
    metric.dataset.metric = key;
    metric.setAttribute('aria-label', `${title} ${number(values[key])}${unit}, 기여 기록 보기`);
    metric.append(el('span', title, 'metric-label'), el('span', '↗', 'metric-arrow'));
    const value = el('span', null, 'metric-value');
    const amount = values[key] > 0 && key === 'delta_minutes' ? `+${number(values[key])}` : number(values[key]);
    value.append(document.createTextNode(amount), el('small', unit, 'metric-unit'));
    metric.append(value, el('span', footnote, 'metric-foot'));
    metric.addEventListener('click', () => openMetricDetails(key, values));
    metrics.append(metric);
  }
  stack.append(metrics);
  const timeCard = card('예상과 실제의 간격', '한 가지 단위로 비교합니다. 모든 시간은 분입니다.');
  const bars = el('div', null, 'time-comparison');
  const maximum = Math.max(values.expected_minutes, values.actual_minutes, 1);
  for (const [key, title] of [['expected_minutes', '예상 시간'], ['actual_minutes', '실제 시간']]) {
    const line = el('div', null, 'bar-line');
    const progress = el('progress', null, `bar-progress${key === 'actual_minutes' ? ' actual' : ''}`);
    progress.value = values[key];
    progress.max = maximum;
    progress.setAttribute('aria-label', `${title} ${number(values[key])}분`);
    line.append(el('span', title), progress, el('strong', `${number(values[key])}분`));
    bars.append(line);
  }
  timeCard.append(bars, el('p', values.delta_minutes > 0 ? `예상보다 ${number(values.delta_minutes)}분 더 사용했어요. 다음 계획에서는 이 간격을 참고해 보세요.` : values.delta_minutes < 0 ? `현재 실제 시간은 예상보다 ${number(Math.abs(values.delta_minutes))}분 적어요. 진행 상태와 함께 확인하세요.` : '예상 시간과 현재 실제 시간의 합계가 같아요.', 'delta-note'),
    el('p', '집계 기준: 선택한 계획의 삭제되지 않은 모든 할 일과 연결된 실행 기록. 지연은 한국 시간 오늘보다 이전인 미완료 마감일, 막힘은 이유가 있는 할 일을 한 번씩 셉니다. 빈 합계는 0입니다.', 'formula-note'));
  const reviewCard = card('다음에는, 이 한 가지', '돌아보기에서 정한 개선을 다음 계획으로 이어 보세요.', button('＋ 개선 남기기', 'primary small', () => openReviewForm()));
  const reviews = ui.state.reviews.filter((review) => review.plan_id === plan.id).sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  if (!reviews.length) reviewCard.append(emptyState('나의 판단 한 줄을 남기세요', '기록에서 무엇을 발견했나요? 다음 계획에서 직접 바꿀 한 가지를 적어 보세요.', '개선 한 가지 적기', () => openReviewForm(), true));
  else {
    const list = el('div', null, 'review-list');
    for (const review of reviews) {
      const row = el('article', null, 'review-row');
      row.append(el('p', review.improvement), el('time', `${timestampText(review.created_at)} (한국 시간)`));
      if (review.next_plan_id) {
        const next = ui.state.plans.find((item) => item.id === review.next_plan_id);
        row.append(button(`다음 계획 보기 · ${next?.title || '연결된 계획'} ↗`, 'secondary small', () => pickPlan(review.next_plan_id, 'plan')));
      } else row.append(button('이 개선으로 다음 계획 세우기 ↗', 'secondary small', () => openPlanForm(null, review)));
      list.append(row);
    }
    reviewCard.append(list);
  }
  stack.append(timeCard, reviewCard);
  panel.append(stack);
}
function openDialog(title, eyebrow) {
  if (dialogBusy) return false;
  $('dialog-title').textContent = title;
  $('dialog-eyebrow').textContent = eyebrow;
  $('dialog-content').replaceChildren();
  if (!$('editor-dialog').open) $('editor-dialog').showModal();
  return true;
}
function closeDialog() {
  if (!dialogBusy) $('editor-dialog').close();
}
function formField(label, name, { type = 'text', value = '', required = false, maxLength, min, max, hint, rows, options } = {}) {
  const wrapper = el('label', null, 'form-field');
  wrapper.append(el('span', label));
  const control = el(options ? 'select' : type === 'textarea' ? 'textarea' : 'input');
  if (!options && type !== 'textarea') control.type = type;
  control.name = name;
  control.id = `field-${name}`;
  control.required = required;
  if (maxLength !== undefined) control.maxLength = maxLength;
  if (min !== undefined) control.min = min;
  if (max !== undefined) control.max = max;
  if (type === 'number') control.step = '1';
  if (rows) control.rows = rows;
  if (options) for (const [optionValue, title] of options) {
    const option = el('option', title);
    option.value = optionValue;
    control.append(option);
  }
  control.value = value ?? '';
  wrapper.append(control);
  if (hint) wrapper.append(el('small', hint));
  return { wrapper, control };
}
function createEditorForm(saveLabel, onSubmit) {
  const form = el('form', null, 'editor-form');
  const errorBox = el('p', null, 'form-error');
  errorBox.id = 'form-error';
  errorBox.setAttribute('role', 'alert');
  errorBox.hidden = true;
  const actions = el('div', null, 'form-actions');
  const cancel = button('취소', 'ghost', closeDialog);
  const submit = button(saveLabel, 'primary');
  submit.type = 'submit';
  actions.append(cancel, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (dialogBusy || !form.reportValidity()) return;
    errorBox.hidden = true;
    dialogBusy = true;
    submit.disabled = true;
    cancel.disabled = true;
    $('dialog-close').disabled = true;
    submit.textContent = '저장 중…';
    let saved = false;
    try {
      await onSubmit(new FormData(form));
      saved = true;
    } catch (error) {
      errorBox.textContent = error.status === 409 ? `${error.message} 입력 내용은 유지했습니다. 닫은 뒤 새로 불러오기로 최신 저장본을 확인하고 다시 수정해 주세요.` : `${error.message} 입력 내용은 유지했습니다.`;
      errorBox.hidden = false;
    } finally {
      dialogBusy = false;
      submit.disabled = false;
      cancel.disabled = false;
      $('dialog-close').disabled = false;
      submit.textContent = saveLabel;
    }
    if (saved) {
      $('editor-dialog').close();
      const reloaded = await loadState();
      notify(reloaded ? '서버에 저장했습니다.' : '저장은 완료됐습니다. 목록을 다시 불러와 확인해 주세요.', !reloaded);
    }
  });
  return { form, finish() { form.append(errorBox, actions); $('dialog-content').append(form); requestAnimationFrame(() => form.querySelector('input,textarea,select')?.focus()); } };
}
function planPayload(data) {
  return { title: data.get('title').trim(), description: data.get('description').trim(), start_date: data.get('start_date'), end_date: data.get('end_date'), priority: data.get('priority'), success_criteria: data.get('success_criteria').trim(), expected_minutes: Number(data.get('expected_minutes')) };
}
function openPlanForm(plan = null, review = null) {
  if (!openDialog(plan ? '계획 수정하기' : review ? '개선으로 다음 계획 세우기' : '새 계획 세우기', '01 · PLAN')) return;
  const editor = createEditorForm(plan ? '수정하고 이력 남기기' : '계획 저장하기', async (data) => {
    const payload = planPayload(data);
    if (payload.end_date < payload.start_date) throw new Error('계획 종료일은 시작일 이후로 정해 주세요.');
    const path = plan ? `/api/plans/${plan.id}` : review ? `/api/reviews/${review.id}/next-plan` : '/api/plans';
    const result = await mutate(path, plan ? 'PATCH' : 'POST', { ...payload, ...(plan ? { expected_version: plan.version } : {}) });
    ui.selectedId = result.entity.id;
    ui.stage = 'plan';
  });
  if (review) {
    const carried = el('div', null, 'carried-note');
    carried.append(el('small', '다음 계획으로 이어지는 개선 · 저장 후에도 원문 보존'), el('p', review.improvement));
    editor.form.append(carried);
  }
  editor.form.append(formField('계획 이름', 'title', { value: plan?.title, required: true, maxLength: 160 }).wrapper,
    formField('이 계획으로 하려는 일', 'description', { type: 'textarea', value: plan?.description, maxLength: 4000 }).wrapper);
  const grid = el('div', null, 'form-grid');
  grid.append(formField('시작일', 'start_date', { type: 'date', value: plan?.start_date || today(), required: true }).wrapper,
    formField('종료일', 'end_date', { type: 'date', value: plan?.end_date || today(), required: true }).wrapper,
    formField('우선순위', 'priority', { value: plan?.priority || 'medium', options: Object.entries(priorities) }).wrapper,
    formField('계획 예상 시간 (분)', 'expected_minutes', { type: 'number', value: plan?.expected_minutes ?? '', min: '0', max: '1000000', required: true }).wrapper);
  editor.form.append(grid, formField('무엇이 되면 성공인가요?', 'success_criteria', { type: 'textarea', value: plan?.success_criteria, required: true, maxLength: 2000, hint: '직접 확인할 수 있는 기준을 적으세요. 할 일별 예상 시간은 Do에서 따로 정합니다.' }).wrapper);
  if (plan) editor.form.append(el('p', `같은 계획 ID를 유지하며 새 버전을 저장합니다. 현재 v${plan.version} · ${plan.id}`, 'form-description'));
  editor.finish();
}
function openTaskForm(task = null) {
  if (!selectedPlan()) { openPlanForm(); return; }
  if (!openDialog(task ? '할 일 수정하기' : '할 일 추가하기', '02 · DO')) return;
  const editor = createEditorForm(task ? '수정 저장하기' : '할 일 저장하기', async (data) => {
    const payload = { title: data.get('title').trim(), notes: data.get('notes').trim(), due_date: data.get('due_date') || null, priority: data.get('priority'), tags: [...new Set(data.get('tags').split(',').map((tag) => tag.trim()).filter(Boolean))], expected_minutes: Number(data.get('expected_minutes')), ...(task ? { expected_version: task.version } : {}) };
    await mutate(task ? `/api/tasks/${task.id}` : `/api/plans/${ui.selectedId}/tasks`, task ? 'PATCH' : 'POST', payload);
    ui.stage = 'do';
  });
  editor.form.append(formField('할 일', 'title', { value: task?.title, required: true, maxLength: 160 }).wrapper,
    formField('메모', 'notes', { type: 'textarea', value: task?.notes, maxLength: 4000 }).wrapper);
  const grid = el('div', null, 'form-grid');
  grid.append(formField('마감일 (선택)', 'due_date', { type: 'date', value: task?.due_date }).wrapper,
    formField('우선순위', 'priority', { value: task?.priority || 'medium', options: Object.entries(priorities) }).wrapper,
    formField('예상 시간 (분)', 'expected_minutes', { type: 'number', value: task?.expected_minutes ?? '', min: '0', max: '1000000', required: true }).wrapper,
    formField('태그 (선택)', 'tags', { value: task?.tags?.join(', '), maxLength: 1000, hint: '쉼표로 구분합니다. 각 40자 이하, 최대 20개. 예: 공부, 과제' }).wrapper);
  editor.form.append(grid, el('p', `연결된 계획 · ${selectedPlan().title}`, 'form-description'));
  editor.finish();
}
function openExecutionForm(task = null) {
  const tasks = ui.state.tasks.filter((item) => item.plan_id === ui.selectedId && !item.deleted_at);
  if (!tasks.length) { notify('실행을 연결할 할 일을 먼저 추가해 주세요.'); openTaskForm(); return; }
  if (!openDialog('실제로 한 일 기록하기', '02 · DO')) return;
  const editor = createEditorForm('실행 기록 저장하기', async (data) => {
    const started_at = toUtc(data.get('started_at'));
    const ended_at = toUtc(data.get('ended_at'));
    if (ended_at < started_at) throw new Error('끝난 시각은 시작 시각 이후로 입력해 주세요.');
    await mutate(`/api/tasks/${data.get('task_id')}/executions`, 'POST', { started_at, ended_at, actual_minutes: Number(data.get('actual_minutes')), blocked_reason: data.get('blocked_reason').trim() });
    ui.stage = 'do';
  });
  editor.form.append(formField('연결할 할 일', 'task_id', { value: task?.id || tasks[0].id, required: true, options: tasks.map((item) => [item.id, item.title]) }).wrapper);
  const grid = el('div', null, 'form-grid');
  const start = formField('시작 시각 (한국 시간)', 'started_at', { type: 'datetime-local', value: localSeoul(), required: true });
  const end = formField('끝난 시각 (한국 시간)', 'ended_at', { type: 'datetime-local', value: localSeoul(), required: true });
  // Date-time controls have minute precision; the offset is explicit regardless of browser locale.
  start.control.step = '60';
  end.control.step = '60';
  grid.append(start.wrapper, end.wrapper);
  const actual = formField('실제 소요 시간 (분)', 'actual_minutes', { type: 'number', min: '0', max: '1000000', required: true, hint: '휴식 등을 제외한 실제 시간을 직접 입력하거나 시각 차이로 채우세요.' });
  const calculate = button('시작·끝 시각 차이로 채우기', 'secondary small', () => {
    try {
      const minutes = Math.round((Date.parse(toUtc(end.control.value)) - Date.parse(toUtc(start.control.value))) / 60000);
      if (minutes < 0) throw new Error('끝난 시각이 시작 시각보다 앞섭니다.');
      actual.control.value = String(minutes);
      notify(`시각 차이 ${number(minutes)}분을 채웠습니다. 실제 시간과 맞는지 확인해 주세요.`);
    } catch (error) { notify(error.message, true); }
  });
  editor.form.append(grid, actual.wrapper, calculate,
    formField('막혔던 이유 (선택)', 'blocked_reason', { type: 'textarea', maxLength: 4000, hint: '없으면 비워 두세요. 같은 할 일의 이유가 여러 건이어도 막힘 수는 1개입니다.' }).wrapper,
    el('p', '실제 수행한 기록만 입력하세요. 실행 기록은 원래 계획·할 일의 예상 시간과 완료 상태를 바꾸지 않습니다.', 'form-description'));
  editor.finish();
}
function openReviewForm() {
  if (!selectedPlan()) { openPlanForm(); return; }
  if (!openDialog('다음에 바꿀 한 가지', '03 · SEE')) return;
  const editor = createEditorForm('개선 저장하기', async (data) => {
    await mutate(`/api/plans/${ui.selectedId}/reviews`, 'POST', { improvement: data.get('improvement').trim() });
    ui.stage = 'see';
  });
  editor.form.append(el('p', '계획과 실제 기록에서 직접 발견한 내용을 적으세요. 저장한 뒤 이 개선을 이어 받은 다음 계획을 만들 수 있어요.', 'form-description'),
    formField('다음 계획에 반영할 개선 한 가지', 'improvement', { type: 'textarea', required: true, maxLength: 2000, rows: 4 }).wrapper);
  editor.finish();
}
function openDeleteTask(task) {
  if (!openDialog('할 일을 삭제할까요?', '02 · DO')) return;
  const editor = createEditorForm('삭제하기', async () => {
    await mutate(`/api/tasks/${task.id}`, 'DELETE');
    ui.stage = 'do';
  });
  editor.form.append(el('p', task.title, 'plan-description'), el('p', '목록과 집계에서 제외합니다. 기존 실행·완료 이력은 보존되며, Do의 ‘삭제한 할 일’에서 복원할 수 있습니다.', 'form-description'));
  editor.finish();
}
async function quickMutation(control, path, method, payload, message) {
  control.disabled = true;
  try {
    await mutate(path, method, payload);
    const reloaded = await loadState();
    notify(reloaded ? message : '저장은 완료됐습니다. 새로 불러오기로 현재 상태를 확인해 주세요.', !reloaded);
  } catch (error) { notify(error.message, true); }
  finally { control.disabled = false; }
}
function openTaskDetails(task) {
  if (!openDialog('할 일에 연결된 기록', 'RECORDS')) return;
  const body = el('div', null, 'details-body');
  body.append(el('h3', task.title));
  const dl = el('dl', null, 'detail-grid');
  addDetail(dl, '현재 상태', task.status === 'completed' ? '완료' : '진행 중');
  addDetail(dl, '마감일', dateText(task.due_date));
  addDetail(dl, '예상 시간', `${number(task.expected_minutes)}분`);
  addDetail(dl, '우선순위', priorityBadge(task.priority));
  body.append(dl, el('p', `할 일 ID ${task.id} · 계획 ID ${task.plan_id}`, 'metadata'));
  if (task.notes) body.append(el('h4', '메모 전체'), el('p', task.notes, 'task-notes task-notes-full'));
  const events = ui.state.completion_events.filter((event) => event.task_id === task.id).sort((a, b) => b.cycle - a.cycle);
  const currentEvents = events.filter((event) => event.cycle === task.completion_cycle);
  body.append(el('p', `현재 완료 주기 ${task.completion_cycle}의 완료 기록 ${number(currentEvents.length)}건 · 전체 완료 이력 ${number(events.length)}건. See 완료 수에는 현재 완료 상태만 반영합니다.`, 'evidence-summary'));
  for (const event of events) body.append(el('p', `주기 ${event.cycle} · ${timestampText(event.completed_at)} (한국 시간) · 요청 ${event.request_id}`, 'evidence-minor'));
  const executions = ui.state.executions.filter((execution) => execution.task_id === task.id).sort((a, b) => a.started_at.localeCompare(b.started_at) || a.id.localeCompare(b.id));
  body.append(el('h4', `실행 기록 ${number(executions.length)}건`));
  if (!executions.length) body.append(el('p', '아직 이 할 일에 연결된 실행 기록이 없습니다.', 'evidence-empty'));
  else executions.forEach((execution) => body.append(executionRow(execution)));
  body.append(button('이 할 일에 실행 기록 추가', 'secondary', () => openExecutionForm(task)));
  $('dialog-content').append(body);
}
function openMetricDetails(key, values) {
  const definition = metricDefinitions.find(([name]) => name === key);
  if (!openDialog(`${definition[1]} · 기여 기록`, '03 · SEE')) return;
  const body = el('div', null, 'details-body');
  const descriptions = {
    planned: '선택한 계획에 연결된 삭제되지 않은 할 일을 셉니다.',
    completed: '삭제되지 않은 할 일 중 현재 완료 상태만 셉니다. 과거 완료 이력 수와 다를 수 있습니다.',
    overdue: `미완료이며 마감일이 한국 시간 오늘 ${dateText(today())}보다 이전인 할 일을 셉니다.`,
    blocked: '막힌 이유가 비어 있지 않은 실행이 하나라도 있는 할 일을 한 번씩 셉니다.',
    expected_minutes: '삭제되지 않은 할 일에 저장된 예상 시간을 모두 합합니다. 계획 자체의 예상 시간을 더하지 않습니다.',
    actual_minutes: '대상 할 일에 연결된 아래 실행 기록의 실제 소요 시간을 모두 합합니다.',
    delta_minutes: '아래 할 일의 실제 소요 시간 합계에서 예상 시간 합계를 뺍니다. 실제 − 예상.',
  };
  body.append(el('p', `${definition[1]} ${number(values[key])}${definition[2]} · ${descriptions[key]}`, 'evidence-summary'));
  const ids = values.evidence[key] || [];
  if (!ids.length) body.append(el('p', '이 숫자에 기여한 기록이 없습니다. 빈 합계는 0입니다.', 'evidence-empty'));
  for (const id of ids) {
    if (key === 'actual_minutes') {
      const execution = ui.state.executions.find((item) => item.id === id);
      if (execution) body.append(executionRow(execution));
    } else {
      const task = taskById(id);
      if (!task) continue;
      const row = el('article', null, 'evidence-task');
      row.append(el('strong', task.title));
      const executions = ui.state.executions.filter((item) => item.task_id === task.id);
      const actualMinutes = executions.reduce((sum, item) => sum + item.actual_minutes, 0);
      row.append(el('p', `상태 ${task.status === 'completed' ? '완료' : '진행 중'} · 마감 ${dateText(task.due_date)} · 예상 ${number(task.expected_minutes)}분 · 실제 ${number(actualMinutes)}분${key === 'delta_minutes' ? ` · 차이 ${number(actualMinutes - task.expected_minutes)}분` : ''}`, 'evidence-minor'));
      if (key === 'blocked') for (const execution of executions.filter((item) => item.blocked_reason?.trim())) row.append(el('p', execution.blocked_reason, 'blocked-note'));
      row.append(el('p', `할 일 ID ${task.id}`, 'evidence-minor'));
      const actions = el('div', null, 'evidence-actions');
      actions.append(button('연결 기록 보기', 'secondary small', () => openTaskDetails(task)));
      row.append(actions);
      body.append(row);
    }
  }
  $('dialog-content').append(body);
}
async function exportAll() {
  const control = $('export-button');
  control.disabled = true;
  try {
    const response = await fetch('/api/export', { cache: 'no-store' });
    if (response.status === 401) window.dispatchEvent(new Event('pds-session-ended'));
    if (!response.ok) throw new Error('내보내지 못했습니다. 서버 연결을 확인하고 다시 시도해 주세요.');
    if (!/^\s*attachment(?:;|$)/i.test(response.headers.get('Content-Disposition') || '')) {
      throw new Error('파일 다운로드 응답을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
    }
    // Check the export response first so failures keep this page and its drafts.
    // Then let the browser handle the server's attachment URL and filename directly.
    await response.arrayBuffer();
    window.location.assign('/api/export');
    notify('전체 자료를 담은 JSON 파일 하나의 다운로드를 요청했습니다.');
  } catch (error) { notify(error.message || '내보내지 못했습니다. 잠시 뒤 다시 시도해 주세요.', true); }
  finally { control.disabled = false; }
}

$('new-plan-button').addEventListener('click', () => openPlanForm());
$('reload-button').addEventListener('click', () => loadState({ announce: true }));
$('connection-retry').addEventListener('click', () => loadState({ announce: true }));
$('export-button').addEventListener('click', exportAll);
$('export-button').disabled = true;
$('dialog-close').addEventListener('click', closeDialog);
$('editor-dialog').addEventListener('cancel', (event) => { if (dialogBusy) event.preventDefault(); });
for (const stage of ['plan', 'do', 'see']) {
  const tab = $(`tab-${stage}`);
  tab.addEventListener('click', () => setStage(stage));
  tab.addEventListener('keydown', (event) => {
    const stages = ['plan', 'do', 'see'];
    let index = stages.indexOf(stage);
    if (event.key === 'ArrowRight') index = (index + 1) % stages.length;
    else if (event.key === 'ArrowLeft') index = (index + stages.length - 1) % stages.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = stages.length - 1;
    else return;
    event.preventDefault();
    setStage(stages[index], true);
  });
}
export async function bootDiary(csrf) {
  ui.csrf = csrf;
  render();
  return loadState();
}
