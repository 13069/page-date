#!/usr/bin/env node
/**
 * Print Render environment variable values from local users.json
 * Usage: node scripts/render-env-help.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERS_PATH = path.join(__dirname, '../data/users.json');

if (!fs.existsSync(USERS_PATH)) {
  console.error('Missing data/users.json — copy from users.json.example first');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));

console.log('\n=== Render Environment (free — no Shell needed) ===\n');
console.log('Option A — single key (easiest):\n');
console.log('  Key: API_KEY');
console.log('  Value:', data.users[0]?.apiKey || 'pagedate_sk_live_YOUR_KEY');
console.log('\nOption B — multiple users:\n');
console.log('  Key: USERS_JSON');
console.log('  Value (paste as one line):\n');
console.log(JSON.stringify({ users: data.users }));
console.log('\nAlso set:\n');
console.log('  Key: ADMIN_PASSWORD');
console.log('  Value: your-strong-password');
console.log('\nAfter Save → Render redeploys automatically.\n');
