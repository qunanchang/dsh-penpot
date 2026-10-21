import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const token = fs.readFileSync(path.join(os.homedir(), '.penpot-mcp-token'), 'utf8').trim();
const base = 'http://localhost:9001/mcp/stream?userToken=' + encodeURIComponent(token);
let sessionId = '';
let idc = 0;

async function rpc(method, params) {
  const body = { jsonrpc: '2.0', id: ++idc, method, params: params || {} };
  const res = await fetch(base, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  const text = await res.text();
  const line = text.split('\n').find((l) => l.startsWith('data: '));
  return line ? JSON.parse(line.slice(6)) : { raw: text.slice(0, 600) };
}

const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dsh-penpot', version: '0.2.0' } });
console.log('initialize:', init.result?.serverInfo ? JSON.stringify(init.result.serverInfo) : JSON.stringify(init).slice(0, 300));
await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }).catch(() => null);

const tools = await rpc('tools/list', {});
console.log('tools:', (tools.result?.tools || []).map((t) => t.name).join(', '));

const code = process.argv[2] || 'return penpot.currentFile ? penpot.currentFile.name : "no file";';
const call = await rpc('tools/call', { name: 'execute_code', arguments: { code } });
console.log('call:', JSON.stringify(call).slice(0, 1500));
process.exit(0);
