
import fs from 'node:fs';
import path from 'node:path';
import { encode, decodeMaybe } from '../lib/transit.js';
const home = process.env.USERPROFILE;
const token = fs.readFileSync(path.join(home, '.penpot-access-token'), 'utf8').trim();
const base = 'http://localhost:9001';
async function rpc(cmd, body) {
  const res = await fetch(base + '/api/rpc/command/' + cmd, {
    method: 'POST',
    headers: { 'Content-Type': 'application/transit+json', Authorization: 'Token ' + token },
    body: JSON.stringify(encode(body)),
  });
  const text = await res.text();
  let parsed; try { parsed = decodeMaybe(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}
const prof = await rpc('get-profile', {});
console.log('profile status', prof.status);
console.log('props:', JSON.stringify(prof.body.props));
