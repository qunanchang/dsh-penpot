// Long-running dev runner: boots the host half with a fake ctx so the reverse
// proxy can be inspected in a real browser before the plugin is wired into DSH.
import fs from 'node:fs';
import http from 'node:http';
import { apply } from '../lib/index.js';

const routes = [];
const disposers = [];

const ctx = {
  webServer: {
    register(route) { routes.push(route); return () => {}; },
    port: 3080,
    protocol: 'http',
    getOrigin: () => 'http://127.0.0.1:3080',
  },
  effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); return () => {}; },
};

apply(ctx, {});

const listener = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/embed.html') {
    const body = fs.readFileSync(new URL('./embed.html', import.meta.url), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
    return;
  }
  const route = routes.find((r) => r.kind === 'exact' && r.path === url.pathname);
  if (!route) { res.statusCode = 404; res.end('no route ' + url.pathname); return; }
  route.handler(req, res);
});
listener.listen(19030, '127.0.0.1', () => {
  console.log('dev routes on http://127.0.0.1:19030/penpot/...');
});
setInterval(() => {}, 1 << 30);