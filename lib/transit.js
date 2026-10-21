// Minimal Transit JSON reader/writer for Penpot RPC (no dependencies).
const MIN_CACHEABLE = 3;
const MAX_CACHE_ENTRIES = 44 * 44;
const ESC = '~';
const SUB = '^';

function codeToIdx(s) {
  if (s.length === 2) return s.charCodeAt(1) - 48;
  if (s.length === 3) return (s.charCodeAt(1) - 48) * 44 + (s.charCodeAt(2) - 48);
  return -1;
}
function isCacheable(v) {
  return v.length > MIN_CACHEABLE && v[0] === ESC && (v[1] === ':' || v[1] === '$' || v[1] === '#');
}

export function decode(root) {
  const cache = [];
  let idx = 0;
  function cacheWrite(v) { if (idx === MAX_CACHE_ENTRIES) idx = 0; cache[idx] = v; idx++; return v; }
  function read(v) {
    if (typeof v === 'string') {
      if (v[0] === SUB && v[1] !== ' ') { const i = codeToIdx(v); return i >= 0 && cache[i] !== undefined ? cache[i] : v; }
      let out;
      if (v.startsWith('~#')) out = { __tag: v.slice(2) };
      else if (v.startsWith('~:')) out = v.slice(2);
      else if (v.startsWith('~u')) out = v.slice(2);
      else if (v.startsWith('~i')) out = Number(v.slice(2));
      else if (v.startsWith('~m')) out = Number(v.slice(2));
      else if (v.startsWith('~$')) out = v.slice(2);
      else if (v.startsWith(ESC)) out = v.slice(1);
      else out = v;
      if (isCacheable(v)) cacheWrite(out);
      return out;
    }
    if (Array.isArray(v)) {
      if (v[0] === '^ ') {
        const o = {};
        for (let i = 1; i < v.length; i += 2) {
          const rawKey = v[i];
          const key = read(rawKey);
          // Writer marshals every map key with cacheable=true, so keys must be
          // registered here too (uuid strings, short keys), mirroring write order.
          // Writer caches a map key only when its ENCODED form is longer than
          // MIN_CACHEABLE (3); short keys such as "~:y" are emitted literally.
          if (typeof rawKey === 'string' && rawKey[0] !== SUB && rawKey.length > MIN_CACHEABLE && !isCacheable(rawKey)) cacheWrite(key);
          o[String(key)] = read(v[i + 1]);
        }
        return o;
      }
      if (typeof v[0] === 'string') {
        // The leading element may be a tag ("~#shape") or a cache code that
        // resolves to one; decode it through read() either way.
        const first = read(v[0]);
        const tagName = first && first.__tag;
        if (tagName) {
          if (tagName === 'set' || tagName === 'list') return (v[1] || []).map(read);
          if (tagName === 'cmap') { const o = {}; const b = v[1] || []; for (let i = 0; i < b.length; i += 2) o[String(read(b[i]))] = read(b[i + 1]); return o; }
          const payload = read(v[1]);
          if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.__tag === undefined) payload.__tag = tagName;
          return payload;
        }
        const out = [first];
        for (let i = 1; i < v.length; i++) out.push(read(v[i]));
        return out;
      }
      return v.map(read);
    }
    if (v && typeof v === 'object') {
      // Verbose transit encodes maps as plain JSON objects whose keys stay
      // escaped ("~:mtype") and tagged values as {"~#tag": payload}.
      const entries = Object.entries(v);
      if (entries.length === 1 && entries[0][0].startsWith('~#')) {
        const tagName = entries[0][0].slice(2);
        const payload = read(entries[0][1]);
        if (tagName === 'set' || tagName === 'list') return Array.isArray(payload) ? payload : [payload];
        if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.__tag === undefined) payload.__tag = tagName;
        return payload;
      }
      const o = {};
      for (const [k, val] of entries) o[String(read(k))] = read(val);
      return o;
    }
    return v;
  }
  return read(root);
}

export function keyword(name) { return { __kw: true, v: name }; }
export function uuid(s) { return { __uuid: true, v: s }; }

function escapeString(s) {
  if (s.length && (s[0] === ESC || s[0] === SUB || s[0] === '`')) return ESC + s;
  return s;
}
export function encode(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return escapeString(v);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map(encode);
  if (v.__kw) return '~:' + v.v;
  if (v.__uuid) return '~u' + v.v;
  const out = ['^ '];
  for (const [k, val] of Object.entries(v)) out.push('~:' + k, encode(val));
  return out;
}

export function isTransit(text) {
  const t = String(text || '').trim();
  if (t.slice(0, 4) === '["^ ') return true;
  return t.startsWith('{') && t.includes('"~:');
}

export function decodeMaybe(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const parsed = JSON.parse(t);
  return isTransit(t) ? decode(parsed) : parsed;
}