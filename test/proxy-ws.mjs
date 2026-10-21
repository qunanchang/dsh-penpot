import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { internals } from '../lib/index.js';

const token = fs.readFileSync(path.join(os.homedir(), '.penpot-mcp-token'), 'utf8').trim();
const proxy = internals.startProxy({ penpotOrigin: 'http://localhost:9001', proxyHost: '127.0.0.1', proxyPort: 9100 }, () => {});
const port = await proxy.start();
console.log('proxy port', port);

const probe = (url) => new Promise((resolve) => {
  const ws = new WebSocket(url);
  const t = setTimeout(() => { try { ws.close(); } catch {} resolve({ url, result: 'timeout' }); }, 6000);
  ws.onopen = () => { clearTimeout(t); resolve({ url, result: 'open' }); setTimeout(() => { try { ws.close(); } catch {} }, 200); };
  ws.onerror = (e) => { clearTimeout(t); resolve({ url, result: 'error', err: String(e?.message || e).slice(0, 120) }); };
});

console.log(JSON.stringify(await probe('ws://127.0.0.1:' + port + '/mcp/ws?userToken=' + encodeURIComponent(token))));
console.log(JSON.stringify(await probe('ws://127.0.0.1:' + port + '/ws/notifications')));
await proxy.dispose();
process.exit(0);
