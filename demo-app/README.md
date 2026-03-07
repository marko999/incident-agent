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

### `requestLogging` — Memory Leak

**What it does:** Logs every incoming request (method, path, headers, query, body) to an in-memory array for debugging purposes.

**The bug:** The `requestLog[]` array grows without bound. There is no max size, no eviction, no rotation. Under sustained traffic, memory grows until the container is OOM killed.

**Code location:** `server.js` — `logRequest()` function and the `requestLog` array.

**How to trigger:**
```bash
curl -X POST localhost:8080/features/enable/requestLogging
# Send sustained traffic
for i in $(seq 1 500); do curl -s -o /dev/null localhost:8080/api/data; done
```

**Alert:** `HighMemoryUsage` (memory > 200MB for 30s)

**Correct fix:** Add a max size to the array (e.g., keep only last 1000 entries), or use a ring buffer, or write to disk/external store instead of memory.

---

### `searchEnabled` — CPU Spike

**What it does:** Enables `GET /api/search?q=...` which validates the search query with a regex before searching.

**The bug:** The validation regex `^([a-zA-Z0-9]+\s?)+$` has catastrophic backtracking. The nested quantifiers `(x+)+` cause the regex engine to explore exponentially many paths on non-matching input like `"aaaaaaaaaaaaaaaaaaa!"`. A single request can burn CPU for seconds.

**Code location:** `server.js` — `validateSearchQuery()` function.

**How to trigger:**
```bash
curl -X POST localhost:8080/features/enable/searchEnabled
# Send pathological input (many a's followed by !)
curl "localhost:8080/api/search?q=aaaaaaaaaaaaaaaaaaaaaaaaaaaa!"
```

**Alert:** `HighCPUUsage` (CPU > 50% for 30s)

**Correct fix:** Replace the regex with one that doesn't have nested quantifiers, e.g., `^[a-zA-Z0-9\s]+$`, or use a non-regex approach.

---

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

### `configDriven` — Slow Responses

**What it does:** Reads response configuration (item count, page size, sort order) from a JSON file on disk instead of using hardcoded defaults.

**The bug:** Uses `fs.readFileSync()` to read the config file on every single request. Node.js is single-threaded — `readFileSync` blocks the entire event loop while waiting for the file I/O. Under concurrent load, every request queues behind every other request's file read.

**Code location:** `server.js` — `getResponseConfig()` function.

**How to trigger:**
```bash
curl -X POST localhost:8080/features/enable/configDriven
# Send concurrent requests
for i in $(seq 1 50); do curl -s -o /dev/null localhost:8080/api/data & done; wait
```

**Alert:** `HighLatency` (p95 > 2s for 30s)

**Correct fix:** Cache the config in memory and reload on change (or at intervals), or use `fs.readFile()` (async) instead of `readFileSync`.

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

The `--expose-gc` flag in the CMD allows `global.gc()` to be called when disabling the requestLogging feature, forcing garbage collection to free leaked memory.
