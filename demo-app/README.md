# Demo App

A simple Express.js API service with intentionally buggy features behind feature flags. Used as the target for the incident response agent — each bug produces a real alert that the agent must investigate and fix.

## Normal Endpoints

These always work regardless of feature flags:

| Endpoint | What it does |
|---|---|
| `GET /health` | Returns `{status: "ok", uptime: ...}` |
| `GET /api/data` | Returns 100 generated items (simulates a data API) |
| `GET /api/users` | Returns 3 hardcoded users (Alice, Bob, Charlie) |
| `GET /metrics` | Prometheus metrics (scraped automatically) |

## Feature Flag Endpoints

| Endpoint | What it does |
|---|---|
| `POST /features/enable/:feature` | Enable a feature by name |
| `POST /features/disable/:feature` | Disable a feature by name |
| `GET /features` | Show all flags + memory usage |

## Features and Their Bugs

### `userEnrichment` — High Error Rate

**What it does:** Enriches user API responses with profile data (bio, avatar, theme) from an in-memory lookup map.

**The bug:** The `enrichUser()` function accesses `profile.bio`, `profile.avatar`, and `profile.settings.theme` without checking if `profile` exists. When a request comes in for a user ID that isn't in the `userProfiles` map (e.g., `?id=99`), `profile` is `undefined` and the property access throws a `TypeError`.

**Code location:** `server.js` — `enrichUser()` function and `userProfiles` map.

**How to trigger:**
```bash
curl -X POST localhost:8080/features/enable/userEnrichment
# Request a user ID that doesn't exist in the profiles map
curl "localhost:8080/api/users?id=99"
```

**Alert:** `HighErrorRate` (>10% of requests return 5xx for 30s)

**Correct fix:** Add a null check before accessing profile properties — return default values when the profile doesn't exist.

---

### `dbCache` — Redis Connection Leak / DB-Down Errors

**What it does:** Caches `/api/data` responses in Redis. On each request, checks Redis for a cached result before generating new data, and stores the result with a 30-second TTL.

**The bug:** `getCachedData()` and `setCachedData()` each create a **new** `Redis` client on every call and never close it. Under sustained traffic, this exhausts Redis's `maxclients` limit (set to 50 in the Redis deployment). Once connections are exhausted, all subsequent requests fail.

**Code location:** `server.js` — `getCachedData()` and `setCachedData()` functions.

**How to trigger:**
```bash
curl -X POST localhost:8080/features/enable/dbCache
# Send sustained traffic to exhaust Redis connections
for i in $(seq 1 200); do curl -s -o /dev/null localhost:8080/api/data & done; wait
```

**Alert:** `HighErrorRate` (>10% of requests return 5xx for 30s)

**Also triggers `HighErrorRate` in the `db-down` scenario:** If Redis is scaled to 0 replicas, all cache operations fail immediately.

**Correct fix:** Create a single Redis client at startup and reuse it, or close the client after each operation.

---

### `asyncProcessing` — Process Crash

**What it does:** When enabled, the `/api/data` endpoint reads `req.query.payload`, parses it as JSON, and calls `.transform()` on the result inside `setImmediate`.

**The bug:** The code calls `JSON.parse(payload)` on the raw query parameter, which is `undefined` when no `?payload=` is provided. This throws a `SyntaxError`. Even if valid JSON is provided, it calls `parsed.transform()` which doesn't exist on arbitrary objects, throwing a `TypeError`. Because this runs inside `setImmediate`, the exception is unhandled and crashes the Node.js process.

**Code location:** `server.js` — the `asyncProcessing` block inside the `/api/data` handler.

**How to trigger:**
```bash
curl -X POST localhost:8080/features/enable/asyncProcessing
# Any request to /api/data crashes the process
curl localhost:8080/api/data
```

**Alert:** `PodCrashLooping` (pod restarts > 2 in 5 minutes)

**Correct fix:** Add input validation — check that `payload` exists, wrap `JSON.parse` in a try/catch, and verify `.transform` is a function before calling it.

---

## Prometheus Metrics

The app exports two custom metrics at `GET /metrics`:

- **`http_requests_total`** — Counter with labels `method`, `path`, `status`. Used to calculate error rates.
- **`http_request_duration_seconds`** — Histogram with buckets from 10ms to 10s. Used to calculate p95 latency.

Plus Node.js default metrics (heap size, event loop lag, GC stats) via `prom-client.collectDefaultMetrics()`.

## Docker

```bash
docker build -t demo-app .
docker run -p 3000:3000 demo-app
```
