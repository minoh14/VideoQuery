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

export function apiFetch(url, options = {}) {
  const apiKey = getApiKey();
  const headers = { ...(options.headers || {}) };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }
  return fetch(url, { ...options, headers });
}
