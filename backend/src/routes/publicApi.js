import { Router } from 'express';
import { createRequest } from '../services/requests.js';

const router = Router();

router.post('/register', (req, res) => {
  const { name, email, website, useCase, agreedToTerms } = req.body || {};

  if (!name?.trim() || !email?.trim()) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }
  if (!agreedToTerms) {
    return res.status(400).json({ error: 'You must agree to the Terms and Privacy Policy.' });
  }

  const result = createRequest({ name, email, website, useCase });
  if (result.error) {
    return res.status(409).json({ error: result.error });
  }

  res.json({
    ok: true,
    message: 'Request received. You will receive your API key by email after staff approval (usually within 1–2 business days).'
  });
});

export default router;
