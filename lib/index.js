// dsh-penpot host half.
//
// Two jobs:
//   1. register /penpot/* JSON routes on the DSH web server (same origin as the GUI)
//   2. run a small reverse proxy (default:0.0.0.0:9002) in front of the self-hosted Penpot,
//      stripping the headers that would block an iframe and injecting the saved login cookie
//      so the sidebar tab is already signed in.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decode, decodeMaybe, encode, keyword, uuid } from './transit.js';

const BASE = '/penpot';
const PORT_CANDIDATES = [9002, 9003, 9004, 9005, 9006];

export const inject = ['webServer', 'tools'];
export const name = 'dsh-penpot';

const DROPPED_RESPONSE_HEADERS = [
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-embedder-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'strict-transport-security',
  'permissions-policy',
  'report-to',
  'nel',
];

const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

function normalizeConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const origin = String(cfg.penpotOrigin || process.env.PENPOT_URL || 'http://localhost:9001').replace(/\/+$/, '');
  return {
    penpotOrigin: origin,
    proxyHost: String(cfg.proxyHost || '0.0.0.0'),
    proxyPort: Number(cfg.proxyPort || 9002),
    rpcTimeoutMs: Number(cfg.rpcTimeoutMs || 20000),
    cacheMs: Number(cfg.cacheMs || 20000),
    accessTokenFile: cfg.accessTokenFile ? String(cfg.accessTokenFile) : '',
    authCookieFile: cfg.authCookieFile ? String(cfg.authCookieFile) : path.join(os.homedir(), '.penpot-auth.json'),
    exportDir: cfg.exportDir ? String(cfg.exportDir) : path.join(os.homedir(), '.dsh', 'penpot-exports'),
    exportTimeoutMs: Number(cfg.exportTimeoutMs || 120000),
    mcpTokenFile: cfg.mcpTokenFile ? String(cfg.mcpTokenFile) : path.join(os.homedir(), '.penpot-mcp-token'),
    mcpToken: cfg.mcpToken ? String(cfg.mcpToken) : '',
    mcpTimeoutMs: Number(cfg.mcpTimeoutMs || 60000),
  };
}

function readAccessToken(cfg) {
  const fromEnv = String(process.env.PENPOT_ACCESS_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  const candidates = [cfg.accessTokenFile, path.join(os.homedir(), '.penpot-access-token')].filter(Boolean);
  for (const file of candidates) {
    try {
      const value = fs.readFileSync(file, 'utf8').trim();
      if (value) return value;
    } catch {
      /* absent: fall through */
    }
  }
  return '';
}

// ~/.penpot-auth.json is written by the local tooling as { value, exp }.
// value is either the bare JWE or a ready-made 'auth-token=...' cookie fragment.
function readAuthCookie(cfg) {
  for (const file of [cfg.authCookieFile, path.join(os.homedir(), '.penpot-auth.json')].filter(Boolean)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      let value = String(raw && (raw.value || raw.token || raw.cookie) || '').trim();
      if (!value) continue;
      value = value.split(';')[0].trim();
      if (value.startsWith('auth-token=')) value = value.slice('auth-token='.length);
      if (value) return value;
    } catch {
      /* absent or malformed: ignore */
    }
  }
  return '';
}

async function rpc(cfg, command, args) {
  const token = readAccessToken(cfg);
  if (!token) {
    const err = new Error('Penpot access token not found');
    err.code = 'NO_TOKEN';
    throw err;
  }
  const method = /^(get|fetch|list|retrieve)-/.test(command) ? 'GET' : 'POST';
  let url = cfg.penpotOrigin + '/api/rpc/command/' + command;
  const headers = { accept: 'application/json', authorization: 'Token ' + token };
  let body;
  if (method === 'GET') {
    if (args) url += '?' + new URLSearchParams(args).toString();
  } else {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(args || {});
  }
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(cfg.rpcTimeoutMs) });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

const listCache = { at: 0, data: null };

async function discoverFiles(cfg, force) {
  if (!force && listCache.data && Date.now() - listCache.at < cfg.cacheMs) return listCache.data;
  const teamsRes = await rpc(cfg, 'get-teams');
  if (teamsRes.status !== 200) throw new Error('get-teams failed with HTTP ' + teamsRes.status);
  const teams = Array.isArray(teamsRes.json) ? teamsRes.json : teamsRes.json ? [teamsRes.json] : [];
  const files = [];
  for (const team of teams) {
    let projects = [];
    try {
      const res = await rpc(cfg, 'get-projects', { 'team-id': team.id });
      projects = Array.isArray(res.json) ? res.json : [];
    } catch {
      projects = [];
    }
    for (const project of projects) {
      let projectFiles = [];
      try {
        const res = await rpc(cfg, 'get-project-files', { 'project-id': project.id });
        projectFiles = Array.isArray(res.json) ? res.json : [];
      } catch {
        projectFiles = [];
      }
      for (const file of projectFiles) {
        files.push({
          id: file.id,
          name: file.name,
          teamId: team.id,
          teamName: team.name,
          projectId: project.id,
          projectName: project.name,
          modifiedAt: file.modifiedAt || null,
          revn: typeof file.revn === 'number' ? file.revn : null,
        });
      }
    }
  }
  files.sort((a, b) => String(b.modifiedAt || '').localeCompare(String(a.modifiedAt || '')));
  const data = { teams: teams.map((t) => ({ id: t.id, name: t.name })), files };
  listCache.at = Date.now();
  listCache.data = data;
  return data;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload === undefined ? null : payload);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

function rewriteSetCookie(cookie) {
  let out = String(cookie).replace(/;\s*secure/gi, '').replace(/;\s*domain=[^;]*/gi, '');
  if (!/;\s*path=/i.test(out)) out += '; Path=/';
  return out;
}

