const { Router } = require('express');
const multer = require('multer');
const client = require('../lib/twelvelabs-client');

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/', upload.single('image'), async (req, res, next) => {
  try {
    const indexId = req.body.indexId;
    const query = req.body.query;
    const searchOptions = req.body.searchOptions ? JSON.parse(req.body.searchOptions) : ['visual', 'audio'];

    if (!indexId) {
      return res.status(400).json({ error: 'indexId is required' });
    }
    if (!query && !req.file) {
      return res.status(400).json({ error: 'query or image is required' });
    }

    const params = {
      indexId,
      searchOptions,
      pageLimit: 20,
    };

    if (query) params.queryText = query;

    if (req.file) {
      params.queryMediaType = 'image';
      params.queryMediaFile = new Blob([req.file.buffer], { type: req.file.mimetype });
    }

    const result = await client.search.create(params);

    const clips = (result.data || []).map((item) => ({
      videoId: item.videoId,
      score: item.rank,
      start: item.start,
      end: item.end,
      thumbnailUrl: item.thumbnailUrl,
      transcription: item.transcription,
    }));

    const videoIds = [...new Set(clips.map((c) => c.videoId).filter(Boolean))];
    const hlsMap = {};
    await Promise.all(
      videoIds.map(async (id) => {
        try {
          const asset = await client.indexes.indexedAssets.retrieve(indexId, id);
          if (asset.hls?.videoUrl) hlsMap[id] = asset.hls.videoUrl;
        } catch (e) {}
      })
    );
    clips.forEach((clip) => {
      clip.hlsUrl = hlsMap[clip.videoId] || null;
    });

    res.json({ clips });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
