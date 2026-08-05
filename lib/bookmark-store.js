const fs = require('fs/promises');
const path = require('path');

const dataDirectory = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const storePath = path.join(dataDirectory, 'bookmarks.json');
const emptyStore = () => ({ version: 1, bookmarks: {} });

let writeQueue = Promise.resolve();

async function readStore() {
  try {
    const raw = await fs.readFile(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      bookmarks: parsed && typeof parsed.bookmarks === 'object' && parsed.bookmarks
        ? parsed.bookmarks
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

async function listBookmarks(projectId) {
  await writeQueue;
  const store = await readStore();
  return [...(store.bookmarks[projectId] || [])]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function addBookmark(projectId, bookmark) {
  return enqueueMutation(async (store) => {
    const projectBookmarks = store.bookmarks[projectId] || [];
    const duplicate = projectBookmarks.find((item) => (
      item.videoId === bookmark.videoId
      && item.start === bookmark.start
      && item.end === bookmark.end
    ));
    if (duplicate) {
      const error = new Error('This clip is already bookmarked');
      error.status = 409;
      throw error;
    }

    store.bookmarks[projectId] = [...projectBookmarks, bookmark];
    return bookmark;
  });
}

function removeBookmark(projectId, bookmarkId) {
  return enqueueMutation(async (store) => {
    const projectBookmarks = store.bookmarks[projectId] || [];
    const nextBookmarks = projectBookmarks.filter((item) => item.id !== bookmarkId);
    if (nextBookmarks.length === projectBookmarks.length) {
      const error = new Error('Bookmark not found');
      error.status = 404;
      throw error;
    }

    store.bookmarks[projectId] = nextBookmarks;
    return true;
  });
}

module.exports = {
  addBookmark,
  listBookmarks,
  removeBookmark,
};