function proxyOriginFor(req, port) {
  const host = String(req.headers.host || '').split(':')[0] || 'localhost';
  return 'http://' + host + ':' + port;
}

function startProxy(cfg, log) {
  const target = new URL(cfg.penpotOrigin);
  const upstream = target.protocol === 'https:' ? https : http;
  const sockets = new Set();
  const authCookie = readAuthCookie(cfg);

  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      sendJson(res, 200, { ok: true, upstream: cfg.penpotOrigin });
      return;
    }
    const reqPath = String(req.url || '').split('?')[0];
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.includes(key) && key !== 'host') headers[key] = value;
    }
    headers.host = target.host;
    // Ask upstream for plain bodies: the proxy rewrites config.js and cannot decode gzip/br here.
    delete headers['accept-encoding'];
    if (authCookie) {
      const current = String(headers.cookie || '');
      headers.cookie = current && /auth-token=/.test(current) ? current : (current ? current + '; ' : '') + 'auth-token=' + authCookie;
    }
    const upstreamReq = upstream.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        method: req.method,
        path: req.url,
        headers,
      },
      (upstreamRes) => {
        res.statusCode = upstreamRes.statusCode || 502;
        for (const [key, value] of Object.entries(upstreamRes.headers)) {
          if (DROPPED_RESPONSE_HEADERS.includes(key)) continue;
          if (key === 'set-cookie') {
            res.setHeader('set-cookie', [].concat(value).map(rewriteSetCookie));
            continue;
          }
          if (key === 'location' && typeof value === 'string' && value.startsWith(cfg.penpotOrigin)) {
            res.setHeader('location', proxyOriginFor(req, proxyPortValue) + value.slice(cfg.penpotOrigin.length));
            continue;
          }
          res.setHeader(key, value);
        }
        const contentType = String(upstreamRes.headers['content-type'] || '');
        const wantsConfig = reqPath === '/js/config.js';
        const wantsHtml = /text\/html/i.test(contentType);
        if (wantsConfig || wantsHtml) {
          // 1) config.js bakes Penpot's public URI; rewrite it to this proxy (same origin),
          //    otherwise the SPA talks straight to :9001 and the browser blocks it as CORS.
          // 2) index.html gets a fixed suffix on the config.js version query so a copy
          //    cached from an earlier (broken) build cannot keep pointing at the upstream.
          const chunks = [];
          upstreamRes.on('data', (chunk) => chunks.push(chunk));
          upstreamRes.on('end', () => {
            const proxyOrigin = proxyOriginFor(req, proxyPortValue);
            let body = Buffer.concat(chunks).toString('utf8');
            if (wantsConfig) body = body.split(cfg.penpotOrigin).join(proxyOrigin);
            if (wantsHtml) {
              body = body.replace(/(\/js\/config\.js\?version=)([0-9A-Za-z._-]+)/g, (match, prefix, version) =>
                version.endsWith('-pcfg1') ? match : prefix + version + '-pcfg1'
              );
            }
            res.removeHeader('content-length');
            res.setHeader('content-length', Buffer.byteLength(body));
            if (wantsConfig) res.setHeader('cache-control', 'no-store');
            res.end(body);
          });
          upstreamRes.on('error', () => res.destroy());
          return;
        }
        upstreamRes.pipe(res);
      }
    );
    upstreamReq.on('error', (err) => {
      log('proxy error: ' + err.message);
      if (!res.headersSent) {
        res.statusCode = 502;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end('<h1>Penpot 不可达</h1><p>' + String(cfg.penpotOrigin) + ' 没有响应：' + err.message + '</p>');
      } else {
        res.destroy();
      }
    });
    req.pipe(upstreamReq);
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  server.on('upgrade', (req, socket, head) => {
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const lower = key.toLowerCase();
      // WebSocket handshake headers (connection/upgrade) must survive: they are the
      // upgrade request itself, not transfer framing. Dropping them makes nginx
      // answer with a plain HTTP error (non-101) and the socket never upgrades.
      if (lower === 'connection' || lower === 'upgrade') continue;
      if (HOP_BY_HOP.includes(lower)) continue;
      headers[lower] = value;
    }
    headers.connection = 'Upgrade';
    headers.upgrade = String(req.headers.upgrade || 'websocket');
    headers.host = target.host;
    const upstreamSocket = net.connect(
      Number(target.port || (target.protocol === 'https:' ? 443 : 80)),
      target.hostname,
      () => {
        const lines = ['GET ' + req.url + ' HTTP/1.1'];
        for (const [key, value] of Object.entries(headers)) {
          for (const item of [].concat(value)) lines.push(key + ': ' + item);
        }
        upstreamSocket.write(lines.join('\r\n') + '\r\n\r\n');
        if (head && head.length) upstreamSocket.write(head);
        socket.pipe(upstreamSocket);
        upstreamSocket.pipe(socket);
      }
    );
    upstreamSocket.on('error', () => socket.destroy());
    socket.on('error', () => upstreamSocket.destroy());
  });

  let proxyPortValue = cfg.proxyPort;

  const listen = (index) =>
    new Promise((resolve, reject) => {
      const port = index < 0 ? cfg.proxyPort : index < PORT_CANDIDATES.length ? PORT_CANDIDATES[index] : 0;
      server.once('error', (err) => {
        if (err && err.code === 'EADDRINUSE' && index + 1 < PORT_CANDIDATES.length) {
          resolve(listen(index + 1));
          return;
        }
        reject(err);
      });
      server.listen(port, cfg.proxyHost, () => {
        const address = server.address();
        proxyPortValue = typeof address === 'object' && address ? address.port : port;
        resolve(proxyPortValue);
      });
    });

  return {
    start: () => listen(0),
    get port() {
      return proxyPortValue;
    },
    dispose: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        sockets.clear();
        server.close(() => resolve(true));
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      }),
  };
}

