require('dotenv').config();
const path = require('path');
const express = require('express');
const { createAuthRouter } = require('./routes/auth');
const { requireSession } = require('./lib/session-store');
const projectsRouter = require('./routes/projects');
const videosRouter = require('./routes/videos');
const searchRouter = require('./routes/search');
const analyzeRouter = require('./routes/analyze');
const bookmarksRouter = require('./routes/bookmarks');
const collectionsRouter = require('./routes/collections');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', createAuthRouter());
app.use('/api', requireSession);
app.use('/api/projects', projectsRouter);
app.use('/api/videos', videosRouter);
app.use('/api/search', searchRouter);
app.use('/api/analyze', analyzeRouter);
app.use('/api/bookmarks', bookmarksRouter);
app.use('/api/collections', collectionsRouter);

app.use((err, req, res, next) => {
  const statusMap = {
    BadRequestError: 400,
    AuthenticationError: 401,
    PermissionDeniedError: 403,
    NotFoundError: 404,
    ConflictError: 409,
    UnprocessableEntityError: 422,
    RateLimitError: 429,
    InternalServerError: 500,
  };

  const status = statusMap[err?.constructor?.name] || err?.status || 500;
  res.status(status).json({
    error: err?.message || 'Internal server error',
  });
});

app.listen(PORT, () => {
  console.log(`VideoQuery server running on port ${PORT}`);
});
