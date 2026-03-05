const http = require('http');

// Simple webhook receiver that logs alerts and can trigger the agent
// For hackathon: alerts are logged, agent is triggered manually or via script

const PORT = 8080;
const alerts = [];

const server = http.createServer((req, res) => {
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
          alerts.push(entry);
          console.log(`[ALERT] ${entry.status} | ${entry.alertname} | ${entry.summary}`);
          console.log(`        ${entry.description}`);
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
  } else if (req.method === 'GET' && req.url === '/alerts') {
    // Return all captured alerts
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ alerts, count: alerts.length }));
  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Agent webhook receiver listening on port ${PORT}`);
  console.log('Waiting for alerts from AlertManager...');
});