const MAX_BODY = 64 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        reject(new HttpError(413, 'request body is too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'request body must be JSON'));
      }
    });
    req.on('error', reject);
  });
}

function rpcErrorText(result) {
  const json = result && result.json;
  if (json) {
    if (json.explain) return String(json.explain);
    if (json.message) return String(json.message);
    if (json.code) return String(json.code);
    if (json.type) return String(json.type);
  }
  return String((result && result.text) || '').slice(0, 400);
}

async function rpcOrThrow(cfg, command, args) {
  const result = await rpc(cfg, command, args);
  if (result.status < 200 || result.status >= 300) {
    const status = result.status === 404 ? 404 : result.status === 400 ? 400 : 502;
    throw new HttpError(status, command + ' failed: HTTP ' + result.status + ' ' + rpcErrorText(result));
  }
  return result.json;
}

function invalidateList() {
  listCache.data = null;
  listCache.at = 0;
}

async function upstreamStatus(cfg) {
  try {
    const res = await fetch(cfg.penpotOrigin + '/', { method: 'GET', signal: AbortSignal.timeout(4000) });
    return { reachable: res.ok, httpStatus: res.status };
  } catch (err) {
    return { reachable: false, error: String((err && err.message) || err) };
  }
}

async function coreStatus(cfg, state) {
  const upstream = await upstreamStatus(cfg);
  let profile = null;
  try {
    const result = await rpc(cfg, 'get-profile');
    if (result.status === 200 && result.json) {
      profile = { id: String(result.json.id || ''), email: String(result.json.email || ''), name: String(result.json.name || '') };
    }
  } catch {
    profile = null;
  }
  return {
    ok: Boolean(upstream.reachable && state.ready),
    origin: cfg.penpotOrigin,
    reachable: Boolean(upstream.reachable),
    httpStatus: Number(upstream.httpStatus || 0),
    penpotError: String(upstream.error || ''),
    profileEmail: profile ? profile.email : '',
    profileName: profile ? profile.name : '',
    proxyReady: Boolean(state.ready),
    proxyPort: Number(state.port || 0),
    proxyHost: cfg.proxyHost,
    proxyError: String(state.error || ''),
    accessToken: Boolean(readAccessToken(cfg)),
    authCookie: Boolean(readAuthCookie(cfg)),
  };
}

async function coreFiles(cfg, force) {
  const data = await discoverFiles(cfg, Boolean(force));
  return { ok: true, count: data.files.length, teams: data.teams, files: data.files, fetchedAt: new Date().toISOString() };
}

function filePatch(file) {
  const out = { id: String(file.id || ''), name: String(file.name || '') };
  if (file.projectId) out.projectId = String(file.projectId);
  if (file.teamId) out.teamId = String(file.teamId);
  if (file.modifiedAt) out.modifiedAt = String(file.modifiedAt);
  if (typeof file.revn === 'number') out.revn = file.revn;
  return out;
}

function buildWorkspaceUrl(base, teamId, fileId, pageId) {
  const query = ['team-id=' + encodeURIComponent(teamId || ''), 'file-id=' + encodeURIComponent(fileId)];
  if (pageId) query.push('page-id=' + encodeURIComponent(pageId));
  return base + '#/workspace?' + query.join('&');
}

async function coreOpen(cfg, state, input, baseOverride) {
  const fileId = String(input.fileId || '').trim();
  if (!fileId) throw new HttpError(400, 'fileId is required');
  let teamId = String(input.teamId || '').trim();
  let pageId = String(input.pageId || '').trim();
  if (!teamId || !pageId) {
    const file = await rpcOrThrow(cfg, 'get-file', { id: fileId });
    if (!teamId) teamId = String((file && file.teamId) || '');
    if (!pageId) {
      const pages = file && file.data && file.data.pages;
      if (Array.isArray(pages) && pages.length) pageId = String(pages[0].id || '');
    }
  }
  const base = baseOverride || 'http://127.0.0.1:' + state.port + '/';
  const query = 'team-id=' + encodeURIComponent(teamId) + '&file-id=' + encodeURIComponent(fileId) + (pageId ? '&page-id=' + encodeURIComponent(pageId) : '');
  return {
    fileId,
    teamId,
    pageId,
    url: buildWorkspaceUrl(base, teamId, fileId, pageId),
    externalUrl: cfg.penpotOrigin + '/#/workspace?' + query,
  };
}

async function defaultProject(cfg) {
  const teams = await rpcOrThrow(cfg, 'get-teams');
  const list = Array.isArray(teams) ? teams : [];
  for (const team of list) {
    const projects = await rpcOrThrow(cfg, 'get-projects', { 'team-id': team.id });
    const rows = Array.isArray(projects) ? projects : [];
    if (rows.length) return { projectId: String(rows[0].id), teamId: String(team.id) };
  }
  throw new HttpError(404, 'no Penpot project found: create one in Penpot first');
}

async function coreCreateFile(cfg, input) {
  const name = String(input.name || '').trim();
  if (!name) throw new HttpError(400, 'name is required');
  let projectId = String(input.projectId || '').trim();
  if (!projectId) projectId = (await defaultProject(cfg)).projectId;
  const file = await rpcOrThrow(cfg, 'create-file', { name, 'project-id': projectId });
  invalidateList();
  return filePatch(file || {});
}

async function coreRenameFile(cfg, input) {
  const fileId = String(input.fileId || '').trim();
  const name = String(input.name || '').trim();
  if (!fileId) throw new HttpError(400, 'fileId is required');
  if (!name) throw new HttpError(400, 'name is required');
  const file = await rpcOrThrow(cfg, 'rename-file', { id: fileId, name });
  invalidateList();
  return filePatch(file || { id: fileId, name });
}

