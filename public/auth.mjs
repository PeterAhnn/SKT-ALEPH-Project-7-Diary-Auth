import { bootDiary } from './app.mjs';

const $ = id => document.getElementById(id);
let mode = 'login';
let session = null;
let accountAction = null;
async function request(path, options = {}) {
  const response = await fetch(path, { ...options, cache: 'no-store', headers: {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(session?.csrf && options.method ? { 'X-CSRF-Token': session.csrf } : {})
  } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || '요청을 완료하지 못했습니다.');
  return result.data;
}
async function enter(data) {
  session = data;
  $('auth-panel').hidden = true;
  $('diary-shell').hidden = false;
  $('account-label').textContent = data.user.email;
  $('auth-form').reset();
  $('auth-message').textContent = '';
  await bootDiary(data.csrf);
}
function setMode(next) {
  mode = next;
  $('auth-submit').textContent = next === 'login' ? '로그인' : '가입';
  $('auth-password').autocomplete = next === 'login' ? 'current-password' : 'new-password';
  $('auth-password').minLength = next === 'login' ? 1 : 12;
  $('auth-help').textContent = next === 'login' ? '비밀번호를 잊은 경우 현재는 자동 재설정을 지원하지 않습니다.' : '비밀번호는 12자 이상으로 정하세요. 이메일 인증은 아직 지원하지 않으므로 실제 이메일 소유를 확인하지 않습니다.';
  $('auth-login-tab').className = `button ${next === 'login' ? 'primary' : 'secondary'}`;
  $('auth-register-tab').className = `button ${next === 'register' ? 'primary' : 'secondary'}`;
  $('auth-message').textContent = '';
  $('auth-password').value = '';
}
$('auth-login-tab').addEventListener('click', () => setMode('login'));
$('auth-register-tab').addEventListener('click', () => setMode('register'));
$('auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('auth-submit').disabled = true;
  const input = { email: $('auth-email').value, password: $('auth-password').value };
  try {
    const data = await request(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify(input) });
    if (mode === 'register') { setMode('login'); $('auth-message').textContent = '가입했습니다. 만든 계정으로 로그인해 주세요.'; }
    else await enter(data);
  } catch (error) { $('auth-message').textContent = error.message || '서버 연결을 확인해 주세요.'; }
  finally { $('auth-password').value = ''; $('auth-submit').disabled = false; }
});
$('logout-button').addEventListener('click', async () => {
  $('logout-button').disabled = true;
  try { await request('/api/auth/logout', { method: 'POST' }); window.location.replace('/'); }
  catch (error) { $('account-label').textContent = error.message; $('logout-button').disabled = false; }
});
function openAccount(action) {
  accountAction = action;
  const deleting = action === 'delete';
  $('account-form').reset();
  $('account-message').textContent = '';
  $('account-dialog-title').textContent = deleting ? '계정과 내 자료 삭제' : '비밀번호 변경';
  $('account-warning').textContent = deleting ? '이 앱의 계정과 내 기록을 함께 삭제합니다. 복구할 수 없습니다. 먼저 전체 내보내기로 보관하세요. 삭제할 계정 아이디와 현재 비밀번호를 입력한 뒤 삭제 버튼을 눌러야 진행됩니다.' : '변경하면 이 계정의 모든 로그인이 종료됩니다. 새 비밀번호로 다시 로그인하세요.';
  $('account-new-password-field').hidden = deleting;
  $('account-new-password').required = !deleting;
  $('account-new-password').minLength = 12;
  $('account-confirm-field').hidden = !deleting;
  $('account-confirm').required = deleting;
  $('account-submit').textContent = deleting ? '계정과 내 자료 영구 삭제' : '비밀번호 변경';
  $('account-dialog').showModal();
}
$('password-button').addEventListener('click', () => openAccount('password'));
$('account-delete-button').addEventListener('click', () => openAccount('delete'));
$('account-cancel').addEventListener('click', () => $('account-dialog').close());
$('account-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('account-submit').disabled = true;
  const deleting = accountAction === 'delete';
  const input = { current_password: $('account-current-password').value,
    ...(deleting ? { confirm: $('account-confirm').value } : { password: $('account-new-password').value }) };
  try {
    await request(deleting ? '/api/auth/account' : '/api/auth/password', { method: deleting ? 'DELETE' : 'POST', body: JSON.stringify(input) });
    window.location.replace('/');
  } catch (error) { $('account-message').textContent = error.message || '서버 연결을 확인해 주세요.'; }
  finally { $('account-current-password').value = ''; $('account-new-password').value = ''; $('account-submit').disabled = false; }
});
window.addEventListener('pds-session-ended', () => window.location.replace('/'));
window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
try {
  const data = await request('/api/auth/session');
  if (data.user) await enter(data);
} catch { $('auth-message').textContent = '서버에 연결하지 못했습니다. 잠시 뒤 새로고침해 주세요.'; }
