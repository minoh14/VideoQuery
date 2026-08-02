const { Router } = require('express');
const multer = require('multer');
const client = require('../lib/twelvelabs-client');

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

function waitForAssetReady(assetId, maxAttempts = 60) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const poll = async () => {
      attempts++;
      try {
        const asset = await client.assets.retrieve(assetId);
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

router.post('/', async (req, res, next) => {
  try {
    const { indexId, url, title } = req.body;
    if (!indexId || !url) {
      return res.status(400).json({ error: 'indexId and url are required' });
    }

    const asset = await client.assets.create({
      method: 'url',
      url,
      filename: title || undefined,
      enableHls: true,
      enableThumbnail: true,
    });

    res.status(202).json({
      assetId: asset.id,
      status: 'processing',
    });

    waitForAssetReady(asset.id)
      .then(() =>
        client.indexes.indexedAssets.create(indexId, {
          assetId: asset.id,
          enableVideoStream: true,
        })
      )
      .catch(() => {});
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
    const asset = await client.assets.create({
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

    waitForAssetReady(asset.id)
      .then(() =>
        client.indexes.indexedAssets.create(indexId, {
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
    const { indexId, page = '1', pageLimit = '10' } = req.query;
    if (!indexId) {
      return res.status(400).json({ error: 'indexId query parameter is required' });
    }

    const pageNum = Math.max(1, parseInt(page));
    const limit = Math.min(10, Math.max(1, parseInt(pageLimit)));

    const result = await client.indexes.indexedAssets.list(indexId, {
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
    const { indexId } = req.query;
    if (!indexId) {
      return res.status(400).json({ error: 'indexId query parameter is required' });
    }

    const allStatuses = [];
    let page = 1;
    while (true) {
      const result = await client.indexes.indexedAssets.list(indexId, { page, pageLimit: 50 });
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

    res.json({ statuses: allStatuses });
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
      const asset = await client.assets.retrieve(assetId);
      assetStatus = asset.status;
    }

    const indexedAsset = await client.indexes.indexedAssets.retrieve(indexId, id);

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

router.delete('/:id', async (req, res, next) => {
  try {
    const { indexId } = req.query;
    const { id } = req.params;

    if (!indexId) {
      return res.status(400).json({ error: 'indexId query parameter is required' });
    }

    await client.indexes.indexedAssets.delete(indexId, id);

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
