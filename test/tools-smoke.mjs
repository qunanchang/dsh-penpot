import { apply } from '../lib/index.js';

const tools = [];
const disposers = [];
const ctx = {
  effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); return () => {}; },
  webServer: { register() { return () => {}; } },
  tools: { register(def) { tools.push(def); return () => {}; } },
};

apply(ctx, { penpotOrigin: 'http://localhost:9001', proxyPort: 9009, accessTokenFile: process.env.USERPROFILE + '\\.penpot-access-token' });
await new Promise((r) => setTimeout(r, 1500));

const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
console.log('tools:', Object.keys(byName).sort().join(','));
const status = await byName.penpot_status.execute({}, {});
console.log('status.ok:', status.ok, 'reachable:', status.reachable, 'proxyReady:', status.proxyReady, 'port:', status.proxyPort);
const files = await byName.penpot_files.execute({ refresh: true }, {});
console.log('files:', files.count);

const created = await byName.penpot_create_file.execute({ name: 'DSH tool probe 20261021' }, {});
console.log('created:', created.id, created.name);
const renamed = await byName.penpot_rename_file.execute({ file_id: created.id, name: 'DSH tool probe ren' }, {});
console.log('renamed:', renamed.name);
const duped = await byName.penpot_duplicate_file.execute({ file_id: created.id, name: 'DSH tool probe dup' }, {});
console.log('duped:', duped.id, duped.name);
const del1 = await byName.penpot_delete_file.execute({ file_id: duped.id }, {});
const del2 = await byName.penpot_delete_file.execute({ file_id: created.id }, {});
console.log('deleted:', del1.deleted, del2.deleted);
const after = await byName.penpot_files.execute({ refresh: true }, {});
console.log('files after:', after.count, 'probes:', after.files.filter((f) => f.name.includes('DSH tool probe')).length);
for (const d of disposers) { try { d(); } catch {} }
process.exit(0);
