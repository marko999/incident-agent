const fs = require('fs');
const path = require('path');
const express = require('express');
const promClient = require('prom-client');

const app = express();
app.use(express.json());

// ---- Prometheus Metrics ----

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

// ---- Feature Flags ----

const features = {
  requestLogging: false,
  searchEnabled: false,
  userEnrichment: false,
  configDriven: false,
};

// ---- Feature: Request Logging ----

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

// ---- Feature: Search ----

function validateSearchQuery(query) {
  const pattern = /^([a-zA-Z0-9]+\s?)+$/;
  return pattern.test(query);
}

// ---- Feature: User Enrichment ----

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

  if (!profile) {
    return {
      ...user,
      bio: null,
      avatar: null,
      theme: null,
    };
  }

  return {
    ...user,
    bio: profile.bio,
    avatar: profile.avatar,
    theme: profile.settings.theme,
  };
}

// ---- Feature: Config-Driven Responses ----

function getResponseConfig() {
  if (!features.configDriven) return null;
  const configPath = path.join(__dirname, 'response-config.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(raw);
}

// ---- Metrics Middleware ----

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

// ---- App Endpoints ----

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/data', (req, res) => {
  const config = getResponseConfig();
  const count = config?.itemCount || 100;

  const items = Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
    value: Math.random(),
  }));
  res.json({ items, count: items.length });
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

// ---- Feature Flag Endpoints ----

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
