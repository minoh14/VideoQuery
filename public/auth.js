let currentSession = null;

export function getSession() {
  return currentSession;
}

export function setSession(name) {
  currentSession = { name };
}

export function clearSession() {
  currentSession = null;
}

export function getUserName() {
  const session = getSession();
  return session?.name || '';
}

export async function login(name, apiKey) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, apiKey }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.authenticated) {
    throw new Error(data.error || '로그인에 실패했습니다.');
  }
  setSession(data.user.name);
  return currentSession;
}

export async function restoreSession() {
  try {
    const res = await fetch('/api/auth/session', { credentials: 'same-origin' });
    if (!res.ok) {
      clearSession();
      return null;
    }
    const data = await res.json();
    setSession(data.user.name);
    return currentSession;
  } catch {
    clearSession();
    return null;
  }
}

export async function logout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    });
  } catch {
    // The local session should still be cleared if the server is unreachable.
  } finally {
    clearSession();
  }
}

export async function apiFetch(url, options = {}) {
  const res = await fetch(url, { ...options, credentials: 'same-origin' });
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
