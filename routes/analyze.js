const { Router } = require('express');

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const { assetId, url, prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }
    if (!assetId && !url) {
      return res.status(400).json({ error: 'Either assetId or url is required' });
    }

    const params = {
      modelName: 'pegasus1.5',
      prompt,
    };

    if (assetId) {
      params.video = { type: 'asset_id', assetId };
    } else {
      params.video = { type: 'url', url };
    }

    const result = await req.tlClient.analyze(params);

    res.json({ text: result.data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
