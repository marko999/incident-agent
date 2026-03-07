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
// These simulate feature toggles. Each enables a "feature" that has a real bug.
// In production you'd use LaunchDarkly, Unleash, etc.

const features = {
  requestLogging: false,   // enables request logging (has memory leak bug)
  searchEnabled: false,    // enables /api/search (has CPU bug)
  userEnrichment: false,   // enables enriched /api/users (has null ref bug)
  configDriven: false,     // enables config-based responses (has sync I/O bug)
};

// ---- Feature: Request Logging ----
// Bug: logs are stored in an unbounded in-memory array. Under sustained traffic
// this grows forever and eventually causes an OOM. There is no eviction, no max
// size, no rotation — every single request is kept in memory indefinitely.

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
  // BUG: requestLog grows without bound — no eviction, no max size
}

// ---- Feature: Search ----
// Bug: the input validation regex has catastrophic backtracking. When a user
// submits a search query like "aaaaaaaaaaaaaaaaaaa!" the regex engine enters
// exponential backtracking and burns CPU for seconds or more.

function validateSearchQuery(query) {
  // This regex is meant to allow alphanumeric strings with optional separators.
  // BUG: nested quantifiers cause catastrophic backtracking on non-matching input
  const pattern = /^([a-zA-Z0-9]+\s?)+$/;
  return pattern.test(query);
}

// ---- Feature: User Enrichment ----
// Bug: the enrichment lookup doesn't handle missing users. When a request comes
// in for a user ID that doesn't exist in the profiles map, it tries to access
// a property on undefined and throws a TypeError.

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
  // BUG: if profile is undefined (user ID not in map), this throws TypeError
  return {
    ...user,
    bio: profile.bio,
    avatar: profile.avatar,
    theme: profile.settings.theme,
  };
}

// ---- Feature: Config-Driven Responses ----
// Bug: reads a config file from disk synchronously on every single request.
// Under concurrent load this blocks the event loop because readFileSync holds
// the thread while waiting for I/O. Every request queues behind the last one.

function getResponseConfig() {
  if (!features.configDriven) return null;
  // BUG: synchronous file read on every request — blocks the event loop
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
    // When enrichment is enabled, enrich all users — including any request
    // for a user ID that doesn't exist in the profiles map
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

  // Simple mock search
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

  // Clean up side effects
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

// ---- Prometheus metrics endpoint ----

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.end(await promClient.register.metrics());
});

// ---- Start ----

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Demo app listening on port ${PORT}`);
});
