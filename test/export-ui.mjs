// Exercise the sidebar export dialog without a real React renderer.
import assert from 'node:assert';

let registration = null;
const responses = new Map();
const posted = [];
globalThis.window = {
  __ModuleLoader__: { load(reg) { registration = reg; } },
  location: { hostname: 'localhost', search: '' },
  localStorage: { getItem: () => 'file-1', setItem: () => {} },
};
globalThis.fetch = async (url, init) => {
  const key = String(url);
  if (init && init.method === 'POST') posted.push({ url: key, body: JSON.parse(init.body) });
  const data = responses.get(key) || responses.get(key.split('?')[0]) || { ok: true };
  return { ok: true, status: 200, json: async () => data };
};

let slots = null;
let cursor = 0;
let dirty = false;
let rendering = false;
let rerender = null;
function schedule() {
  if (dirty) return;
  dirty = true;
  queueMicrotask(() => {
    dirty = false;
    if (rerender) rerender();
  });
}
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState(initial) {
    const index = cursor;
    cursor += 1;
    if (!slots) throw new Error('render first');
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    const set = (value) => {
      slots[index] = typeof value === 'function' ? value(slots[index]) : value;
      schedule();
    };
    return [slots[index], set];
  },
  useEffect(fn, deps) {
    const index = cursor;
    cursor += 1;
    const prev = slots ? slots['effect' + index] : undefined;
    const changed = !prev || !deps || deps.some((value, i) => value !== prev[i]);
    if (changed) {
      slots['effect' + index] = deps || [];
      const cleanup = fn();
      if (typeof cleanup === 'function') queueMicrotask(cleanup);
    }
  },
};

await import('../lib/client.js');
assert.ok(registration);
const exports = registration.factory((name) => {
  if (name === 'react') return reactStub;
  throw new Error('unexpected require: ' + name);
});

responses.set('/penpot/status', { ok: true, penpot: { reachable: true, origin: 'http://localhost:9001' }, proxy: { ready: true, port: 9002 } });
responses.set('/penpot/files', { ok: true, files: [{ id: 'file-1', name: '样例文件', teamId: 'team-1' }] });
responses.set('/penpot/open', { ok: true, url: 'http://localhost:9002/#/workspace?file-id=file-1' });
responses.set('/penpot/file-info', { ok: true, fileId: 'file-1', name: '样例文件', pages: [{ id: 'page-1', name: '主图页', frameCount: 5, frames: [] }, { id: 'page-2', name: '详情页', frameCount: 3, frames: [] }] });
responses.set('/penpot/files/export', { ok: true, count: 2, exportDir: 'C:/tmp/exports', files: [{ filename: '方图01.png', bytes: 2048, url: '/penpot/exports/a.png' }, { filename: '竖图01.png', bytes: 4096, url: '/penpot/exports/b.png' }] });

slots = [];
cursor = 0;
const PenpotTab = exports.PenpotTab;
let tree = PenpotTab();
rerender = () => { cursor = 0; tree = PenpotTab(); };

const flush = async (times = 8) => {
  for (let i = 0; i < times; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const findAll = (node, predicate, out = []) => {
  if (node === null || node === undefined || node === false) return out;
  if (Array.isArray(node)) {
    for (const item of node) findAll(item, predicate, out);
    return out;
  }
  if (typeof node !== 'object') return out;
  if (predicate(node)) out.push(node);
  const kids = Array.isArray(node.children) ? node.children : [];
  for (const child of kids) findAll(child, predicate, out);
  return out;
};
const textOf = (node) => {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.children);
};
const clickable = (label) => findAll(tree, (node) => node.type === 'button' && textOf(node).trim() === label);

await flush();
assert.ok(findAll(tree, (n) => n.type === 'iframe').length, 'iframe should mount once proxy is ready');
const exportButtons = clickable('导出');
assert.equal(exportButtons.length, 1, 'toolbar should offer 导出');
exportButtons[0].props.onClick();
await flush();
const dialogTitle = findAll(tree, (n) => textOf(n).trim() === '导出画板 PNG');
assert.ok(dialogTitle.length, 'export dialog should open');
const dialogNode = findAll(tree, (n) => n.props && n.props.role === 'dialog')[0];
assert.ok(dialogNode, 'dialog container');
const selects = findAll(dialogNode, (n) => n.type === 'select');
assert.equal(selects.length, 3, 'page / scale / format selects');
const pageOptions = findAll(selects[0], (n) => n.type === 'option');
assert.equal(pageOptions.length, 2);
assert.deepEqual(pageOptions.map((o) => o.props.value), ['page-1', 'page-2']);
assert.equal(selects[1].props.value, '2');
assert.equal(selects[2].props.value, 'png');

const start = clickable('开始导出');
assert.equal(start.length, 1, 'start button present');
start[0].props.onClick();
await flush();
assert.equal(posted.length, 1, 'one POST issued');
assert.equal(posted[0].url, '/penpot/files/export');
assert.deepEqual(posted[0].body, { fileId: 'file-1', pageId: 'page-1', scale: 2, format: 'png' });
const dialogAfter = findAll(tree, (n) => n.props && n.props.role === 'dialog')[0];
const links = findAll(dialogAfter, (n) => n.type === 'a' && String(n.props.href || '').includes('/penpot/exports/'));
assert.equal(links.length, 2, 'result links rendered');
const summary = findAll(dialogAfter, (n) => textOf(n).includes('已导出 2 张'));
assert.ok(summary.length, 'summary line rendered');
assert.equal(clickable('再次导出').length, 1);

console.log(JSON.stringify({ ok: true, posted: posted[0].body, links: links.map((l) => textOf(l)), dialogTitle: textOf(dialogTitle[0]).trim() }));