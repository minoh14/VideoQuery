const { Router } = require('express');
const multer = require('multer');
const { getMeta, setMeta, deleteMeta, getBatchMeta, validateMeta } = require('../lib/video-meta-store');
const {
  finalizeSource,
  normalizeUrl,
  removeSourceByAssetId,
  releaseSource,
  reserveSource,
} = require('../lib/video-source-store');

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
const multipartSessions = new Map();
const MAX_MULTIPART_SIZE = 10 * 1024 * 1024 * 1024;
const MULTIPART_SESSION_TTL = 24 * 60 * 60 * 1000;

function waitForAssetReady(tlClient, assetId, maxAttempts = 60) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const poll = async () => {
      attempts++;
      try {
        const asset = await tlClient.assets.retrieve(assetId);
        if (asset.status === 'ready') return resolve(asset);
        if (asset.status === 'failed') return reject(new Error('Asset processing failed'));
        if (attempts >= maxAttempts) return reject(new Error('Asset processing timed out'));
        setTimeout(poll, 2000);
      } catch (err) {
        reject(err);
      }
    };
    poll();
  });
}

function parsePositiveInteger(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    const error = new Error(`${fieldName} must be a positive integer`);
    error.status = 400;
    throw error;
  }
  return parsed;
}

function getMultipartSession(uploadId) {
  const session = multipartSessions.get(uploadId);
  if (!session) {
    const error = new Error('Multipart upload session not found or expired');
    error.status = 404;
    throw error;
  }
  return session;
}

async function getPresignedUrl(tlClient, session, chunkIndex) {
  let url = session.uploadUrls.get(chunkIndex);
  if (url) return url;

  const result = await tlClient.multipartUpload.getAdditionalPresignedUrls(session.uploadId, {
    start: chunkIndex,
    count: 1,
  });
  for (const uploadUrl of result.uploadUrls || []) {
    if (uploadUrl.chunkIndex && uploadUrl.url) {
      session.uploadUrls.set(uploadUrl.chunkIndex, uploadUrl.url);
    }
  }

  url = session.uploadUrls.get(chunkIndex);
  if (!url) {
    const error = new Error(`No upload URL available for chunk ${chunkIndex}`);
    error.status = 502;
    throw error;
  }
  return url;
}

async function indexMultipartAsset(session, tlClient) {
  try {
    await waitForAssetReady(tlClient, session.assetId, 300);
    await tlClient.indexes.indexedAssets.create(session.indexId, {
      assetId: session.assetId,
      enableVideoStream: true,
    });
  } catch (err) {
    console.error(`Failed to index multipart asset ${session.assetId}:`, err.message);
  } finally {
    multipartSessions.delete(session.uploadId);
  }
}

// Create a TwelveLabs multipart session. The actual file bytes are uploaded
// through /multipart/chunk, so the server never buffers the complete file.
router.post('/multipart/init', async (req, res, next) => {
  try {
    const { indexId, filename, fileSize, contentType } = req.body;
    if (!indexId || !filename) {
      return res.status(400).json({ error: 'indexId and filename are required' });
    }

    const totalSize = parsePositiveInteger(fileSize, 'fileSize');
    if (totalSize > MAX_MULTIPART_SIZE) {
      return res.status(413).json({ error: 'Multipart uploads are limited to 10GB' });
    }

    const type = contentType?.startsWith('audio/') ? 'audio' : 'video';
    const sessionResponse = await req.tlClient.multipartUpload.create({
      filename,
      type,
      totalSize,
    });

    if (!sessionResponse.uploadId || !sessionResponse.assetId || !sessionResponse.chunkSize) {
      throw new Error('TwelveLabs returned an incomplete multipart upload session');
    }

    const session = {
      uploadId: sessionResponse.uploadId,
      assetId: sessionResponse.assetId,
      indexId,
      totalSize,
      chunkSize: sessionResponse.chunkSize,
      totalChunks: sessionResponse.totalChunks || Math.ceil(totalSize / sessionResponse.chunkSize),
      uploadUrls: new Map(
        (sessionResponse.uploadUrls || [])
          .filter((item) => item.chunkIndex && item.url)
          .map((item) => [item.chunkIndex, item.url])
      ),
    };
    multipartSessions.set(session.uploadId, session);

    const cleanupTimer = setTimeout(() => multipartSessions.delete(session.uploadId), MULTIPART_SESSION_TTL);
    cleanupTimer.unref?.();

    res.status(201).json({
      uploadId: session.uploadId,
      assetId: session.assetId,
      chunkSize: session.chunkSize,
      totalChunks: session.totalChunks,
    });
  } catch (err) {
    next(err);
  }
});

