// Standalone harness: boots the dsh-penpot host half with a fake cordis ctx,
// mounts the registered routes on a throwaway HTTP server, and exercises the
// Penpot reverse proxy against the local self-hosted instance.
import http from 'node:http';
import { apply } from '../lib/index.js';

const routes = [];
const disposers = [];
const logs = [];

const ctx = {
  webServer: {
    register(route) {
      routes.push(route);
      return () => {};
    },
    port: 3080,
    protocol: 'http',
    getOrigin: () => 'http://127.0.0.1:3080',
  },
  effect(fn) {
    const dispose = fn();
    if (typeof dispose === 'function') disposers.push(dispose);
    return () => {};
  },
  tools: {
    register() {
      return () => {};
    },
  },
  logger: {
    info: (...a) => logs.push(['info', ...a].join(' ')),
    warn: (...a) => logs.push(['warn', ...a].join(' ')),
    error: (...a) => logs.push(['error', ...a].join(' ')),
  },
};

function get(url, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET', headers: headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('timeout ' + url)));
    req.end();
  });
}

apply(ctx, {});
await new Promise((r) => setTimeout(r, 1500));

const listener = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const route = routes.find((r) => r.kind === 'exact' && r.path === url.pathname);
  if (!route) {
    res.statusCode = 404;
    res.end('no route ' + url.pathname);
    return;
  }
  route.handler(req, res);
});
await new Promise((r) => listener.listen(19030, '127.0.0.1', r));

const report = {};

const status = await get('http://127.0.0.1:19030/penpot/status');
report.statusHttp = status.status;
try { report.status = JSON.parse(status.body); } catch { report.statusRaw = status.body.slice(0, 300); }
const proxyPort = (report.status && report.status.proxy && report.status.proxy.port) || 9002;
report.proxyPort = proxyPort;

const files = await get('http://127.0.0.1:19030/penpot/files');
report.filesHttp = files.status;
try {
  const parsed = JSON.parse(files.body);
  report.filesOk = parsed.ok;
  report.fileCount = Array.isArray(parsed.files) ? parsed.files.length : -1;
  report.firstFile = (parsed.files || [])[0] || null;
} catch (e) { report.filesRaw = files.body.slice(0, 300); }

const ff = report.firstFile;
if (ff) {
  const open = await get('http://127.0.0.1:19030/penpot/open?fileId=' + encodeURIComponent(ff.id) + '&teamId=' + encodeURIComponent(ff.teamId || ''));
  report.openHttp = open.status;
  try { report.open = JSON.parse(open.body); } catch { report.openRaw = open.body.slice(0, 300); }
}

const rootPage = await get('http://127.0.0.1:' + proxyPort + '/');
report.proxyRootHttp = rootPage.status;
report.proxyRootType = rootPage.headers['content-type'] || null;
report.proxyRootHasXfo = 'x-frame-options' in rootPage.headers;
report.proxyRootHasCsp = 'content-security-policy' in rootPage.headers;
report.proxyRootBodyHead = rootPage.body.slice(0, 160).replace(/\s+/g, ' ');

const profile = await get('http://127.0.0.1:' + proxyPort + '/api/rpc/command/get-profile');
report.profileHttp = profile.status;
report.profileName = (() => {
  try { const j = JSON.parse(profile.body); return j.name || j.email || j.id || null; } catch { return null; }
})();
report.profileBodyHead = profile.body.slice(0, 160);

listener.close();
for (const d of disposers) { try { d(); } catch {} }
console.log(JSON.stringify(report, null, 2));
console.log('LOGS:' + JSON.stringify(logs.slice(0, 12)));
process.exit(0);
