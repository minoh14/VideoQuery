const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const dataDirectory = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const storePath = path.join(dataDirectory, 'video-sources.json');
const PENDING_SOURCE_TTL = 30 * 60 * 1000;
const emptyStore = () => ({ version: 1, sources: {} });

let writeQueue = Promise.resolve();

async function readStore() {
  try {
    const raw = await fs.readFile(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      sources: parsed && typeof parsed.sources === 'object' && parsed.sources
        ? parsed.sources
        : {},
    };
  } catch (err) {
    if (err.code === 'ENOENT') return emptyStore();
    throw err;
  }
}

async function writeStore(store) {
  await fs.mkdir(dataDirectory, { recursive: true });
  const temporaryPath = `${storePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, storePath);
}

function enqueueMutation(mutator) {
  const operation = writeQueue.then(async () => {
    const store = await readStore();
    const result = await mutator(store);
    await writeStore(store);
    return result;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

function invalidUrl(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizeUrl(value) {
  const input = String(value || '').trim();
  if (!input) throw invalidUrl('url is required');

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw invalidUrl('url must be a valid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw invalidUrl('url must use http or https');
  }

  parsed.hostname = parsed.hostname.toLowerCase();
  if ((parsed.protocol === 'http:' && parsed.port === '80')
    || (parsed.protocol === 'https:' && parsed.port === '443')) {
    parsed.port = '';
  }
  parsed.hash = '';

  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_[a-z0-9_]+|fbclid|gclid|dclid|mc_cid|mc_eid)$/i.test(key)) {
      parsed.searchParams.delete(key);
    }
  }
  parsed.searchParams.sort();
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';

  return parsed.toString();
}

function isExpiredPending(source) {
  return source.status === 'pending'
    && Date.now() - new Date(source.createdAt).getTime() > PENDING_SOURCE_TTL;
}

function reserveSource(projectId, source) {
  return enqueueMutation(async (store) => {
    const existingSources = store.sources[projectId] || [];
    const projectSources = existingSources.filter((item) => !isExpiredPending(item));
    const duplicate = projectSources.find((item) => item.normalizedUrl === source.normalizedUrl);
    if (duplicate) {
      const error = new Error('This URL is already added to this project');
      error.status = 409;
      error.code = 'DUPLICATE_URL';
      error.source = duplicate;
      throw error;
    }

    const reserved = {
      id: crypto.randomUUID(),
      projectId,
      url: source.url,
      normalizedUrl: source.normalizedUrl,
      title: source.title || null,
      assetId: null,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    store.sources[projectId] = [...projectSources, reserved];
    return reserved;
  });
}

function finalizeSource(projectId, sourceId, fields) {
  return enqueueMutation(async (store) => {
    const projectSources = store.sources[projectId] || [];
    const source = projectSources.find((item) => item.id === sourceId);
    if (!source) return null;
    Object.assign(source, fields, { updatedAt: new Date().toISOString() });
    store.sources[projectId] = projectSources;
    return source;
  });
}

function releaseSource(projectId, sourceId) {
  return enqueueMutation(async (store) => {
    const projectSources = store.sources[projectId] || [];
    store.sources[projectId] = projectSources.filter((item) => item.id !== sourceId);
    return true;
  });
}

function removeSourceByAssetId(projectId, assetId) {
  return enqueueMutation(async (store) => {
    const projectSources = store.sources[projectId] || [];
    store.sources[projectId] = projectSources.filter((item) => item.assetId !== assetId);
    return true;
  });
}

function clearSources(projectId) {
  return enqueueMutation(async (store) => {
    delete store.sources[projectId];
    return true;
  });
}

module.exports = {
  clearSources,
  finalizeSource,
  normalizeUrl,
  removeSourceByAssetId,
  releaseSource,
  reserveSource,
};
