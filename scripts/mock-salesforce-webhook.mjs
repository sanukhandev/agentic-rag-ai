import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

export function startMockSalesforceProvider() {
  const records = new Map();
  const counts = { create: 0, readback: 0 };
  const server = createServer((request, response) => {
    const parts = (request.url ?? '').split('/').filter(Boolean);
    if (request.method === 'POST' && parts.length === 1 && parts[0] === 'lead') {
      counts.create += 1;
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        const id = `00Qsynthetic${createHash('sha256').update(body).digest('hex').slice(0, 12)}`;
        records.set(id, { id, synthetic: true });
        response.writeHead(201, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ leadId: id }));
      });
      return;
    }
    if (request.method === 'GET' && parts.length === 2 && parts[0] === 'lead' && records.has(parts[1])) {
      counts.readback += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(records.get(parts[1])));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    counts,
  })));
}
