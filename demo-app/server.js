const express = require('express');
const promClient = require('prom-client');
const Redis = require('ioredis');

const app = express();
app.use(express.json());

const REDIS_URL = process.env.REDIS_URL || 'redis://redis.demo-app.svc.cluster.local:6379';

const httpRequests = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'],
});

const httpDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
});

promClient.collectDefaultMetrics();

const features = {
  userEnrichment: false,
  dbCache: false,
  asyncProcessing: false,
};

const userProfiles = {
  1: { bio: 'Loves hiking', avatar: '/img/alice.png', settings: { theme: 'dark' } },
  2: { bio: 'Backend developer', avatar: '/img/bob.png', settings: { theme: 'light' } },
  3: { bio: 'DevOps engineer', avatar: '/img/charlie.png', settings: { theme: 'auto' } },
};

const users = [
  { id: 1, name: 'Alice', role: 'admin' },
  { id: 2, name: 'Bob', role: 'user' },
  { id: 3, name: 'Charlie', role: 'user' },
];

function enrichUser(user) {
  const profile = userProfiles[user.id];
  return {
    ...user,
    bio: profile.bio,
    avatar: profile.avatar,
    theme: profile.settings.theme,
  };
}

async function getCachedData(key) {
  const client = new Redis(REDIS_URL);
  const cached = await client.get(key);
  if (cached) return JSON.parse(cached);
  return null;
}

async function setCachedData(key, data, ttl) {
  const client = new Redis(REDIS_URL);
  await client.set(key, JSON.stringify(data), 'EX', ttl);
}

app.use((req, res, next) => {
  if (req.path === '/metrics') return next();

  const start = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    httpDuration.observe({ method: req.method, path: req.path }, duration);
    httpRequests.inc({ method: req.method, path: req.path, status: res.statusCode });
  });
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/data', async (req, res) => {
  if (features.asyncProcessing) {
    const payload = req.query.payload;
    if (payload) {
      try {
        const parsed = JSON.parse(payload);
        setImmediate(() => parsed.transform && parsed.transform());
      } catch (e) {
        console.error('[WARN] Invalid async payload');
      }
    }
  }

  try {
    if (features.dbCache) {
      const cached = await getCachedData('api:data');
      if (cached) return res.json(cached);
    }

    const count = 100;

    const items = Array.from({ length: count }, (_, i) => ({
      id: i,
      name: `Item ${i}`,
      value: Math.random(),
    }));
    const result = { items, count: items.length };

    if (features.dbCache) {
      await setCachedData('api:data', result, 30);
    }

    res.json(result);
  } catch (err) {
    console.error(`[ERROR] /api/data failed: ${err.message}`);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

app.get('/api/users', (req, res) => {
  if (features.userEnrichment) {
    const requestedId = req.query.id ? parseInt(req.query.id) : null;

    if (requestedId !== null) {
      const user = users.find(u => u.id === requestedId) || { id: requestedId, name: 'Unknown', role: 'guest' };
      const enriched = enrichUser(user);
      return res.json({ user: enriched });
    }

    const enrichedUsers = users.map(u => enrichUser(u));
    return res.json({ users: enrichedUsers });
  }

  res.json({ users });
});

app.post('/features/enable/:feature', (req, res) => {
  const feature = req.params.feature;
  if (!(feature in features)) {
    return res.status(400).json({ error: `Unknown feature: ${feature}` });
  }
  features[feature] = true;
  console.log(`[FEATURE] Enabled: ${feature}`);
  res.json({ feature, enabled: true });
});

app.post('/features/disable/:feature', (req, res) => {
  const feature = req.params.feature;
  if (!(feature in features)) {
    return res.status(400).json({ error: `Unknown feature: ${feature}` });
  }
  features[feature] = false;
  console.log(`[FEATURE] Disabled: ${feature}`);
  res.json({ feature, enabled: false });
});

app.get('/features', (req, res) => {
  res.json({
    features,
    memoryUsage: process.memoryUsage(),
  });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.end(await promClient.register.metrics());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Demo app listening on port ${PORT}`);
});
