import { getUsage, incrementUsage } from '../services/store.js';

export function rateLimitMiddleware(req, res, next) {
  const user = req.user;
  const mode = req.body?.mode || 'deep';
  const lightMode = mode === 'images' || mode === 'batch' || mode === 'fetch-url';

  if (lightMode) {
    req.recordUsage = () => {};
    return next();
  }

  const used = getUsage(user.apiKey);

  if (used.scans >= user.dailyScanLimit) {
    return res.status(429).json({
      error: 'Daily scan limit reached',
      limit: user.dailyScanLimit,
      used: used.scans,
      resetsAt: 'midnight UTC'
    });
  }

  req.recordUsage = () => incrementUsage(user.apiKey);
  next();
}