async function coreDuplicateFile(cfg, input) {
  const fileId = String(input.fileId || '').trim();
  if (!fileId) throw new HttpError(400, 'fileId is required');
  const body = { 'file-id': fileId };
  const name = String(input.name || '').trim();
  if (name) body.name = name;
  const file = await rpcOrThrow(cfg, 'duplicate-file', body);
  invalidateList();
  return filePatch(file || {});
}

async function coreDeleteFile(cfg, input) {
  const fileId = String(input.fileId || '').trim();
  if (!fileId) throw new HttpError(400, 'fileId is required');
  await rpcOrThrow(cfg, 'delete-file', { id: fileId });
  invalidateList();
  return { deleted: true, fileId };
}

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

function safeFileName(name) {
  const cleaned = String(name || 'export').replace(/[\\/:*?"<>|\r\n]+/g, '_').replace(/\s+/g, ' ').trim();
  return (cleaned || 'export').slice(0, 120);
}

function uniquePath(dir, base, ext) {
  let candidate = path.join(dir, base + ext);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, base + ' (' + index + ')' + ext);
    index += 1;
  }
  return candidate;
}

async function fetchTransit(cfg, command, args) {
  const token = readAccessToken(cfg);
  if (!token) throw new HttpError(401, 'Penpot access token not found');
  let url = cfg.penpotOrigin + '/api/rpc/command/' + command;
  if (args && Object.keys(args).length) url += '?' + new URLSearchParams(args).toString();
  const res = await fetch(url, { headers: { authorization: 'Token ' + token }, signal: AbortSignal.timeout(cfg.rpcTimeoutMs) });
  const text = await res.text();
  if (res.status < 200 || res.status >= 300) throw new HttpError(res.status === 404 ? 404 : 502, command + ' failed: HTTP ' + res.status + ' ' + text.slice(0, 300));
  return decodeMaybe(text);
}

function filePages(file) {
  const data = (file && file.data) || {};
  const order = Array.isArray(data.pages) ? data.pages : [];
  const index = data['pages-index'] || {};
  function pageObjects(page) {
    const objects = page && page.objects ? page.objects : {};
    return Object.keys(objects).map((key) => objects[key]).filter(Boolean);
  }
  const pages = order.map((id) => {
    const page = index[id] || index[String(id)] || {};
    return { id: String(id), name: String(page.name || ''), objects: pageObjects(page) };
  });
  return pages;
}

function rootFrames(page) {
  return page.objects
    .filter((shape) => shape && shape.type === 'frame' && shape['parent-id'] === ZERO_UUID && String(shape.id) !== ZERO_UUID)
    .filter((shape) => Number(shape.width) > 1 && Number(shape.height) > 1)
    .map((shape) => ({ id: String(shape.id), name: String(shape.name || 'frame'), width: Number(shape.width || 0), height: Number(shape.height || 0) }));
}

async function coreFileInfo(cfg, input) {
  const fileId = String(input.fileId || '').trim();
  if (!fileId) throw new HttpError(400, 'fileId is required');
  const file = await fetchTransit(cfg, 'get-file', { id: fileId });
  const pages = filePages(file).map((page) => {
    const frames = rootFrames(page);
    return { id: page.id, name: page.name, frameCount: frames.length, frames };
  });
  return { fileId, name: String((file && file.name) || ''), pages };
}

async function exportOne(cfg, cookie, payload) {
  const body = encode({
    cmd: keyword('export-shapes'),
    wait: true,
    'profile-id': uuid(payload.profileId),
    exports: [{
      'file-id': uuid(payload.fileId),
      'page-id': uuid(payload.pageId),
      'object-id': uuid(payload.objectId),
      type: keyword(payload.format),
      suffix: '',
      scale: Number(payload.scale) || 1,
      name: payload.name,
    }],
  });
  const res = await fetch(cfg.penpotOrigin + '/api/export', {
    method: 'POST',
    headers: { 'content-type': 'application/transit+json', accept: 'application/transit+json', cookie: 'auth-token=' + cookie },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(cfg.exportTimeoutMs),
  });
  const text = await res.text();
  if (res.status < 200 || res.status >= 300) throw new HttpError(502, 'export failed: HTTP ' + res.status + ' ' + text.slice(0, 400));
  const resource = decode(JSON.parse(text));
  if (!resource || !resource.uri) throw new HttpError(502, 'export returned no resource uri');
  let url = String(resource.uri);
  if (url.startsWith(cfg.penpotOrigin)) {
    /* already absolute to us */
  } else if (/^https?:/i.test(url)) {
    const parsed = new URL(url);
    url = cfg.penpotOrigin + parsed.pathname + parsed.search;
  } else {
    url = cfg.penpotOrigin + (url.startsWith('/') ? url : '/' + url);
  }
  const bin = await fetch(url, { headers: { cookie: 'auth-token=' + cookie }, signal: AbortSignal.timeout(cfg.exportTimeoutMs) });
  if (!bin.ok) throw new HttpError(502, 'download failed: HTTP ' + bin.status);
  const buf = Buffer.from(await bin.arrayBuffer());
  fs.mkdirSync(cfg.exportDir, { recursive: true });
  const target = uniquePath(cfg.exportDir, safeFileName(payload.name) || safeFileName(resource.filename), path.extname(String(resource.filename || '.' + payload.format)));
  fs.writeFileSync(target, buf);
  return {
    name: String(resource.name || payload.name),
    filename: path.basename(target),
    mtype: String(resource.mtype || ''),
    bytes: buf.length,
    path: target,
    url: BASE + '/exports/' + encodeURIComponent(path.basename(target)),
  };
}

