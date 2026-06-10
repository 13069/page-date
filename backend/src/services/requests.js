import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REQUESTS_PATH = path.join(__dirname, '../../data/requests.json');
const USERS_PATH = path.join(__dirname, '../../data/users.json');

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function listRequests() {
  const { requests = [] } = readJson(REQUESTS_PATH, { requests: [] });
  return requests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function createRequest({ name, email, website, useCase }) {
  const data = readJson(REQUESTS_PATH, { requests: [] });
  const exists = data.requests.some(
    (r) => r.email.toLowerCase() === email.toLowerCase() && r.status === 'pending'
  );
  if (exists) {
    return { error: 'A pending request already exists for this email.' };
  }

  const request = {
    id: crypto.randomUUID(),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    website: (website || '').trim(),
    useCase: (useCase || '').trim(),
    status: 'pending',
    createdAt: new Date().toISOString(),
    apiKey: null,
    reviewedAt: null
  };

  data.requests.push(request);
  writeJson(REQUESTS_PATH, data);
  return { request };
}

export function generateApiKey() {
  return `pagedate_sk_live_${crypto.randomBytes(12).toString('hex')}`;
}

export function approveRequest(id) {
  const data = readJson(REQUESTS_PATH, { requests: [] });
  const req = data.requests.find((r) => r.id === id);
  if (!req) return { error: 'Request not found' };
  if (req.status !== 'pending') return { error: 'Request already reviewed' };

  const apiKey = generateApiKey();
  req.status = 'approved';
  req.apiKey = apiKey;
  req.reviewedAt = new Date().toISOString();
  writeJson(REQUESTS_PATH, data);

  const usersData = readJson(USERS_PATH, { users: [] });
  usersData.users.push({
    apiKey,
    plan: 'standard',
    dailyScanLimit: 200,
    name: req.name,
    email: req.email
  });
  writeJson(USERS_PATH, usersData);

  return { request: req, apiKey };
}

export function rejectRequest(id, reason = '') {
  const data = readJson(REQUESTS_PATH, { requests: [] });
  const req = data.requests.find((r) => r.id === id);
  if (!req) return { error: 'Request not found' };
  if (req.status !== 'pending') return { error: 'Request already reviewed' };

  req.status = 'rejected';
  req.reviewedAt = new Date().toISOString();
  req.rejectReason = reason;
  writeJson(REQUESTS_PATH, data);
  return { request: req };
}
