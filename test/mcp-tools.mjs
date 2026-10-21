import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const token = fs.readFileSync(path.join(os.homedir(), '.penpot-mcp-token'), 'utf8').trim();
const base = 'http://localhost:9001/mcp/stream?userToken=' + encodeURIComponent(token);
let sessionId = ''; let idc = 0;
async function rpc(method, params) {
  const res = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(sessionId ? { 'mcp-session-id': sessionId } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: ++idc, method, params: params || {} }) });
  const sid = res.headers.get('mcp-session-id'); if (sid) sessionId = sid;
  const text = await res.text();
  const line = text.split('\n').find((l) => l.startsWith('data: '));
  return line ? JSON.parse(line.slice(6)) : { raw: text.slice(0, 400) };
}
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
const t = await rpc('tools/list', {});
console.log(JSON.stringify(t.result.tools, null, 1).slice(0, 4000));
process.exit(0);
