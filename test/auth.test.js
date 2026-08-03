const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const { createAuthRouter } = require('../routes/auth');
const { requireSession } = require('../lib/session-store');

async function startTestServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter({
    createTlClient: (apiKey) => ({
      indexes: {
        list: async () => {
          if (apiKey !== 'valid-test-key') {
            const error = new Error('invalid key');
            error.status = 401;
            throw error;
          }
          return { data: [] };
        },
      },
    }),
  }));
  app.get('/api/protected', requireSession, (req, res) => {
    res.json({ name: req.user.name });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('API key is exchanged for an HttpOnly server session', async (t) => {
  const server = await startTestServer();
  t.after(server.close);

  const loginResponse = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '테스터', apiKey: 'valid-test-key' }),
  });

  assert.equal(loginResponse.status, 200);
  const loginBody = await loginResponse.json();
  assert.deepEqual(loginBody.user, { name: '테스터' });
  assert.equal(JSON.stringify(loginBody).includes('valid-test-key'), false);

  const cookie = loginResponse.headers.get('set-cookie');
  assert.match(cookie, /videoquery_session=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);

  const cookieHeader = cookie.split(';', 1)[0];
  const sessionResponse = await fetch(`${server.baseUrl}/api/auth/session`, {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(sessionResponse.status, 200);
  assert.deepEqual((await sessionResponse.json()).user, { name: '테스터' });

  const protectedResponse = await fetch(`${server.baseUrl}/api/protected`, {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(protectedResponse.status, 200);
  assert.deepEqual(await protectedResponse.json(), { name: '테스터' });

  const logoutResponse = await fetch(`${server.baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: cookieHeader },
  });
  assert.equal(logoutResponse.status, 204);
  assert.match(logoutResponse.headers.get('set-cookie'), /Max-Age=0/i);

  const afterLogoutResponse = await fetch(`${server.baseUrl}/api/protected`, {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(afterLogoutResponse.status, 401);
});

test('invalid API keys do not create a session', async (t) => {
  const server = await startTestServer();
  t.after(server.close);

  const response = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '테스터', apiKey: 'invalid' }),
  });

  assert.equal(response.status, 401);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('protected APIs reject requests without a session', async (t) => {
  const server = await startTestServer();
  t.after(server.close);

  const response = await fetch(`${server.baseUrl}/api/protected`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Authentication required' });
});
