const fs = require('fs/promises');
const path = require('path');

const dataDirectory = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const storePath = path.join(dataDirectory, 'bookmarks.json');
const emptyStore = () => ({ version: 2, bookmarks: {}, collections: {} });

let writeQueue = Promise.resolve();

async function readStore() {
  try {
    const raw = await fs.readFile(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      version: 2,
      bookmarks: parsed && typeof parsed.bookmarks === 'object' && parsed.bookmarks
        ? parsed.bookmarks
        : {},
      collections: parsed && typeof parsed.collections === 'object' && parsed.collections
        ? parsed.collections
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

function updateBookmark(projectId, bookmarkId, fields) {
  return enqueueMutation(async (store) => {
    const projectBookmarks = store.bookmarks[projectId] || [];
    const target = projectBookmarks.find((item) => item.id === bookmarkId);
    if (!target) {
      const error = new Error('Bookmark not found');
      error.status = 404;
      throw error;
    }
    if (fields.note !== undefined) {
      target.note = String(fields.note || '').slice(0, 200);
    }
    return target;
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
    if (store.collections[projectId]) {
      store.collections[projectId].forEach((collection) => {
        collection.bookmarkIds = (collection.bookmarkIds || []).filter((id) => id !== bookmarkId);
        collection.updatedAt = new Date().toISOString();
      });
    }
    return true;
  });
}

async function listCollections(projectId) {
  await writeQueue;
  const store = await readStore();
  return [...(store.collections[projectId] || [])]
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function createCollection(projectId, collection) {
  return enqueueMutation(async (store) => {
    const projectCollections = store.collections[projectId] || [];
    const duplicate = projectCollections.some((item) => item.name.toLowerCase() === collection.name.toLowerCase());
    if (duplicate) {
      const error = new Error('A collection with this name already exists');
      error.status = 409;
      throw error;
    }

    store.collections[projectId] = [...projectCollections, collection];
    return collection;
  });
}

function updateCollection(projectId, collectionId, changes) {
  return enqueueMutation(async (store) => {
    const projectCollections = store.collections[projectId] || [];
    const index = projectCollections.findIndex((item) => item.id === collectionId);
    if (index === -1) {
      const error = new Error('Collection not found');
      error.status = 404;
      throw error;
    }

    const duplicate = projectCollections.some((item, itemIndex) => (
      itemIndex !== index && item.name.toLowerCase() === changes.name.toLowerCase()
    ));
    if (duplicate) {
      const error = new Error('A collection with this name already exists');
      error.status = 409;
      throw error;
    }

    const updated = {
      ...projectCollections[index],
      ...changes,
      updatedAt: new Date().toISOString(),
    };
    projectCollections[index] = updated;
    store.collections[projectId] = projectCollections;
    return updated;
  });
}

function deleteCollection(projectId, collectionId) {
  return enqueueMutation(async (store) => {
    const projectCollections = store.collections[projectId] || [];
    const nextCollections = projectCollections.filter((item) => item.id !== collectionId);
    if (nextCollections.length === projectCollections.length) {
      const error = new Error('Collection not found');
      error.status = 404;
      throw error;
    }

    store.collections[projectId] = nextCollections;
    return true;
  });
}

function addBookmarkToCollection(projectId, collectionId, bookmarkId) {
  return enqueueMutation(async (store) => {
    const collection = (store.collections[projectId] || []).find((item) => item.id === collectionId);
    if (!collection) {
      const error = new Error('Collection not found');
      error.status = 404;
      throw error;
    }
    const bookmark = (store.bookmarks[projectId] || []).find((item) => item.id === bookmarkId);
    if (!bookmark) {
      const error = new Error('Bookmark not found');
      error.status = 404;
      throw error;
    }

    if (!Array.isArray(collection.bookmarkIds)) collection.bookmarkIds = [];
    if (!collection.bookmarkIds.includes(bookmarkId)) collection.bookmarkIds.push(bookmarkId);
    collection.updatedAt = new Date().toISOString();
    return collection;
  });
}

function removeBookmarkFromCollection(projectId, collectionId, bookmarkId) {
  return enqueueMutation(async (store) => {
    const collection = (store.collections[projectId] || []).find((item) => item.id === collectionId);
    if (!collection) {
      const error = new Error('Collection not found');
      error.status = 404;
      throw error;
    }

    collection.bookmarkIds = (collection.bookmarkIds || []).filter((id) => id !== bookmarkId);
    collection.updatedAt = new Date().toISOString();
    return collection;
  });
}

module.exports = {
  addBookmark,
  addBookmarkToCollection,
  createCollection,
  deleteCollection,
  listBookmarks,
  listCollections,
  removeBookmarkFromCollection,
  updateBookmark,
  removeBookmark,
  updateCollection,
};
