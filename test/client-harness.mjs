// Smoke test for the browser half: load the bundle through a fake ModuleLoader,
// run apply() against a fake context, and confirm the sidebar tab registration.
import assert from 'node:assert';

let registration = null;
globalThis.window = {
  __ModuleLoader__: { load(reg) { registration = reg; } },
  location: { hostname: 'localhost' },
  localStorage: { getItem: () => '', setItem: () => {} },
};

const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: () => { throw new Error('hooks cannot run outside a renderer'); },
  useEffect: () => {},
};

await import('../lib/client.js');
assert.ok(registration, 'bundle must register through window.__ModuleLoader__.load');
assert.equal(registration.id, 'dsh-penpot');

const exports = registration.factory((name) => {
  if (name === 'react') return reactStub;
  throw new Error('unexpected require: ' + name);
});

assert.deepEqual(exports.inject, ['betterSidebar']);
let registered = null;
let effectRan = false;
exports.apply({
  betterSidebar: {
    registerTab(descriptor) {
      registered = descriptor;
      return () => {};
    },
  },
  effect(fn) {
    effectRan = true;
    return fn();
  },
});

assert.ok(effectRan, 'registerTab must be wrapped in ctx.effect');
assert.equal(registered.id, 'dsh-penpot:design');
assert.equal(registered.title(), 'Penpot');
assert.equal(typeof registered.component, 'function');
assert.equal(typeof registered.dedupeKey(), 'string');

console.log(JSON.stringify({
  bundle: registration.id,
  inject: exports.inject,
  tabId: registered.id,
  title: registered.title(),
  order: registered.order,
  componentIsFunction: true,
  dedupeKey: registered.dedupeKey(),
}));
