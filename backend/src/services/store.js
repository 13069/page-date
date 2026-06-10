import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERS_PATH = path.join(__dirname, '../../data/users.json');
const USAGE_PATH = path.join(__dirname, '../../data/usage.json');

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

function loadUsersFromEnv() {
  if (process.env.USERS_JSON) {
    try {
      const parsed = JSON.parse(process.env.USERS_JSON);
      const list = Array.isArray(parsed) ? parsed : parsed.users;
      if (Array.isArray(list) && list.length) return list;
    } catch (e) {
      console.error('USERS_JSON parse error:', e.message);
    }
  }

  if (process.env.API_KEY?.trim()) {
    return [{
      apiKey: process.env.API_KEY.trim(),
      plan: 'standard',
      dailyScanLimit: Number(process.env.DAILY_SCAN_LIMIT) || 200,
      name: process.env.API_KEY_NAME || 'Admin',
      email: process.env.API_KEY_EMAIL || ''
    }];
  }

  return null;
}

function loadUsers() {
  const fromEnv = loadUsersFromEnv();
  if (fromEnv) return fromEnv;
  const { users = [] } = readJson(USERS_PATH, { users: [] });
  return users;
}

let usersCache = loadUsers();

export function reloadUsers() {
  usersCache = loadUsers();
  return usersCache;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function getUserByApiKey(apiKey) {
  return usersCache.find((u) => u.apiKey === apiKey) || null;
}

export function getUsage(apiKey) {
  const usage = readJson(USAGE_PATH, {});
  const day = todayKey();
  return usage[apiKey]?.[day] || { scans: 0 };
}

export function incrementUsage(apiKey) {
  const usage = readJson(USAGE_PATH, {});
  const day = todayKey();
  if (!usage[apiKey]) usage[apiKey] = {};
  if (!usage[apiKey][day]) usage[apiKey][day] = { scans: 0 };
  usage[apiKey][day].scans += 1;
  writeJson(USAGE_PATH, usage);
  return usage[apiKey][day];
}

export function getQuota(apiKey) {
  const user = getUserByApiKey(apiKey);
  if (!user) return null;
  const used = getUsage(apiKey);
  return {
    name: user.name,
    dailyScanLimit: user.dailyScanLimit,
    scansUsed: used.scans,
    scansRemaining: Math.max(0, user.dailyScanLimit - used.scans)
  };
}

export function resetUsage(apiKey) {
  const usage = readJson(USAGE_PATH, {});
  const day = todayKey();
  if (usage[apiKey]?.[day]) {
    usage[apiKey][day] = { scans: 0 };
    writeJson(USAGE_PATH, usage);
  }
}
