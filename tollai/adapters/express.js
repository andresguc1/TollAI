import { runNode } from './node-http.js';

// Express adapter: drop-in middleware. Place it AFTER any body-parsing
// middleware (express.json()) so pre-parsed req.body stays available to the
// host. On a valid session the request is mirrored onto req.* (tollVerified,
// tollMetadata, tollNeedsAttestation, tollRequestId) and res.locals.tollai is
// filled in, Express-style.
export function tollaiMiddleware(toll) {
  if (!toll || typeof toll.handle !== 'function') {
    throw new Error('tollai: tollaiMiddleware requires a toll from createToll()');
  }
  return function expressTollaiMiddleware(req, res, next) {
    const done = (err) => {
      if (!err && res && res.locals) {
        res.locals.tollai = {
          verified: req.tollVerified === true,
          needsAttestation: req.tollNeedsAttestation === true,
          metadata: req.tollMetadata,
          requestId: req.tollRequestId,
        };
      }
      next(err);
    };
    return runNode(req, res, done, toll).catch((err) => done(err));
  };
}

export function createTollaiMiddleware(toll) {
  return tollaiMiddleware(toll);
}

export default tollaiMiddleware;