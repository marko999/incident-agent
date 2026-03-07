const http = require('http');

const PORT = 8080;

// AGENT_URL: if set, webhook will POST firing alerts to the agent automatically
// If not set, alerts queue up and the agent polls /alerts/pending
const AGENT_URL = process.env.AGENT_URL || null;

// Active firing alerts keyed by alertname+pod to deduplicate
// AlertManager re-sends the same alert every ~30s until resolved
const activeAlerts = new Map();

// All alerts ever received (for /alerts history endpoint)
const alertHistory = [];

function alertKey(alert) {
  return `${alert.alertname}:${alert.pod || alert.namespace || 'cluster'}`;
}

function notifyAgent(alert) {
  if (!AGENT_URL) return;

  const body = JSON.stringify({ alert });
  const url = new URL(AGENT_URL);
  const options = {
    hostname: url.hostname,
    port: url.port || 80,
    path: url.pathname,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  };

  const req = http.request(options, (res) => {
    console.log(`[AGENT] Notified agent at ${AGENT_URL} → HTTP ${res.statusCode}`);
  });
  req.on('error', (e) => console.error(`[AGENT] Failed to notify agent: ${e.message}`));
  req.write(body);
  req.end();
}

const server = http.createServer((req, res) => {

  // AlertManager POSTs alert groups here
  if (req.method === 'POST' && req.url === '/alert') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const timestamp = new Date().toISOString();

        for (const alert of payload.alerts || []) {
          const entry = {
            timestamp,
            status: alert.status,
            alertname: alert.labels?.alertname,
            severity: alert.labels?.severity,
            namespace: alert.labels?.namespace,
            pod: alert.labels?.pod,
            summary: alert.annotations?.summary,
            description: alert.annotations?.description,
          };

          const key = alertKey(entry);

          if (entry.status === 'firing') {
            const isNew = !activeAlerts.has(key);
            activeAlerts.set(key, entry);
            alertHistory.push(entry);

            console.log(`[ALERT] ${entry.status} | ${entry.alertname} | ${entry.summary}`);
            console.log(`        ${entry.description}`);

            if (isNew) {
              console.log(`[NEW]   Triggering agent for: ${key}`);
              notifyAgent(entry);
            } else {
              console.log(`[DUP]   Already active, skipping agent trigger: ${key}`);
            }
          } else if (entry.status === 'resolved') {
            activeAlerts.delete(key);
            console.log(`[RESOLVED] ${entry.alertname} cleared from active set`);
          }

          console.log('');
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'received' }));
      } catch (e) {
        console.error('Failed to parse alert:', e.message);
        res.writeHead(400);
        res.end('Bad request');
      }
    });

  // Agent polls this to get alerts that need processing (and clears them)
  } else if (req.method === 'GET' && req.url === '/alerts/pending') {
    const pending = Array.from(activeAlerts.values());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ alerts: pending, count: pending.length }));

  // Full alert history (never cleared)
  } else if (req.method === 'GET' && req.url === '/alerts') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ alerts: alertHistory, count: alertHistory.length }));

  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', activeAlerts: activeAlerts.size }));

  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Webhook receiver listening on port ${PORT}`);
  console.log(`Agent auto-trigger: ${AGENT_URL ? AGENT_URL : 'disabled (set AGENT_URL to enable)'}`);
  console.log('Waiting for alerts from AlertManager...');
});
