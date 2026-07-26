require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const projectsRouter = require('./routes/projects');
const videosRouter = require('./routes/videos');
const searchRouter = require('./routes/search');
const analyzeRouter = require('./routes/analyze');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/projects', projectsRouter);
app.use('/api/videos', videosRouter);
app.use('/api/search', searchRouter);
app.use('/api/analyze', analyzeRouter);

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

  const status = statusMap[err.constructor?.name] || err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
  });
});

app.listen(PORT, () => {
  console.log(`VideoQuery server running on port ${PORT}`);
});
