import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import scanRouter from './routes/scan.js';
import publicApiRouter from './routes/publicApi.js';
import adminRouter from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '../public');
const PORT = process.env.PORT || 3847;
const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'PageDate API', version: '1.2.0' });
});

app.use('/api', publicApiRouter);
app.use('/admin/api', adminRouter);
app.use('/', scanRouter);

app.use(express.static(PUBLIC_DIR));

app.get('/privacy', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'privacy.html'));
});

app.get('/terms', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'terms.html'));
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`PageDate API running on http://localhost:${PORT}`);
  console.log(`Landing page: http://localhost:${PORT}/`);
  console.log(`Admin panel:  http://localhost:${PORT}/admin`);
  console.log(`Set ADMIN_PASSWORD env var before production deploy.`);
});
