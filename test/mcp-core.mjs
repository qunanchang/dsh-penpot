import { internals } from '../lib/index.js';

const cfg = { penpotOrigin: 'http://localhost:9001', mcpTokenFile: process.env.USERPROFILE + '\\.penpot-mcp-token', mcpTimeoutMs: 60000 };

const status = await internals.coreMcpStatus(cfg);
console.log('status:', JSON.stringify(status));

const run = await internals.coreRunCode(cfg, 'var p = penpot.currentPage; var f = penpot.currentFile; return { file: f && f.name, page: p && p.name, boards: (p && p.findShapes().length) || 0 };');
console.log('run:', run.text.slice(0, 400));

const info = await internals.coreApiInfo(cfg, 'Board');
console.log('api:', info.text.slice(0, 200).replace(/\n/g, ' | '));
process.exit(0);