async function coreExport(cfg, input) {
  const fileId = String(input.fileId || '').trim();
  if (!fileId) throw new HttpError(400, 'fileId is required');
  const format = String(input.format || 'png').toLowerCase();
  if (!['png', 'jpeg', 'svg'].includes(format)) throw new HttpError(400, 'format must be png, jpeg or svg');
  const scale = Math.min(Math.max(Number(input.scale) || 1, 1), 4);
  const cookie = readAuthCookie(cfg);
  if (!cookie) throw new HttpError(401, 'Penpot auth cookie not found (~/.penpot-auth.json)');
  const profile = await fetchTransit(cfg, 'get-profile', null);
  const profileId = String((profile && profile.id) || '');
  if (!profileId) throw new HttpError(502, 'could not resolve Penpot profile id');
  const file = await fetchTransit(cfg, 'get-file', { id: fileId });
  const pages = filePages(file);
  if (!pages.length) throw new HttpError(404, 'file has no pages');
  const pageId = String(input.pageId || '').trim();
  const page = pageId ? pages.find((row) => row.id === pageId) : pages[0];
  if (!page) throw new HttpError(404, 'page not found in file');
  const wanted = Array.isArray(input.objectIds) ? input.objectIds.map((id) => String(id)) : [];
  const frames = rootFrames(page);
  const targets = wanted.length
    ? wanted.map((id) => frames.find((frame) => frame.id === id) || page.objects.find((shape) => String(shape.id) === id)).filter(Boolean).map((shape) => ({ id: String(shape.id), name: String(shape.name || 'object') }))
    : frames;
  if (!targets.length) throw new HttpError(404, 'no root frames found on the selected page');
  const files = [];
  for (const target of targets) {
    files.push(await exportOne(cfg, cookie, { profileId, fileId, pageId: page.id, objectId: target.id, name: target.name, scale, format }));
  }
  return { ok: true, fileId, pageId: page.id, pageName: page.name, format, scale, count: files.length, exportDir: cfg.exportDir, files };
}

function serveExport(cfg, req, res) {
  const url = new URL(String(req.url || ''), 'http://localhost');
  const name = decodeURIComponent(url.pathname.replace(BASE + '/exports/', '')) || '';
  const target = path.join(cfg.exportDir, path.basename(name));
  if (!name || path.dirname(target) !== cfg.exportDir || !fs.existsSync(target)) {
    sendJson(res, 404, { ok: false, error: 'export not found' });
    return;
  }
  const ext = path.extname(target).toLowerCase();
  const type = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream';
  const data = fs.readFileSync(target);
  res.writeHead(200, { 'content-type': type, 'content-length': data.length, 'cache-control': 'no-store' });
  res.end(data);
}

function renderJson(value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

// Local tool-definition helper: the plugin lives outside the DSH profile, so a
// bare import of @deepseek-ai/dsh-tools would not resolve from this file. The
// registry only needs compiled JSON schemas, which we build here.
function specToJsonSchema(spec) {
  const properties = {};
  const required = [];
  for (const [key, raw] of Object.entries(spec || {})) {
    const prop = Object.assign({}, raw);
    if (prop.required === true) {
      required.push(key);
      delete prop.required;
    }
    properties[key] = prop;
  }
  const schema = { type: 'object', properties };
  if (required.length) schema.required = required;
  schema.additionalProperties = false;
  return schema;
}

function compileSchema(raw) {
  const out = { type: (raw && raw.type) || 'object' };
  const required = Array.isArray(raw && raw.required) ? raw.required.slice() : [];
  if (raw && raw.properties) {
    out.properties = {};
    for (const [key, value] of Object.entries(raw.properties)) {
      const prop = Object.assign({}, value);
      if (prop.required === true) {
        required.push(key);
        delete prop.required;
      }
      out.properties[key] = prop;
    }
  }
  if (required.length) out.required = Array.from(new Set(required));
  out.additionalProperties = raw && raw.additionalProperties !== undefined ? raw.additionalProperties : false;
  return out;
}
function defineLocalTool(options) {
  const tool = {
    name: options.name,
    description: options.description,
    parameters: specToJsonSchema(options.parameters),
    output: { schema: compileSchema(options.output.schema), render: options.output.render },
    async execute(args, exec) {
      return options.execute(args || {}, exec);
    },
  };
  if (typeof options.isConcurrencySafe === 'function') tool.isConcurrencySafe = options.isConcurrencySafe;
  return tool;
}

// ---------------------------------------------------------------- MCP bridge
// Penpot 2.17 ships a built-in "Penpot MCP Plugin". When the workspace is open it
// connects a WebSocket to the server (through this plugin's reverse proxy) and runs
// arbitrary Penpot plugin-API JavaScript on request. These helpers talk that same
// MCP server over its HTTP stream transport, so the host half can drive the live editor.
const MCP_SESSIONS = new Map();

function readTextQuiet(file) {
  try {
    return String(fs.readFileSync(file, 'utf8')).trim();
  } catch (err) {
    return '';
  }
}

function mcpTokenFor(cfg) {
  if (cfg.mcpToken) return cfg.mcpToken;
  return readTextQuiet(cfg.mcpTokenFile);
}

function parseSseJson(text) {
  const parts = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line.startsWith('data:')) parts.push(line.slice(5).trim());
  }
  const payload = parts.join('');
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch (err) {
    return null;
  }
}

async function mcpPost(cfg, token, sessionId, body) {
  const url = cfg.penpotOrigin + '/mcp/stream?userToken=' + encodeURIComponent(token);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('MCP 请求超时（' + cfg.mcpTimeoutMs + 'ms）')), cfg.mcpTimeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: Object.assign(
        { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        sessionId ? { 'mcp-session-id': sessionId } : {}
      ),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    return { status: res.status, sessionId: res.headers.get('mcp-session-id') || '', json: parseSseJson(text), text: text };
  } finally {
    clearTimeout(timer);
  }
}

