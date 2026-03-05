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

// ---- Chaos State ----

const chaos = {
  memoryLeak: false,
  cpuSpike: false,
  slowResponses: false,
  errorRate: 0,        // 0-100, percentage of requests that return 500
  slowDelayMs: 5000,
};

// Memory leak storage
const leakedBuffers = [];
let cpuInterval = null;

// ---- Middleware: metrics + chaos injection ----

app.use((req, res, next) => {
  // Skip metrics endpoint
  if (req.path === '/metrics') return next();

  const start = Date.now();

  // Inject error rate
  if (chaos.errorRate > 0 && Math.random() * 100 < chaos.errorRate) {
    const duration = (Date.now() - start) / 1000;
    httpDuration.observe({ method: req.method, path: req.path }, duration);
    httpRequests.inc({ method: req.method, path: req.path, status: 500 });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Something went wrong processing your request',
    });
  }

  // Inject slow responses
  if (chaos.slowResponses) {
    setTimeout(() => {
      proceed(req, res, next, start);
    }, chaos.slowDelayMs);
  } else {
    proceed(req, res, next, start);
  }
});

function proceed(req, res, next, start) {
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    httpDuration.observe({ method: req.method, path: req.path }, duration);
    httpRequests.inc({ method: req.method, path: req.path, status: res.statusCode });
  });
  next();
}

// ---- App Endpoints ----

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/data', (req, res) => {
  // Simulate some work
  const items = Array.from({ length: 100 }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
    value: Math.random(),
  }));
  res.json({ items, count: items.length });
});

app.get('/api/users', (req, res) => {
  res.json({
    users: [
      { id: 1, name: 'Alice', role: 'admin' },
      { id: 2, name: 'Bob', role: 'user' },
      { id: 3, name: 'Charlie', role: 'user' },
    ],
  });
});

// ---- Chaos Endpoints ----

app.post('/chaos/memory-leak', (req, res) => {
  chaos.memoryLeak = true;
  // Allocate 10MB every 500ms
  const interval = setInterval(() => {
    if (!chaos.memoryLeak) {
      clearInterval(interval);
      return;
    }
    leakedBuffers.push(Buffer.alloc(10 * 1024 * 1024)); // 10MB
  }, 500);
  res.json({ status: 'Memory leak started', interval: '10MB every 500ms' });
});

app.post('/chaos/cpu-spike', (req, res) => {
  chaos.cpuSpike = true;
  // Burn CPU in a tight loop
  cpuInterval = setInterval(() => {
    if (!chaos.cpuSpike) return;
    const end = Date.now() + 200; // 200ms of burn per tick
    while (Date.now() < end) {
      Math.random() * Math.random();
    }
  }, 250);
  res.json({ status: 'CPU spike started' });
});

app.post('/chaos/slow-responses', (req, res) => {
  const delayMs = req.body?.delayMs || 5000;
  chaos.slowResponses = true;
  chaos.slowDelayMs = delayMs;
  res.json({ status: 'Slow responses enabled', delayMs });
});

app.post('/chaos/error-rate', (req, res) => {
  const rate = req.body?.rate || 50;
  chaos.errorRate = Math.min(100, Math.max(0, rate));
  res.json({ status: 'Error rate set', rate: chaos.errorRate });
});

app.post('/chaos/reset', (req, res) => {
  chaos.memoryLeak = false;
  chaos.cpuSpike = false;
  chaos.slowResponses = false;
  chaos.errorRate = 0;
  leakedBuffers.length = 0;
  if (cpuInterval) {
    clearInterval(cpuInterval);
    cpuInterval = null;
  }
  // Force GC if available
  if (global.gc) global.gc();
  res.json({ status: 'All chaos stopped' });
});

app.get('/chaos/status', (req, res) => {
  res.json({
    memoryLeak: chaos.memoryLeak,
    cpuSpike: chaos.cpuSpike,
    slowResponses: chaos.slowResponses,
    errorRate: chaos.errorRate,
    leakedMB: leakedBuffers.length * 10,
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
