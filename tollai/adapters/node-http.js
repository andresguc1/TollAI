import {
  readNodeBody,
  nodeToRequest,
  nodeCtx,
  mirrorContext,
  applyNodeOut,
  respondNode,
} from './node-core.js';

// The tollai core only reads a request body when it owns the route
// (/tollai/verify). Every other body stream stays untouched for the host.
// A pre-parsed req.body (express.json(), or any body-parsing middleware) is
// re-serialized so the core sees the same payload without double-reading.
function needsRawBody(method, pathname) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && pathname === '/tollai/verify';
}

export async function runNode(req, res, next, toll) {
  const method = String(req.method || 'GET').toUpperCase();
  const url = new URL(
    (req.headers && req.headers['x-forwarded-proto'] ? 'https' : 'http') +
      '://tollai.local' +
      (req.originalUrl || req.url || '/'),
  );

  let body;
  if (!['GET', 'HEAD'].includes(method)) {
    if (req.body !== undefined && req.body !== null) {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    } else if (needsRawBody(method, url.pathname)) {
      body = await readNodeBody(req);
    }
  }

  const request = nodeToRequest(req, { body });
  const ctx = nodeCtx(req);
  const response = await toll.handle(request, ctx);
  mirrorContext(req, ctx);
  if (response === null) {
    applyNodeOut(res, ctx);
    return next();
  }
  await respondNode(res, response);
}

export function createTollaiMiddleware(toll) {
  if (!toll || typeof toll.handle !== 'function') {
    throw new Error('tollai: createTollaiMiddleware requires a toll from createToll()');
  }
  return function tollaiMiddleware(req, res, next) {
    const done = typeof next === 'function' ? next : () => {};
    runNode(req, res, done, toll).catch((err) => done(err));
  };
}

export default createTollaiMiddleware;