async function mcpSession(cfg, token, force) {
  const key = cfg.penpotOrigin + '|' + token.slice(-16);
  const cached = MCP_SESSIONS.get(key);
  if (cached && !force) return cached;
  const init = await mcpPost(cfg, token, '', {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dsh-penpot', version: '0.3.0' } },
  });
  if (init.status !== 200 || !init.sessionId) {
    throw new Error('Penpot MCP 初始化失败：HTTP ' + init.status + ' ' + String(init.text || '').slice(0, 200));
  }
  await mcpPost(cfg, token, init.sessionId, { jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => null);
  MCP_SESSIONS.set(key, init.sessionId);
  return init.sessionId;
}

async function mcpCall(cfg, name, args) {
  const token = mcpTokenFor(cfg);
  if (!token) {
    throw new Error('缺少 Penpot MCP token：在 Penpot「设置 → 集成 → MCP key」生成后写入 ' + cfg.mcpTokenFile);
  }
  let sessionId = await mcpSession(cfg, token, false);
  const payload = (id) => ({ jsonrpc: '2.0', id: id, method: 'tools/call', params: { name: name, arguments: args || {} } });
  let out = await mcpPost(cfg, token, sessionId, payload(2));
  if (out.status === 400 || out.status === 404) {
    sessionId = await mcpSession(cfg, token, true);
    out = await mcpPost(cfg, token, sessionId, payload(3));
  }
  const json = out.json || {};
  if (json.error) throw new Error('MCP 调用失败：' + ((json.error && json.error.message) || JSON.stringify(json.error)));
  const result = json.result || {};
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .map((item) => (item && typeof item.text === 'string' ? item.text : ''))
    .join('\n')
    .trim();
  if (result.isError) throw new Error(text || 'MCP 工具返回错误');
  return { text: text, result: result };
}

// execute_code answers with {"result": ..., "log": "..."} inside a text block.
function mcpUnwrap(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'result')) return parsed;
  } catch (err) {
    /* plain text answer */
  }
  return null;
}

async function coreMcpStatus(cfg) {
  const out = { ok: true, connected: false, file: '', page: '', selection: 0, error: '', tokenPresent: Boolean(mcpTokenFor(cfg)) };
  const probe =
    'var f = penpot.currentFile; var p = penpot.currentPage; ' +
    'return { file: f && f.name, page: p && p.name, selection: penpot.selection ? penpot.selection.length : 0 };';
  try {
    const answer = await mcpCall(cfg, 'execute_code', { code: probe });
    const payload = mcpUnwrap(answer.text);
    const value = payload ? payload.result : answer.text;
    if (value && typeof value === 'object') {
      out.connected = true;
      out.file = String(value.file || '');
      out.page = String(value.page || '');
      out.selection = Number(value.selection || 0);
    } else {
      out.error = String(value || '').slice(0, 400);
    }
  } catch (err) {
    out.error = String((err && err.message) || err);
  }
  return out;
}

async function coreRunCode(cfg, code) {
  const source = String(code || '');
  if (!source.trim()) throw new Error('code 不能为空');
  const answer = await mcpCall(cfg, 'execute_code', { code: source });
  const payload = mcpUnwrap(answer.text);
  const value = payload ? payload.result : answer.text;
  return {
    ok: true,
    text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    log: payload ? String(payload.log || '') : '',
  };
}

async function coreApiInfo(cfg, type, member) {
  const args = { type: String(type || '') };
  if (member) args.member = String(member);
  if (!args.type) throw new Error('type 不能为空（例如 Frame、Shape、Page、Penpot）');
  const answer = await mcpCall(cfg, 'penpot_api_info', args);
  return { ok: true, text: answer.text };
}

