import { runNode } from './node-http.js';

// Firebase Cloud Functions adapter (onRequest, v1/v2 style (req, res)). The
// tollai core either answers the request itself or passes control to the
// downstream (req, res) handler unchanged.
export function tollaiOnRequest(toll, downstream) {
  if (!toll || typeof toll.handle !== 'function') {
    throw new Error('tollai: tollaiOnRequest requires a toll from createToll()');
  }
  if (typeof downstream !== 'function') {
    throw new Error('tollai: tollaiOnRequest downstream must be a (req, res) handler');
  }
  return function firebaseFunction(req, res) {
    const done = (err) => {
      if (err) {
        if (typeof res.status === 'function') res.status(500).json({ error: 'tollai: ' + err.message });
        else {
          res.statusCode = 500;
          res.end('tollai: ' + err.message);
        }
        return;
      }
      downstream(req, res);
    };
    return runNode(req, res, done, toll).catch((err) => done(err));
  };
}

export const tollaiFirebase = tollaiOnRequest;

export default tollaiOnRequest;