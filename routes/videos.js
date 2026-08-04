const { Router } = require('express');
const multer = require('multer');

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

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

router.post('/', async (req, res, next) => {
  try {
    const { indexId, url, title } = req.body;
    if (!indexId || !url) {
      return res.status(400).json({ error: 'indexId and url are required' });
    }

    const asset = await req.tlClient.assets.create({
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
    const { indexId, page = '1', pageLimit = '10', sortBy, filter } = req.query;
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
        filtered = allVideos.filter((v) => (v.filename || '').toLowerCase().includes(keyword));
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
    const { indexId } = req.query;
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

router.delete('/:id', async (req, res, next) => {
  try {
    const { indexId } = req.query;
    const { id } = req.params;

    if (!indexId) {
      return res.status(400).json({ error: 'indexId query parameter is required' });
    }

    await req.tlClient.indexes.indexedAssets.delete(indexId, id);

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
