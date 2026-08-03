const { Router } = require('express');
const { createClient } = require('../lib/twelvelabs-client');
const {
  clearSessionCookie,
  createSession,
  destroySession,
  getSession,
  setSessionCookie,
} = require('../lib/session-store');

function createAuthRouter({ createTlClient = createClient } = {}) {
  const router = Router();

  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.post('/login', async (req, res, next) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';

      if (!name || !apiKey) {
        return res.status(400).json({ error: '이름과 API Key를 모두 입력하세요.' });
      }
      if (name.length > 80 || apiKey.length > 512) {
        return res.status(400).json({ error: '입력값이 허용된 길이를 초과했습니다.' });
      }

      const tlClient = createTlClient(apiKey);
      await tlClient.indexes.list({ pageLimit: 1 });

      destroySession(req);
      const session = createSession({ name, tlClient });
      setSessionCookie(res, session.token);

      res.json({
        authenticated: true,
        user: { name },
        expiresAt: new Date(session.expiresAt).toISOString(),
      });
    } catch (err) {
      if (err?.constructor?.name === 'AuthenticationError' || err?.status === 401) {
        return res.status(401).json({ error: '유효하지 않은 API Key입니다.' });
      }
      next(err);
    }
  });

  router.get('/session', (req, res) => {
    const session = getSession(req);
    if (!session) {
      clearSessionCookie(res);
      return res.status(401).json({ authenticated: false });
    }

    res.json({
      authenticated: true,
      user: { name: session.name },
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  });

  router.post('/logout', (req, res) => {
    destroySession(req);
    clearSessionCookie(res);
    res.status(204).end();
  });

  return router;
}

module.exports = { createAuthRouter };
