import { Router } from 'express';
import { listRequests, approveRequest, rejectRequest } from '../services/requests.js';

const router = Router();
const tokens = new Set();

function checkAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.headers['x-admin-token'];
  if (token && tokens.has(token)) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

router.post('/login', (req, res) => {
  const password = process.env.ADMIN_PASSWORD || 'pagedate-admin-change-me';
  if (req.body?.password !== password) {
    return res.status(403).json({ error: 'Invalid password' });
  }
  const token = `adm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  tokens.add(token);
  res.json({ ok: true, token });
});

router.get('/requests', checkAdmin, (_req, res) => {
  res.json({ requests: listRequests() });
});

router.post('/requests/:id/approve', checkAdmin, (req, res) => {
  const result = approveRequest(req.params.id);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({
    ok: true,
    apiKey: result.apiKey,
    email: result.request.email,
    message: `Approved. Send this API key to ${result.request.email} manually.`
  });
});

router.post('/requests/:id/reject', checkAdmin, (req, res) => {
  const result = rejectRequest(req.params.id, req.body?.reason || '');
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true, request: result.request });
});

export default router;
