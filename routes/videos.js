const { Router } = require('express');
const client = require('../lib/twelvelabs-client');

const router = Router();

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

router.get('/', async (req, res, next) => {
  try {
    const { indexId } = req.query;
    if (!indexId) {
      return res.status(400).json({ error: 'indexId query parameter is required' });
    }

    const result = await client.indexes.indexedAssets.list(indexId);
    const videos = (result.data || []).map((item) => ({
      id: item.id,
      assetId: item.assetId,
      filename: item.systemMetadata?.filename || null,
      duration: item.systemMetadata?.duration || null,
      status: item.status,
      createdAt: item.createdAt,
    }));

    res.json(videos);
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
