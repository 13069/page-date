# PageDate — free deployment (≤100 users)

## Short answer

| Part | Best free choice | Why |
|------|------------------|-----|
| Landing, privacy, terms | **Vercel** or Hostinger static | Free, fast, zero server |
| Registration form | **Formspree** or **Web3Forms** | Emails you directly — no admin server |
| Scan API | **Render** or **Fly.io** | Runs your Express app as-is |
| **Not recommended** | Vercel for the whole API | 10s timeout, no persistent disk, big refactor |

**Vercel alone** is great for the marketing site. Your `/scan` endpoint (HTML parsing, image probes, 4–15s) is a poor fit for Vercel serverless without rewriting everything + adding a database.

---

## Recommended free stack (minimal work)

```
Users → Chrome extension → Render API (/scan)
Users → Landing page (GitHub Pages or Vercel) → Formspree → your email inbox
You   → Reply with API key manually
```

### GitHub Pages (free, same as Vercel for static site)

1. Push repo to GitHub
2. **Settings → Pages → Source: GitHub Actions**
3. Workflow in `.github/workflows/pages.yml` deploys `backend/public/`
4. URL: `https://YOUR_USERNAME.github.io/PageDate/`

Use **Formspree** for the signup form on Pages (static host has no `/api/register`).

See [OPEN_SOURCE.md](OPEN_SOURCE.md) for the full open-source checklist.

### Alternative stack (Vercel landing)

### 1. Landing on Vercel (free)

```bash
cd backend/public
npx vercel
```

Point domain later in Vercel dashboard.  
Use these URLs in Chrome Web Store:
- Homepage: `https://your-project.vercel.app`
- Privacy: `https://your-project.vercel.app/privacy.html`

### 2. Registration form → your inbox (free, no server)

**Formspree** (free ~50 submissions/month): https://formspree.io

Replace the form in `index.html`:

```html
<form action="https://formspree.io/f/YOUR_FORM_ID" method="POST">
  <input name="name" required>
  <input name="email" type="email" required>
  <input name="website">
  <textarea name="useCase"></textarea>
  <button type="submit">Submit request</button>
</form>
```

You get an email per request → reply with an API key you generate locally.

**Web3Forms** — free ~250/month, same idea: https://web3forms.com

No admin panel hosted. No database. Perfect for “see form, send mail manually.”

### 3. Scan API on Render (free tier)

1. Push repo to GitHub.
2. https://render.com → New **Web Service** → connect repo.
3. Settings:
   - **Root directory:** `backend`
   - **Build:** `npm install`
   - **Start:** `npm start`
   - **Environment:** `ADMIN_PASSWORD=...` (only if you use hosted admin; optional)
4. Free tier sleeps after ~15 min idle (first request may take 30s to wake).

Extension popup **Backend URL:** `https://your-app.onrender.com`

**Note:** Render free disk is **ephemeral** — `usage.json` resets on redeploy. For 100 users that’s usually fine at first. Back up `data/users.json` in git (without real keys) or copy manually.

### 4. Create API keys locally

When someone emails you (or Formspree notifies you):

```bash
cd backend
node -e "
import fs from 'fs';
const key = 'pagedate_sk_live_' + require('crypto').randomBytes(12).toString('hex');
const data = JSON.parse(fs.readFileSync('data/users.json','utf8'));
data.users.push({ apiKey: key, plan: 'standard', dailyScanLimit: 200, name: 'User Name', email: 'user@mail.com' });
fs.writeFileSync('data/users.json', JSON.stringify(data, null, 2));
console.log('Send this key:', key);
"
```

Redeploy Render (or edit `users.json` on server if you SSH). Easier: keep one `users.json` in repo and redeploy when you add keys — crude but works for 100 users.

Or run **admin locally** against production:

```bash
# Local machine only
ADMIN_PASSWORD=secret npm start
# Open http://localhost:3847/admin — but that only affects LOCAL data
```

For production keys, add users on Render via dashboard shell or redeploy with updated `users.json`.

---

## Alternative: everything local + tunnel (dev / friends only)

Not for 100 public users:

```bash
cd backend && npm start
cloudflared tunnel --url http://localhost:3847
```

Extension uses tunnel URL. Forms use local `/api/register` + local admin. **Your PC must stay on.**

---

## When you outgrow free

| Upgrade | When |
|---------|------|
| Render paid ($7/mo) | No sleep, persistent disk |
| Supabase free Postgres | Stable users + usage + requests |
| Resend free email | Auto-send API keys on approve |
| Hostinger VPS | Full control, local JSON forever |

---

## Chrome Web Store (free setup)

- **Privacy URL:** Vercel `/privacy.html`
- **Homepage:** Vercel `/`
- **Author:** [LinkedIn](https://www.linkedin.com/in/l3069)
- See `CHROME_STORE.md`

---

## What to skip for now

- Hostinger VPS (overkill until paid customers)
- Vercel for `/scan` API (timeouts + rewrite)
- Automated email / Stripe / multi-tenant admin
- Hostinger shared PHP (no Node)

**Best free combo today:** Vercel (site) + Formspree (forms) + Render (API) + manual API keys by email.
