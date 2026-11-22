// A static server for dist/ that remembers what the device asked for: the requests
// show which chunks and assets really loaded.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

/**
 * For lynxEventSource: one unnamed event, two named `tick` ones, then the line
 * stays open. Shared by run.mjs's server and `npm run dev` (lynx.config.ts).
 *
 * The last event ends in `✓`, sent in two writes 300 ms apart that cut the
 * character's three bytes after the second, so the device decodes a chunk
 * that ends mid-character.
 */
export function sendServerEvents(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
  });
  res.write('data: hello\n\n');
  res.write('event: tick\nid: 1\ndata: tick 1\n\n');
  const last = Buffer.from('event: tick\nid: 2\ndata: tick 2 ✓\n\n');
  const cut = last.indexOf(Buffer.from('✓')) + 2;
  res.write(last.subarray(0, cut));
  setTimeout(() => res.destroyed || res.write(last.subarray(cut)), 300);
}

/**
 * The network the lazy route's chunk sees, for the network screen: `normal`, `slow`
 * (3 s before the response) or `dropped` (the connection is cut). The screen sets it
 * with `/__network/<mode>`, and opening the main bundle resets it, so a flow that
 * fails halfway doesn't leave the next one on a dropped network.
 */
const NETWORK_MODES = ['normal', 'slow', 'dropped'];
const LAZY_CHUNK = /^\/static\/js\/async\/lazy-route\./;

/**
 * Serves `root` on `port`. `host` is 127.0.0.1 unless a phone on the network has to
 * reach it (iphone.mjs). `main` is the bundle answered for `/main.lynx.bundle`: a host
 * app that always opens that path can load the `assets` bundle from a second server.
 */
export function serve(root, port, { host = '127.0.0.1', main = 'main' } = {}) {
  const requests = [];
  let network = 'normal';
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (pathname === '/sse') {
      requests.push({ pathname, status: 200 });
      sendServerEvents(res);
      return;
    }
    const mode = /^\/__network\/(\w+)$/.exec(pathname)?.[1];
    if (mode) {
      const known = NETWORK_MODES.includes(mode);
      if (known) network = mode;
      requests.push({ pathname, status: known ? 200 : 404 });
      res.writeHead(known ? 200 : 404, { 'Access-Control-Allow-Origin': '*' }).end(network);
      return;
    }
    if (pathname === '/main.lynx.bundle') {
      network = 'normal';
      if (main !== 'main') {
        respond(root, `/${main}.lynx.bundle`, requests, res);
        return;
      }
    }
    if (LAZY_CHUNK.test(pathname) && network === 'dropped') {
      requests.push({ pathname, status: 'dropped' });
      req.socket.destroy();
      return;
    }
    if (LAZY_CHUNK.test(pathname) && network === 'slow') {
      setTimeout(() => respond(root, pathname, requests, res), 3000);
      return;
    }
    respond(root, pathname, requests, res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve({ requests, close: () => server.close() }));
  });
}

function respond(root, pathname, requests, res) {
  const file = path.join(root, pathname);
  const found = file.startsWith(root) && existsSync(file) && statSync(file).isFile();
  requests.push({ pathname, status: found ? 200 : 404 });
  if (!found) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
  createReadStream(file).pipe(res);
}
