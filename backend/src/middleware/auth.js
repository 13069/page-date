import { getUserByApiKey } from '../services/store.js';

export function authMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing x-api-key header' });
  }

  const user = getUserByApiKey(apiKey);
  if (!user) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  req.user = user;
  next();
}
