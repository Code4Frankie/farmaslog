import crypto from 'node:crypto';

// Always server-generated; client-supplied IDs are not trusted.
export function requestId(req, res, next) {
  req.id = `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  res.set('X-Request-Id', req.id);
  next();
}
