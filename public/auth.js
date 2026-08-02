const SESSION_KEY = 'videoquery_session';

export function getSession() {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setSession(name, apiKey) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ name, apiKey }));
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

export function getApiKey() {
  const session = getSession();
  return session?.apiKey || '';
}

export function getUserName() {
  const session = getSession();
  return session?.name || '';
}

export async function apiFetch(url, options = {}) {
  const apiKey = getApiKey();
  const headers = { ...(options.headers || {}) };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    clearSession();
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.getElementById('login-view').classList.add('active');
    const errorEl = document.getElementById('login-error');
    errorEl.textContent = '세션이 만료되었습니다. 다시 로그인하세요.';
    errorEl.classList.remove('hidden');
  }
  return res;
}
