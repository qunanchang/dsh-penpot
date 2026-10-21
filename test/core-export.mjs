// Direct host-side check of coreFileInfo / coreExport against a live Penpot.
// Needs an access token (~/.penpot-access-token or PENPOT_ACCESS_TOKEN) and PENPOT_FILE_ID.
import os from 'node:os';
import path from 'node:path';
import { internals } from '../lib/index.js';

const cfg = {
  penpotOrigin: process.env.PENPOT_ORIGIN || 'http://localhost:9001',
  rpcTimeoutMs: 20000,
  exportDir: path.join(os.homedir(), '.dsh', 'penpot-exports'),
  exportTimeoutMs: 120000,
  accessTokenFile: '',
  authCookieFile: path.join(os.homedir(), '.penpot-auth.json'),
};
const fileId = process.env.PENPOT_FILE_ID;
if (!fileId) {
  console.error('set PENPOT_FILE_ID (and optionally PENPOT_ORIGIN) first');
  process.exit(2);
}
const info = await internals.coreFileInfo(cfg, { fileId });
console.log('file', info.name);
for (const p of info.pages) console.log(' page', p.name, p.id, 'frames', p.frameCount);
const page = info.pages[0];
const pick = page.frames.slice(0, 2).map((f) => f.id);
const exp = await internals.coreExport(cfg, { fileId, pageId: page.id, objectIds: pick, scale: 1, format: 'png' });
console.log('exported', exp.count, 'to', exp.exportDir);
for (const f of exp.files) console.log(' -', f.filename, f.bytes, f.mtype, f.url);
process.exit(0);