function createTools(cfg, state) {
  const tools = [];

  tools.push(defineLocalTool({
    name: 'penpot_status',
    description: 'Check the built-in Penpot integration for DSH: upstream reachability, logged-in Penpot profile, and whether the same-origin iframe proxy is ready. Call this before the other penpot_* tools.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          origin: { type: 'string', required: true },
          reachable: { type: 'boolean', required: true },
          httpStatus: { type: 'integer', required: true },
          penpotError: { type: 'string', required: true },
          profileEmail: { type: 'string', required: true },
          profileName: { type: 'string', required: true },
          proxyReady: { type: 'boolean', required: true },
          proxyPort: { type: 'integer', required: true },
          proxyHost: { type: 'string', required: true },
          proxyError: { type: 'string', required: true },
          accessToken: { type: 'boolean', required: true },
          authCookie: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    isConcurrencySafe: () => true,
    async execute() {
      return coreStatus(cfg, state);
    },
  }));

  tools.push(defineLocalTool({
    name: 'penpot_files',
    description: 'List Penpot teams and design files accessible to the configured access token, newest first. Use the returned file id with penpot_open or the file-management tools.',
    parameters: {
      refresh: { type: 'boolean', description: 'Bypass the 20s list cache and re-read from Penpot.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          count: { type: 'integer', required: true },
          teams: { type: 'array', items: { type: 'object', additionalProperties: true }, required: true },
          files: { type: 'array', items: { type: 'object', additionalProperties: true }, required: true },
          fetchedAt: { type: 'string', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      return coreFiles(cfg, args.refresh === true);
    },
  }));

  tools.push(defineLocalTool({
    name: 'penpot_open',
    description: 'Resolve a workspace URL for one Penpot file, including its team id and first page, for embedding in the DSH sidebar or opening in a browser.',
    parameters: {
      file_id: { type: 'string', required: true, description: 'Penpot file id (uuid).' },
      team_id: { type: 'string', description: 'Optional team id; looked up from the file when omitted.' },
      page_id: { type: 'string', description: 'Optional page id; defaults to the first page of the file.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fileId: { type: 'string', required: true },
          teamId: { type: 'string', required: true },
          pageId: { type: 'string', required: true },
          url: { type: 'string', required: true },
          externalUrl: { type: 'string', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      return coreOpen(cfg, state, { fileId: args.file_id, teamId: args.team_id, pageId: args.page_id });
    },
  }));

  const fileSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string', required: true },
      name: { type: 'string', required: true },
      projectId: { type: 'string' },
      teamId: { type: 'string' },
      modifiedAt: { type: 'string' },
      revn: { type: 'integer' },
    },
  };

  tools.push(defineLocalTool({
    name: 'penpot_create_file',
    description: 'Create a new design file in Penpot. Returns the new file id and name; open it with penpot_open.',
    parameters: {
      name: { type: 'string', required: true, description: 'File name (max 250 chars).' },
      project_id: { type: 'string', description: 'Target project id; defaults to the first project of the first team.' },
    },
    output: { schema: fileSchema, render: (_a, v) => renderJson(v) },
    isConcurrencySafe: () => false,
    async execute(args) {
      return coreCreateFile(cfg, { name: args.name, projectId: args.project_id });
    },
  }));

  tools.push(defineLocalTool({
    name: 'penpot_rename_file',
    description: 'Rename an existing Penpot file.',
    parameters: {
      file_id: { type: 'string', required: true, description: 'Penpot file id (uuid).' },
      name: { type: 'string', required: true, description: 'New file name (max 250 chars).' },
    },
    output: { schema: fileSchema, render: (_a, v) => renderJson(v) },
    isConcurrencySafe: () => false,
    async execute(args) {
      return coreRenameFile(cfg, { fileId: args.file_id, name: args.name });
    },
  }));

  tools.push(defineLocalTool({
    name: 'penpot_duplicate_file',
    description: 'Duplicate a Penpot file, optionally with a new name. Returns the copy, not the original.',
    parameters: {
      file_id: { type: 'string', required: true, description: 'Penpot file id (uuid) to copy.' },
      name: { type: 'string', description: 'Optional name for the copy (max 250 chars).' },
    },
    output: { schema: fileSchema, render: (_a, v) => renderJson(v) },
    isConcurrencySafe: () => false,
    async execute(args) {
      return coreDuplicateFile(cfg, { fileId: args.file_id, name: args.name });
    },
  }));

  tools.push(defineLocalTool({
    name: 'penpot_delete_file',
    description: 'Move a Penpot file to the trash (soft delete via the Penpot delete-file RPC).',
    parameters: {
      file_id: { type: 'string', required: true, description: 'Penpot file id (uuid).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          deleted: { type: 'boolean', required: true },
          fileId: { type: 'string', required: true },
        },
      },
      render: (_a, v) => renderJson(v),
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      return coreDeleteFile(cfg, { fileId: args.file_id });
    },
  }));

  tools.push(defineLocalTool({
    name: 'penpot_export',
    description: 'Export frames from a Penpot file to PNG/JPEG/SVG with Penpot\'s official exporter and save the files locally. By default exports every root frame (board) of the selected page at 2x; returns local file paths plus same-origin download URLs.',
    parameters: {
      file_id: { type: 'string', required: true, description: 'Penpot file id (uuid).' },
      page_id: { type: 'string', description: 'Page id; defaults to the first page.' },
      object_ids: { type: 'array', items: { type: 'string' }, description: 'Optional frame/object ids. Defaults to every root frame on the page.' },
      scale: { type: 'number', description: 'Export scale 1-4 (default 2).' },
      format: { type: 'string', enum: ['png', 'jpeg', 'svg'], description: 'Output format (default png).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          fileId: { type: 'string', required: true },
          pageId: { type: 'string', required: true },
          pageName: { type: 'string', required: true },
          format: { type: 'string', required: true },
          scale: { type: 'number', required: true },
          count: { type: 'integer', required: true },
          exportDir: { type: 'string', required: true },
          files: { type: 'array', items: { type: 'object', additionalProperties: true }, required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      return coreExport(cfg, { fileId: args.file_id, pageId: args.page_id, objectIds: args.object_ids, scale: args.scale, format: args.format });
    },
  }));

  tools.push(defineLocalTool({
    name: 'penpot_mcp_status',
    description: "Check whether the currently open Penpot workspace is bridged to the host through Penpot's built-in MCP plugin. Reports the file, page and selection size that penpot_run_code would act on.",
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          connected: { type: 'boolean', required: true },
          file: { type: 'string', required: true },
          page: { type: 'string', required: true },
          selection: { type: 'integer', required: true },
          error: { type: 'string', required: true },
          tokenPresent: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    isConcurrencySafe: () => true,
    async execute() {
      return coreMcpStatus(cfg);
    },
  }));

  tools.push(defineLocalTool({
    name: 'penpot_run_code',
    description: 'Run JavaScript inside the Penpot editor that has a file open right now (Penpot plugin API): create frames, set text, apply fills, read or move shapes. The code runs as a function body and may return a JSON-safe value. Requires the workspace tab to be open in the DSH sidebar (penpot_mcp_status.connected = true).',
    parameters: {
      code: { type: 'string', required: true, description: "JavaScript body executed in the plugin context. Use the penpot, penpotUtils and storage objects; 'return' whatever value should come back." },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          text: { type: 'string', required: true },
          log: { type: 'string', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      return coreRunCode(cfg, args.code);
    },
  }));

  tools.push(defineLocalTool({
    name: 'penpot_api_info',
    description: 'Read the Penpot plugin API documentation for one type (Frame, Shape, Text, Page, File, Penpot, ...) and optionally one member. Use it when unsure which method or property penpot_run_code should call.',
    parameters: {
      type: { type: 'string', required: true, description: 'API type name, for example Frame or Board.' },
      member: { type: 'string', description: 'Optional member name inside that type.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          text: { type: 'string', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      return coreApiInfo(cfg, args.type, args.member);
    },
  }));

  return tools;
}

export function apply(ctx, rawConfig) {
  const cfg = normalizeConfig(rawConfig);
  const log = (...parts) => console.log('[dsh-penpot]', ...parts);
  const proxy = startProxy(cfg, log);
  const state = { port: cfg.proxyPort, ready: false, error: null };

  ctx.effect(() => {
    proxy
      .start()
      .then((port) => {
        state.port = port;
        state.ready = true;
        log('proxy listening on ' + cfg.proxyHost + ':' + port + ' -> ' + cfg.penpotOrigin);
      })
      .catch((err) => {
        state.error = String((err && err.message) || err);
        log('proxy failed: ' + state.error);
      });
    return () => proxy.dispose();
  });

  const route = (path, handler) => ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }));

  route(BASE + '/status', async (req, res) => {
    const s = await coreStatus(cfg, state);
    // Flat fields for penpot_status; nested groups keep older sidebar clients working.
    sendJson(res, 200, Object.assign({}, s, {
      penpot: { reachable: s.reachable, error: s.penpotError, origin: s.origin, httpStatus: s.httpStatus },
      proxy: { ready: s.proxyReady, host: s.proxyHost, port: s.proxyPort, error: s.proxyError },
      profile: { email: s.profileEmail, name: s.profileName },
    }));
  });

  route(BASE + '/files', async (req, res) => {
    const force = /[?&]refresh=1/.test(String(req.url || ''));
    try {
      sendJson(res, 200, await coreFiles(cfg, force));
    } catch (err) {
      sendJson(res, 200, { ok: false, error: String((err && err.message) || err), code: (err && err.code) || null, teams: [], files: [] });
    }
  });

  route(BASE + '/open', async (req, res) => {
    const url = new URL(String(req.url || ''), 'http://localhost');
    try {
      const result = await coreOpen(
        cfg,
        state,
        { fileId: url.searchParams.get('fileId') || '', teamId: url.searchParams.get('teamId') || '', pageId: url.searchParams.get('pageId') || '' },
        proxyOriginFor(req, state.port) + '/'
      );
      sendJson(res, 200, Object.assign({ ok: true }, result));
    } catch (err) {
      sendJson(res, (err && err.status) || 502, { ok: false, error: String((err && err.message) || err) });
    }
  });

  route(BASE + '/refresh', async (req, res) => {
    invalidateList();
    sendJson(res, 200, { ok: true });
  });

  const mutationRoute = (path, run) =>
    route(path, async (req, res) => {
      if (String(req.method || 'GET').toUpperCase() !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'POST required' });
        return;
      }
      try {
        const body = await readJsonBody(req);
        const result = await run(body || {});
        log('mutation ' + path + ' ok');
        sendJson(res, 200, { ok: true, file: result, result });
      } catch (err) {
        sendJson(res, (err && err.status) || 502, { ok: false, error: String((err && err.message) || err) });
      }
    });

  mutationRoute(BASE + '/files/create', (body) => coreCreateFile(cfg, { name: body.name, projectId: body.projectId }));
  mutationRoute(BASE + '/files/rename', (body) => coreRenameFile(cfg, { fileId: body.fileId, name: body.name }));
  mutationRoute(BASE + '/files/duplicate', (body) => coreDuplicateFile(cfg, { fileId: body.fileId, name: body.name }));
  mutationRoute(BASE + '/files/delete', (body) => coreDeleteFile(cfg, { fileId: body.fileId }));

  route(BASE + '/file-info', async (req, res) => {
    const url = new URL(String(req.url || ''), 'http://localhost');
    try {
      const info = await coreFileInfo(cfg, { fileId: url.searchParams.get('fileId') || '' });
      sendJson(res, 200, Object.assign({ ok: true }, info));
    } catch (err) {
      sendJson(res, (err && err.status) || 502, { ok: false, error: String((err && err.message) || err) });
    }
  });

  route(BASE + '/files/export', async (req, res) => {
    if (String(req.method || 'GET').toUpperCase() !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'POST required' });
      return;
    }
    // No keep-alive body bytes here: writing them implicitly sends the response
    // headers, after which sendJson can no longer set content-type/status and the
    // socket dies mid-response. A bare socket just stays quiet until the export ends.
    res.setTimeout(0);
    try {
      const body = await readJsonBody(req);
      const result = await coreExport(cfg, body || {});
      log('export ok: ' + result.count + ' file(s) into ' + result.exportDir);
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, (err && err.status) || 502, { ok: false, error: String((err && err.message) || err) });
    }
  });

  route(BASE + '/exports', (req, res) => serveExport(cfg, req, res));

  route(BASE + '/mcp/status', async (req, res) => {
    try {
      sendJson(res, 200, await coreMcpStatus(cfg));
    } catch (err) {
      sendJson(res, (err && err.status) || 502, { ok: false, connected: false, error: String((err && err.message) || err) });
    }
  });

  route(BASE + '/mcp/call', async (req, res) => {
    if (String(req.method || 'GET').toUpperCase() !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'POST required' });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const result = await coreRunCode(cfg, (body || {}).code);
      sendJson(res, 200, Object.assign({ ok: true }, result));
    } catch (err) {
      sendJson(res, (err && err.status) || 502, { ok: false, error: String((err && err.message) || err) });
    }
  });

  const tools = createTools(cfg, state);
  for (const tool of tools) ctx.tools.register(tool);
  log('registered ' + tools.length + ' penpot_* tools');
}

export const internals = { startProxy, coreStatus, coreFiles, coreOpen, coreCreateFile, coreRenameFile, coreDuplicateFile, coreDeleteFile, coreFileInfo, coreExport, coreMcpStatus, coreRunCode, coreApiInfo };