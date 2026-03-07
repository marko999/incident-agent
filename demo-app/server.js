const fs = require('fs');
const path = require('path');
const express = require('express');
const promClient = require('prom-client');
const Redis = require('ioredis');

const app = express();
app.use(express.json());

const REDIS_URL = process.env.REDIS_URL || 'redis://redis.demo-app.svc.cluster.local:6379';
const redis = new Redis(REDIS_URL);

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
  requestLogging: false,
  searchEnabled: false,
  userEnrichment: false,
  configDriven: false,
  dbCache: false,
  dbSessions: false,
};

const requestLog = [];

function logRequest(req) {
  if (!features.requestLogging) return;
  requestLog.push({
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    headers: { ...req.headers },
    query: { ...req.query },
    body: req.body,
  });
}

function validateSearchQuery(query) {
  const pattern = /^([a-zA-Z0-9]+\s?)+$/;
  return pattern.test(query);
}

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
    bio: profile?.bio,
    avatar: profile?.avatar,
    theme: profile?.settings?.theme,
  };
}

function getResponseConfig() {
  if (!features.configDriven) return null;
  const configPath = path.join(__dirname, 'response-config.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(raw);
}

async function getCachedData(key) {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);
  return null;
}

async function setCachedData(key, data, ttl) {
  await redis.set(key, JSON.stringify(data), 'EX', ttl);
}

async function getActiveSessions() {
  const keys = await redis.keys('session:*');
  const sessions = [];
  for (const key of keys) {
    const data = await redis.get(key);
    if (data) sessions.push(JSON.parse(data));
  }
  return sessions;
}

async function createSession(userId) {
  const sessionId = `session:${userId}:${Date.now()}`;
  await redis.set(sessionId, JSON.stringify({
    userId,
    createdAt: new Date().toISOString(),
    lastActive: new Date().toISOString(),
  }), 'EX', 3600);
  return sessionId;
}

app.use((req, res, next) => {
  if (req.path === '/metrics') return next();

  const start = Date.now();
  logRequest(req);

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
  try {
    if (features.dbCache) {
      const cached = await getCachedData('api:data');
      if (cached) return res.json(cached);
    }

    const config = getResponseConfig();
    const count = config?.itemCount || 100;

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

app.get('/api/search', (req, res) => {
  if (!features.searchEnabled) {
    return res.status(404).json({ error: 'Search is not enabled' });
  }

  const query = req.query.q || '';

  if (!validateSearchQuery(query)) {
    return res.status(400).json({ error: 'Invalid search query' });
  }

  const results = users.filter(u =>
    u.name.toLowerCase().includes(query.toLowerCase())
  );
  res.json({ query, results, count: results.length });
});

app.get('/api/sessions', async (req, res) => {
  if (!features.dbSessions) {
    return res.status(404).json({ error: 'Sessions feature is not enabled' });
  }

  try {
    const sessions = await getActiveSessions();
    res.json({ sessions, count: sessions.length });
  } catch (err) {
    console.error(`[ERROR] /api/sessions failed: ${err.message}`);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

app.post('/api/sessions', async (req, res) => {
  if (!features.dbSessions) {
    return res.status(404).json({ error: 'Sessions feature is not enabled' });
  }

  try {
    const userId = req.body?.userId || Math.floor(Math.random() * 10000);
    const sessionId = await createSession(userId);
    res.json({ sessionId, userId });
  } catch (err) {
    console.error(`[ERROR] POST /api/sessions failed: ${err.message}`);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
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

  if (feature === 'requestLogging') {
    requestLog.length = 0;
    if (global.gc) global.gc();
  }

  console.log(`[FEATURE] Disabled: ${feature}`);
  res.json({ feature, enabled: false });
});

app.get('/features', (req, res) => {
  res.json({
    features,
    requestLogSize: requestLog.length,
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
