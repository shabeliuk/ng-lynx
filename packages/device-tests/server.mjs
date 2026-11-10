// A static server for dist/ that remembers what the device asked for: the requests
// show which chunks and assets really loaded.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

/**
 * For lynxEventSource: one unnamed event, two named `tick` ones, then the line
 * stays open. Shared by run.mjs's server and `npm run dev` (lynx.config.ts).
 */
export function sendServerEvents(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
  });
  res.write('data: hello\n\n');
  res.write('event: tick\nid: 1\ndata: tick 1\n\n');
  res.write('event: tick\nid: 2\ndata: tick 2\n\n');
}

export function serve(root, port) {
  const requests = [];
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (pathname === '/sse') {
      requests.push({ pathname, status: 200 });
      sendServerEvents(res);
      return;
    }
    const file = path.join(root, pathname);
    const found = file.startsWith(root) && existsSync(file) && statSync(file).isFile();
    requests.push({ pathname, status: found ? 200 : 404 });
    if (!found) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ requests, close: () => server.close() }));
  });
}
