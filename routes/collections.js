const crypto = require('crypto');
const { Router } = require('express');
const {
  addBookmarkToCollection,
  createCollection,
  deleteCollection,
  listCollections,
  removeBookmarkFromCollection,
  updateCollection,
} = require('../lib/bookmark-store');

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

function getName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 100) {
    const error = new Error('Collection name must be between 1 and 100 characters');
    error.status = 400;
    throw error;
  }
  return name;
}

function getDescription(value) {
  return String(value || '').trim().slice(0, 500);
}

router.get('/', async (req, res, next) => {
  try {
    const projectId = requireProjectId(req.query.projectId);
    res.json({ collections: await listCollections(projectId) });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const projectId = requireProjectId(body.projectId);
    const now = new Date().toISOString();
    const collection = await createCollection(projectId, {
      id: crypto.randomUUID(),
      projectId,
      name: getName(body.name),
      description: getDescription(body.description),
      bookmarkIds: [],
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json(collection);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const body = req.body || {};
    const projectId = requireProjectId(body.projectId);
    const collection = await updateCollection(projectId, req.params.id, {
      name: getName(body.name),
      description: getDescription(body.description),
    });
    res.json(collection);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const projectId = requireProjectId(req.query.projectId);
    await deleteCollection(projectId, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post('/:id/bookmarks', async (req, res, next) => {
  try {
    const body = req.body || {};
    const projectId = requireProjectId(body.projectId);
    const collection = await addBookmarkToCollection(projectId, req.params.id, body.bookmarkId);
    res.json(collection);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/bookmarks/:bookmarkId', async (req, res, next) => {
  try {
    const projectId = requireProjectId(req.query.projectId);
    await removeBookmarkFromCollection(projectId, req.params.id, req.params.bookmarkId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
