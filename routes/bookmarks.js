const crypto = require('crypto');
const { Router } = require('express');
const { addBookmark, listBookmarks, removeBookmark } = require('../lib/bookmark-store');

const router = Router();

function requireProjectId(value) {
  const projectId = String(value || '').trim();
  if (!projectId || projectId.length > 200) {
    const error = new Error('projectId is required');
    error.status = 400;
    throw error;
  }
  return projectId;
}

function parseTimestamp(value, fieldName) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    const error = new Error(`${fieldName} must be a non-negative number`);
    error.status = 400;
    throw error;
  }
  return timestamp;
}

function optionalText(value, maxLength) {
  if (value == null) return null;
  return String(value).slice(0, maxLength);
}

router.get('/', async (req, res, next) => {
  try {
    const projectId = requireProjectId(req.query.projectId);
    res.json({ bookmarks: await listBookmarks(projectId) });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const projectId = requireProjectId(body.projectId);
    const {
      videoId,
      assetId,
      videoTitle,
      start,
      end,
      rank,
      transcription,
      thumbnailUrl,
      hlsUrl,
      query,
    } = body;

    if (!videoId) return res.status(400).json({ error: 'videoId is required' });
    const startTime = parseTimestamp(start, 'start');
    const endTime = parseTimestamp(end, 'end');
    if (endTime <= startTime) {
      return res.status(400).json({ error: 'end must be greater than start' });
    }

    const bookmark = {
      id: crypto.randomUUID(),
      projectId,
      videoId: String(videoId),
      assetId: optionalText(assetId, 300),
      videoTitle: optionalText(videoTitle, 500) || String(videoId),
      start: startTime,
      end: endTime,
      rank: Number.isFinite(Number(rank)) ? Number(rank) : null,
      transcription: optionalText(transcription, 5000) || '',
      thumbnailUrl: optionalText(thumbnailUrl, 2000),
      hlsUrl: optionalText(hlsUrl, 2000),
      query: optionalText(query, 2000) || '',
      createdAt: new Date().toISOString(),
    };

    const saved = await addBookmark(projectId, bookmark);
    res.status(201).json(saved);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const projectId = requireProjectId(req.query.projectId);
    await removeBookmark(projectId, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
