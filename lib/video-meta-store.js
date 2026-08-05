const fs = require('fs/promises');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const META_FILE = path.join(DATA_DIR, 'video-metas.json');

let cache = null;

async function loadStore() {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(META_FILE, 'utf-8');
    cache = JSON.parse(raw);
  } catch {
    cache = {};
  }
  return cache;
}

async function saveStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = META_FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2));
  await fs.rename(tmp, META_FILE);
}

function makeKey(projectId, videoId) {
  return `${projectId}:${videoId}`;
}

function validateMeta({ tags, memo }) {
  if (tags !== undefined) {
    if (!Array.isArray(tags)) return 'tags must be an array';
    if (tags.length > 10) return 'tags cannot exceed 10';
    for (const tag of tags) {
      if (typeof tag !== 'string' || tag.length > 30) return 'each tag must be a string of max 30 chars';
    }
  }
  if (memo !== undefined) {
    if (typeof memo !== 'string') return 'memo must be a string';
    if (memo.length > 1000) return 'memo cannot exceed 1000 chars';
  }
  return null;
}

async function getMeta(projectId, videoId) {
  const store = await loadStore();
  const entry = store[makeKey(projectId, videoId)];
  return entry || { tags: [], memo: '' };
}

async function setMeta(projectId, videoId, { tags, memo }) {
  const store = await loadStore();
  const key = makeKey(projectId, videoId);
  const existing = store[key] || { tags: [], memo: '' };
  if (tags !== undefined) existing.tags = tags.map((t) => t.trim()).filter(Boolean);
  if (memo !== undefined) existing.memo = memo.trim();
  existing.updatedAt = new Date().toISOString();
  store[key] = existing;
  await saveStore();
  return existing;
}

async function deleteMeta(projectId, videoId) {
  const store = await loadStore();
  delete store[makeKey(projectId, videoId)];
  await saveStore();
}

async function getBatchMeta(projectId, videoIds) {
  const store = await loadStore();
  const result = {};
  for (const id of videoIds) {
    const entry = store[makeKey(projectId, id)];
    if (entry) result[id] = entry;
  }
  return result;
}

module.exports = { getMeta, setMeta, deleteMeta, getBatchMeta, validateMeta };
