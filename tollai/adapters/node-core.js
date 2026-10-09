import { getClientIp } from '../core/http.js';

export async function readNodeBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// A host application that already parsed the body (express.json()) must not
// lose it: we re-serialize, the tollai core only ever reads the body on
// /tollai/verify, and every other stream is left untouched for the host.
export function nodeToRequest(req, { body } = {}) {
  const method = String(req.method || 'GET').toUpperCase();
  const headers = {};
  for (const [name, value] of Object.entries(req.headers || {})) {
    headers[name] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  const init = { method, headers };
  if (body !== undefined && body !== null && !['GET', 'HEAD'].includes(method)) {
    const b = Buffer.isBuffer(body) ? body : String(body);
    if (b.length) init.body = b;
  }
  return new Request(requestUrl(req), init);
}

function requestUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'tollai.local';
  const path = req.originalUrl || req.url || '/';
  try {
    return new URL(path, `${proto}://${host}`).href;
  } catch {
    return `http://tollai.local${path}`;
  }
}

export function nodeCtx(req, overrides = {}) {
  const ctx = { ip: clientIp(req) };
  if (req.tollMode === 'unprotected') ctx.mode = 'off';
  // Per-route scenario set by the host before the middleware runs (mirrors
  // conditional toll mounting); wins over the core's path-based matcher.
  if (typeof req.tollScenario === 'string' && req.tollScenario) {
    ctx.tollScenario = req.tollScenario;
  }
  return Object.assign(ctx, overrides);
}

export function clientIp(req) {
  return (
    getClientIp(req.headers) ||
    (req.socket && req.socket.remoteAddress) ||
    (req.connection && req.connection.remoteAddress) ||
    ''
  );
}

export function mirrorContext(req, ctx) {
  Object.assign(req, {
    tollNeedsAttestation: ctx.needsAttestation === true,
    tollVerified: ctx.tollVerified === true,
    tollMetadata: ctx.tollMetadata,
    tollRequestId: ctx.tollRequestId,
    tollScenario: ctx.tollMetadata && ctx.tollMetadata.scenario,
  });
}

export function applyNodeOut(res, ctx) {
  if (!res || !ctx || !ctx.out) return;
  for (const [name, value] of Object.entries(ctx.out.headers || {})) {
    res.setHeader(name, String(value));
  }
  for (const cookie of ctx.out.setCookie || []) {
    appendSetCookie(res, cookie);
  }
}

export async function respondNode(res, response) {
  res.statusCode = response.status;
  const setCookies =
    typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  for (const [name, value] of response.headers) {
    if (name.toLowerCase() === 'set-cookie') continue;
    res.setHeader(name, value);
  }
  for (const cookie of setCookies) appendSetCookie(res, cookie);
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

function appendSetCookie(res, cookie) {
  if (res.appendHeader) res.appendHeader('set-cookie', cookie);
  else if (res.setHeader) res.setHeader('set-cookie', cookie);
  else if (res.headers) res.headers['set-cookie'] = cookie;
}