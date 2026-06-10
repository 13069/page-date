#!/usr/bin/env node
/**
 * Add a new API user locally. After adding, redeploy Render or copy users.json to server.
 * Usage: node scripts/add-user.js "Jane Doe" "jane@example.com"
 */
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERS_PATH = path.join(__dirname, '../data/users.json');

const [name, email] = process.argv.slice(2);
if (!name || !email) {
  console.error('Usage: node scripts/add-user.js "Full Name" "email@example.com"');
  process.exit(1);
}

const apiKey = `pagedate_sk_live_${crypto.randomBytes(12).toString('hex')}`;

let data = { users: [] };
if (fs.existsSync(USERS_PATH)) {
  data = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
}

data.users.push({
  apiKey,
  plan: 'standard',
  dailyScanLimit: 200,
  name,
  email
});

fs.writeFileSync(USERS_PATH, JSON.stringify(data, null, 2));
console.log('\n✅ User added to data/users.json\n');
console.log('Email:', email);
console.log('API key (send this to the user):\n');
console.log(apiKey);
console.log('\nNext — update Render (no Shell needed):');
console.log('  Run: node scripts/render-env-help.js');
console.log('  Copy USERS_JSON into Render → Environment → Save\n');
