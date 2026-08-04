const { Router } = require('express');
const multer = require('multer');

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

    const result = await req.tlClient.search.create(params);

    const clips = (result.data || []).map((item) => ({
      videoId: item.videoId,
      rank: item.rank || null,
      start: item.start,
      end: item.end,
      thumbnailUrl: item.thumbnailUrl,
      transcription: item.transcription,
    }));

    const videoIds = [...new Set(clips.map((c) => c.videoId).filter(Boolean))];
    const assetMap = {};
    await Promise.all(
      videoIds.map(async (id) => {
        try {
          const asset = await req.tlClient.indexes.indexedAssets.retrieve(indexId, id);
          assetMap[id] = {
            hlsUrl: asset.hls?.videoUrl || null,
            duration: asset.metadata?.duration || null,
            assetId: asset.assetId || null,
            filename: asset.systemMetadata?.filename || null,
            thumbnailUrl: asset.hls?.thumbnailUrls?.[0] || null,
          };
        } catch (e) {}
      })
    );
    clips.forEach((clip) => {
      const info = assetMap[clip.videoId] || {};
      clip.hlsUrl = info.hlsUrl || null;
      clip.videoDuration = info.duration || null;
      clip.assetId = info.assetId || null;
      clip.videoTitle = info.filename || null;
      clip.videoThumbnailUrl = info.thumbnailUrl || null;
    });

    res.json({ clips });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
