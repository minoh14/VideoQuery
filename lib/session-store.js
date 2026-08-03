const crypto = require('crypto');

const SESSION_COOKIE_NAME = 'videoquery_session';
const DEFAULT_TTL_HOURS = 8;

const configuredTtlHours = Number.parseFloat(process.env.SESSION_TTL_HOURS || '');
const sessionTtlMs = (Number.isFinite(configuredTtlHours) && configuredTtlHours > 0
  ? configuredTtlHours
  : DEFAULT_TTL_HOURS) * 60 * 60 * 1000;

const sessions = new Map();

function parseCookies(cookieHeader = '') {
  const cookies = {};
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

function getSessionToken(req) {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME] || null;
}

function createSession({ name, tlClient }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + sessionTtlMs;
  sessions.set(token, { name, tlClient, expiresAt });
  return { token, expiresAt };
}

function getSession(req) {
  const token = getSessionToken(req);
  if (!token) return null;

  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }

  return { token, ...session };
}

function destroySession(req) {
  const token = getSessionToken(req);
  if (token) sessions.delete(token);
}

function isSecureCookie() {
  return process.env.NODE_ENV === 'production' || process.env.SESSION_COOKIE_SECURE === 'true';
}

function setSessionCookie(res, token) {
  const maxAge = Math.floor(sessionTtlMs / 1000);
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ];
  if (isSecureCookie()) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

function clearSessionCookie(res) {
  const attributes = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
  ];
  if (isSecureCookie()) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

function requireSession(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  const session = getSession(req);
  if (!session) {
    clearSessionCookie(res);
    return res.status(401).json({ error: 'Authentication required' });
  }

  req.user = { name: session.name };
  req.tlClient = session.tlClient;
  next();
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}, 60 * 1000);
cleanupTimer.unref();

module.exports = {
  clearSessionCookie,
  createSession,
  destroySession,
  getSession,
  requireSession,
  setSessionCookie,
};
