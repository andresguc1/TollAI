import { runNode } from './node-http.js';

// Vercel Node.js Serverless Function adapter. The tollai core either answers
// the request itself (challenge, 433, shell, 401, ...) or hands the request to
// the downstream (req, res) handler unchanged.
export function tollaiVercel(toll, downstream = null) {
  if (!toll || typeof toll.handle !== 'function') {
    throw new Error('tollai: tollaiVercel requires a toll from createToll()');
  }
  if (downstream !== null && typeof downstream !== 'function') {
    throw new Error('tollai: tollaiVercel downstream must be a (req, res) handler');
  }
  return function vercelFunction(req, res) {
    const done = (err) => {
      if (err) {
        if (typeof res.status === 'function') res.status(500).json({ error: 'tollai: ' + err.message });
        else {
          res.statusCode = 500;
          res.end('tollai: ' + err.message);
        }
        return;
      }
      if (typeof downstream === 'function') return downstream(req, res);
      if (res && !res.writableEnded && typeof res.end === 'function') res.end();
    };
    return runNode(req, res, done, toll).catch((err) => done(err));
  };
}

export default tollaiVercel;