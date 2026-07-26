const { Router } = require('express');
const client = require('../lib/twelvelabs-client');

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const { indexId, query, searchOptions } = req.body;
    if (!indexId || !query) {
      return res.status(400).json({ error: 'indexId and query are required' });
    }

    const result = await client.search.create({
      indexId,
      queryText: query,
      searchOptions: searchOptions || ['visual', 'audio'],
    });

    const clips = (result.data || []).map((item) => ({
      videoId: item.videoId,
      score: item.rank,
      start: item.start,
      end: item.end,
      thumbnailUrl: item.thumbnailUrl,
      transcription: item.transcription,
    }));

    res.json({ clips });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