// Stream one browser request directly to the TwelveLabs presigned storage URL.
router.post('/multipart/chunk', async (req, res, next) => {
  try {
    const uploadId = req.query.uploadId;
    const chunkIndex = parsePositiveInteger(req.query.chunkIndex, 'chunkIndex');
    if (!uploadId) {
      return res.status(400).json({ error: 'uploadId is required' });
    }

    const session = getMultipartSession(uploadId);
    if (chunkIndex > session.totalChunks) {
      return res.status(400).json({ error: 'chunkIndex is out of range' });
    }

    const expectedSize = Math.min(
      session.chunkSize,
      session.totalSize - ((chunkIndex - 1) * session.chunkSize)
    );
    const requestSize = req.headers['content-length'] ? Number(req.headers['content-length']) : null;
    if (requestSize != null && requestSize !== expectedSize) {
      return res.status(400).json({ error: `Chunk ${chunkIndex} must be ${expectedSize} bytes` });
    }

    const url = await getPresignedUrl(req.tlClient, session, chunkIndex);
    const headers = { 'Content-Type': 'application/octet-stream' };
    if (requestSize != null) headers['Content-Length'] = String(requestSize);

    let response;
    try {
      response = await fetch(url, {
        method: 'PUT',
        body: req,
        duplex: 'half',
        headers,
      });
    } catch (err) {
      session.uploadUrls.delete(chunkIndex);
      throw err;
    }

    await response.arrayBuffer().catch(() => {});
    if (!response.ok) {
      session.uploadUrls.delete(chunkIndex);
      const error = new Error(`Chunk upload failed with HTTP ${response.status}`);
      error.status = 502;
      throw error;
    }

    const proof = response.headers.get('etag')?.replace(/"/g, '');
    if (!proof) {
      session.uploadUrls.delete(chunkIndex);
      const error = new Error('TwelveLabs did not return an ETag for the uploaded chunk');
      error.status = 502;
      throw error;
    }

    session.uploadUrls.delete(chunkIndex);
    res.json({ chunkIndex, proof, proofType: 'etag', chunkSize: expectedSize });
  } catch (err) {
    next(err);
  }
});

// Report one or more successfully uploaded chunks to TwelveLabs.
router.post('/multipart/report', async (req, res, next) => {
  try {
    const { uploadId, completedChunks } = req.body;
    if (!uploadId || !Array.isArray(completedChunks) || completedChunks.length === 0) {
      return res.status(400).json({ error: 'uploadId and completedChunks are required' });
    }

    const session = getMultipartSession(uploadId);
    if (completedChunks.length > 50) {
      return res.status(400).json({ error: 'A maximum of 50 chunks can be reported at once' });
    }

    const sanitizedChunks = completedChunks.map((chunk) => ({
      chunkIndex: parsePositiveInteger(chunk.chunkIndex, 'chunkIndex'),
      proof: String(chunk.proof || ''),
      proofType: 'etag',
      chunkSize: parsePositiveInteger(chunk.chunkSize, 'chunkSize'),
    }));
    if (sanitizedChunks.some((chunk) => chunk.chunkIndex > session.totalChunks || !chunk.proof)) {
      return res.status(400).json({ error: 'Invalid completed chunk data' });
    }

    const result = await req.tlClient.multipartUpload.reportChunkBatch(uploadId, {
      completedChunks: sanitizedChunks,
    });
    const uploadComplete = Boolean(result.url || result.totalCompleted >= session.totalChunks);

    if (uploadComplete) {
      res.status(202).json({
        assetId: session.assetId,
        uploadComplete: true,
        status: 'processing',
      });
      indexMultipartAsset(session, req.tlClient);
      return;
    }

    res.json({
      assetId: session.assetId,
      uploadComplete: false,
      totalCompleted: result.totalCompleted || 0,
      totalChunks: session.totalChunks,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { indexId, url, title } = req.body;
    if (!indexId || !url) {
      return res.status(400).json({ error: 'indexId and url are required' });
    }

    let reservation;
    try {
      const sourceUrl = String(url).trim();
      reservation = await reserveSource(indexId, {
        url: sourceUrl,
        normalizedUrl: normalizeUrl(sourceUrl),
        title,
      });

      const asset = await req.tlClient.assets.create({
        method: 'url',
        url: sourceUrl,
        filename: title || undefined,
        enableHls: true,
        enableThumbnail: true,
      });

      await finalizeSource(indexId, reservation.id, {
        assetId: asset.id,
        status: 'processing',
      });

      res.status(202).json({
        assetId: asset.id,
        status: 'processing',
      });

      const tlClient = req.tlClient;
      waitForAssetReady(tlClient, asset.id)
        .then(() =>
          tlClient.indexes.indexedAssets.create(indexId, {
            assetId: asset.id,
            enableVideoStream: true,
          })
        )
        .catch(() => {});
    } catch (err) {
      if (reservation) await releaseSource(indexId, reservation.id).catch(() => {});
      if (err.code === 'DUPLICATE_URL') {
        return res.status(409).json({
          error: err.message,
          duplicate: true,
          existing: err.source,
        });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    const { indexId } = req.body;
    if (!indexId || !req.file) {
      return res.status(400).json({ error: 'indexId and file are required' });
    }

    const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
    const asset = await req.tlClient.assets.create({
      method: 'direct',
      file: blob,
      filename: req.file.originalname || undefined,
      enableHls: true,
      enableThumbnail: true,
    });

    res.status(202).json({
      assetId: asset.id,
      status: 'processing',
    });

    const tlClient = req.tlClient;
    waitForAssetReady(tlClient, asset.id)
      .then(() =>
        tlClient.indexes.indexedAssets.create(indexId, {
          assetId: asset.id,
          enableVideoStream: true,
        })
      )
      .catch(() => {});
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { indexId, page = '1', pageLimit = '10', sortBy, filter, filterFields } = req.query;
    if (!indexId) {
      return res.status(400).json({ error: 'indexId query parameter is required' });
    }

    const pageNum = Math.max(1, parseInt(page));
    const limit = Math.min(10, Math.max(1, parseInt(pageLimit)));
    const needsFullFetch = (sortBy && sortBy !== 'newest') || filter;

    if (needsFullFetch) {
      const allVideos = [];
      let p = 1;
      while (true) {
        const result = await req.tlClient.indexes.indexedAssets.list(indexId, { page: p, pageLimit: 50 });
        const items = result.data || [];
        for (const item of items) {
          allVideos.push({
            id: item.id,
            assetId: item.assetId,
            filename: item.systemMetadata?.filename || null,
            duration: item.systemMetadata?.duration || null,
            status: item.status,
            createdAt: item.createdAt,
            hlsUrl: item.hls?.video_url || null,
            thumbnailUrl: item.hls?.thumbnail_urls?.[0] || null,
          });
        }
        const totalPage = result.response?.pageInfo?.totalPage || 1;
        if (p >= totalPage) break;
        p++;
      }

      let filtered = allVideos;
      if (filter) {
        const keyword = filter.toLowerCase();
        const fields = filterFields ? filterFields.split(',') : ['name'];
        const metas = fields.includes('tag') || fields.includes('memo')
          ? await getBatchMeta(indexId, allVideos.map((v) => v.id))
          : {};
        filtered = allVideos.filter((v) => {
          if (fields.includes('name') && (v.filename || '').toLowerCase().includes(keyword)) return true;
          const meta = metas[v.id];
          if (meta && fields.includes('tag') && meta.tags && meta.tags.some((t) => t.toLowerCase().includes(keyword))) return true;
          if (meta && fields.includes('memo') && (meta.memo || '').toLowerCase().includes(keyword)) return true;
          return false;
        });
      }

      if (sortBy && sortBy !== 'newest') {
        filtered.sort((a, b) => {
          switch (sortBy) {
            case 'oldest': return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
            case 'name': return (a.filename || '').localeCompare(b.filename || '');
            case 'longest': return (b.duration || 0) - (a.duration || 0);
            case 'shortest': return (a.duration || 0) - (b.duration || 0);
            default: return 0;
          }
        });
      }

      const totalResults = filtered.length;
      const totalPageCount = Math.ceil(totalResults / limit) || 1;
      const start = (pageNum - 1) * limit;
      const videos = filtered.slice(start, start + limit);

      return res.json({
        videos,
        pageInfo: {
          page: pageNum,
          pageLimit: limit,
          totalPage: totalPageCount,
          totalResults,
        },
      });
    }

    const result = await req.tlClient.indexes.indexedAssets.list(indexId, {
      page: pageNum,
      pageLimit: limit,
    });

    const rawData = result.data || [];
    const videos = rawData.map((item) => ({
      id: item.id,
      assetId: item.assetId,
      filename: item.systemMetadata?.filename || null,
      duration: item.systemMetadata?.duration || null,
      status: item.status,
      createdAt: item.createdAt,
      hlsUrl: item.hls?.video_url || null,
      thumbnailUrl: item.hls?.thumbnail_urls?.[0] || null,
    }));

    const pi = result.response?.pageInfo || {};
    const totalResults = pi.totalResults || videos.length;
    const totalPage = pi.totalPage || Math.ceil(totalResults / limit) || 1;

    res.json({
      videos,
      pageInfo: {
        page: pageNum,
        pageLimit: limit,
        totalPage,
        totalResults,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/statuses', async (req, res, next) => {
  try {
    const { indexId, pendingAssetIds } = req.query;
    if (!indexId) {
      return res.status(400).json({ error: 'indexId query parameter is required' });
    }

    const allStatuses = [];
    let page = 1;
    while (true) {
      const result = await req.tlClient.indexes.indexedAssets.list(indexId, { page, pageLimit: 50 });
      const items = result.data || [];
      for (const item of items) {
        allStatuses.push({
          id: item.id,
          assetId: item.assetId,
          filename: item.systemMetadata?.filename || null,
          status: item.status,
        });
      }
      const totalPage = result.response?.pageInfo?.totalPage || 1;
      if (page >= totalPage) break;
      page++;
    }

    const indexedAssetIds = new Set(allStatuses.map((s) => s.assetId).filter(Boolean));
    const pendingStatuses = [];
    if (pendingAssetIds) {
      const ids = pendingAssetIds.split(',').filter((id) => id && !indexedAssetIds.has(id));
      await Promise.all(ids.map(async (assetId) => {
        try {
          const asset = await req.tlClient.assets.retrieve(assetId);
          pendingStatuses.push({
            id: null,
            assetId,
            filename: asset.systemMetadata?.filename || null,
            status: asset.status === 'ready' ? 'pending_index' : asset.status,
          });
        } catch {
          // asset not found or error — ignore
        }
      }));
    }

    res.json({ statuses: allStatuses, pendingStatuses });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/status', async (req, res, next) => {
  try {
    const { indexId, assetId } = req.query;
    const { id } = req.params;

    if (!indexId) {
      return res.status(400).json({ error: 'indexId query parameter is required' });
    }

    let assetStatus = null;
    if (assetId) {
      const asset = await req.tlClient.assets.retrieve(assetId);
      assetStatus = asset.status;
    }

    const indexedAsset = await req.tlClient.indexes.indexedAssets.retrieve(indexId, id);

    res.json({
      assetStatus,
      indexedAssetStatus: indexedAsset.status,
      assetReady: assetStatus === 'ready',
      searchReady: indexedAsset.status === 'ready',
    });
  } catch (err) {
    next(err);
  }
});

router.get('/meta/batch', async (req, res, next) => {
  try {
    const { indexId, ids } = req.query;
    if (!indexId || !ids) {
      return res.status(400).json({ error: 'indexId and ids are required' });
    }
    const videoIds = ids.split(',').filter(Boolean);
    const metas = await getBatchMeta(indexId, videoIds);
    res.json(metas);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/meta', async (req, res, next) => {
  try {
    const { indexId } = req.query;
    if (!indexId) {
      return res.status(400).json({ error: 'indexId query parameter is required' });
    }
    const meta = await getMeta(indexId, req.params.id);
    res.json(meta);
  } catch (err) {
    next(err);
  }
});

router.put('/:id/meta', async (req, res, next) => {
  try {
    const { indexId } = req.query;
    if (!indexId) {
      return res.status(400).json({ error: 'indexId query parameter is required' });
    }
    const { tags, memo } = req.body;
    const error = validateMeta({ tags, memo });
    if (error) return res.status(400).json({ error });
    const result = await setMeta(indexId, req.params.id, { tags, memo });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/meta', async (req, res, next) => {
  try {
    const { indexId } = req.query;
    if (!indexId) {
      return res.status(400).json({ error: 'indexId query parameter is required' });
    }
    await deleteMeta(indexId, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { indexId } = req.query;
    const { id } = req.params;

    if (!indexId) {
      return res.status(400).json({ error: 'indexId query parameter is required' });
    }

    let indexedAsset;
    try {
      indexedAsset = await req.tlClient.indexes.indexedAssets.retrieve(indexId, id);
    } catch {
      // The indexed asset may already be unavailable; continue deleting it.
    }
    await req.tlClient.indexes.indexedAssets.delete(indexId, id);
    await deleteMeta(indexId, id).catch(() => {});
    const assetId = req.query.assetId || indexedAsset?.assetId;
    if (assetId) await removeSourceByAssetId(indexId, assetId).catch(() => {});

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
