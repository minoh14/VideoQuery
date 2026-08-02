const { Router } = require('express');
const client = require('../lib/twelvelabs-client');

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    const index = await client.indexes.create({
      indexName: name,
      models: [
        {
          modelName: 'marengo3.0',
          modelOptions: ['visual', 'audio'],
        },
      ],
      addons: ['thumbnail'],
    });

    res.status(201).json({
      id: index.id,
      name: index.indexName,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const result = await client.indexes.list();
    const projects = (result.data || []).map((index) => ({
      id: index.id,
      name: index.indexName,
      videoCount: index.videoCount,
      totalDuration: index.totalDuration || 0,
      createdAt: index.createdAt,
      updatedAt: index.updatedAt,
    }));

    res.json(projects);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    await client.indexes.update(id, { indexName: name });
    res.json({ id, name });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    await client.indexes.delete(id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
