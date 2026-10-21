
const base = process.env.DSH_BASE || 'http://127.0.0.1:3080';
async function j(url, init) {
  const res = await fetch(base + url, init);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 300); }
  return { status: res.status, data };
}
function post(url, body) {
  return j(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
}
(async () => {
  const status = await j('/penpot/status');
  console.log('status', status.status, status.data.ok, status.data.reachable, 'proxy', status.data.proxyReady, status.data.proxyPort);
  const files = await j('/penpot/files');
  console.log('files', files.status, files.data.ok, 'count', files.data.count);

  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const name = 'dsh-penpot smoke ' + stamp;
  const created = await post('/penpot/files/create', { name });
  console.log('create', created.status, created.data.ok, created.data.file && created.data.file.id, created.data.file && created.data.file.name, created.data.error || '');
  const id = created.data.file && created.data.file.id;
  if (!id) return;

  const renamed = await post('/penpot/files/rename', { fileId: id, name: name + ' ren' });
  console.log('rename', renamed.status, renamed.data.ok, renamed.data.file && renamed.data.file.name, renamed.data.error || '');

  const dup = await post('/penpot/files/duplicate', { fileId: id, name: name + ' copy' });
  console.log('duplicate', dup.status, dup.data.ok, dup.data.file && dup.data.file.id, dup.data.file && dup.data.file.name, dup.data.error || '');
  const dupId = dup.data.file && dup.data.file.id;

  const del1 = await post('/penpot/files/delete', { fileId: id });
  console.log('delete-original', del1.status, del1.data.ok, del1.data.deleted, del1.data.error || '');
  if (dupId) {
    const del2 = await post('/penpot/files/delete', { fileId: dupId });
    console.log('delete-copy', del2.status, del2.data.ok, del2.data.deleted, del2.data.error || '');
  }
  const after = await j('/penpot/files?refresh=1');
  const left = after.data.files.filter((f) => f.name.indexOf('dsh-penpot smoke') === 0).length;
  console.log('leftover-smoke-files', left, 'total', after.data.count);
  const bad = await post('/penpot/files/rename', { fileId: 'not-a-uuid', name: 'x' });
  console.log('bad-uuid', bad.status, bad.data.ok, (bad.data.error || '').slice(0, 160));
  const notPost = await j('/penpot/files/create');
  console.log('get-create', notPost.status, notPost.data.ok, (notPost.data.error || '').slice(0, 80));
})().catch((err) => { console.error('FAIL', err); process.exit(1); });