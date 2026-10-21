// Exercise the sidebar MCP dialog without a real React renderer.
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
assert.ok(registration, 'client module registered');
const exports = registration.factory((name) => {
  if (name === 'react') return reactStub;
  throw new Error('unexpected require: ' + name);
});

responses.set('/penpot/status', { ok: true, penpot: { reachable: true, origin: 'http://localhost:9001' }, proxy: { ready: true, port: 9002 } });
responses.set('/penpot/files', { ok: true, files: [{ id: 'file-1', name: '样例文件', teamId: 'team-1' }] });
responses.set('/penpot/open', { ok: true, url: 'http://localhost:9002/#/workspace?file-id=file-1' });
responses.set('/penpot/mcp/status', { ok: true, connected: true, file: '样例文件', page: '主图页', selection: 2, error: '', tokenPresent: true });
responses.set('/penpot/mcp/call', { ok: true, text: '{\n  "page": "主图页",\n  "shapes": 265\n}', log: 'hello log' });

slots = [];
cursor = 0;
const PenpotTab = exports.PenpotTab;
let tree = PenpotTab();
rerender = () => { cursor = 0; tree = PenpotTab(); };

const flush = async (times = 10) => {
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
assert.ok(findAll(tree, (n) => n.type === 'iframe').length, 'editor iframe mounts');
const mcpButtons = clickable('MCP');
assert.equal(mcpButtons.length, 1, 'toolbar offers MCP');
mcpButtons[0].props.onClick();
await flush();

assert.ok(findAll(tree, (n) => textOf(n).trim() === 'Penpot MCP · 在当前文件里跑代码').length, 'MCP dialog opens');
assert.ok(findAll(tree, (n) => textOf(n).includes('已连接  ·  样例文件')).length, 'dialog shows connection line');
const textarea = findAll(tree, (n) => n.type === 'textarea')[0];
assert.ok(textarea, 'code textarea exists');
const code = 'var p = penpot.currentPage; return { page: p && p.name, shapes: 265 };';
textarea.props.onChange({ target: { value: code } });
await flush();
const run = clickable('运行');
assert.equal(run.length, 1, 'run button exists');
run[0].props.onClick();
await flush();
const call = posted.find((item) => item.url === '/penpot/mcp/call');
assert.ok(call, 'posts to /penpot/mcp/call');
assert.equal(call.body.code, code, 'sends the edited code');
const pretag = findAll(tree, (n) => n.type === 'pre');
assert.ok(pretag.length >= 1, 'renders result pre');
assert.ok(pretag.some((n) => textOf(n).includes('shapes')), 'result text rendered');
assert.ok(pretag.some((n) => textOf(n).includes('hello log')), 'log rendered');
console.log('mcp-ui ok: dialog, code edit, POST /penpot/mcp/call, result + log rendering');