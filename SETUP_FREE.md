# PageDate — complete free setup (from zero)

Everything you need: **GitHub** (code + website) + **Formspree** (form emails) + **Render** (API) + **Chrome extension**.

Total cost: **$0** for ~100 users.

---

## What you will have at the end

| Piece | URL / location |
|-------|----------------|
| Landing + privacy + terms | `https://YOUR_USERNAME.github.io/PageDate/` |
| API | `https://pagedate-api.onrender.com` (your name may differ) |
| Form requests | Your email inbox (via Formspree) |
| Extension | Loaded in Chrome + later Chrome Web Store |

---

## Part 0 — Prerequisites

Create free accounts (use the same email if you like):

1. **GitHub** — https://github.com/signup  
2. **Formspree** — https://formspree.io/register  
3. **Render** — https://dashboard.render.com/register  

On your computer:

- **Git** installed (`git --version`)
- **Node.js 18+** (`node --version`) — for local testing only
- **Google Chrome**

Your project folder: `/home/leo/Projects/page-date` (or wherever you cloned it).

---

## Part 1 — Test locally (10 minutes)

### 1.1 Backend

```bash
cd /home/leo/Projects/page-date/backend
cp data/users.json.example data/users.json
```

Edit `data/users.json` — replace `CHANGE_ME` with a real key, e.g.:

```json
"apiKey": "pagedate_sk_live_mysecretkey123456"
```

```bash
npm install
npm start
```

Open http://localhost:3847/health — should show `{"status":"ok",...}`.

### 1.2 Extension

1. Chrome → `chrome://extensions/`
2. Turn on **Developer mode**
3. **Load unpacked** → select the `page-date` folder (parent of `backend/`, where `manifest.json` is)
4. Click extension icon → set:
   - **Backend URL:** `http://localhost:3847`
   - **API Key:** same key from `users.json`
5. Visit any news site — PageDate chip should appear top-right

If it works locally, continue.

---

## Part 2 — Formspree (form → your email)

### 2.1 Create form

1. Log in to https://formspree.io  
2. **+ New form**  
3. Name it `PageDate API requests`  
4. Copy the **form ID** from the URL:  
   `https://formspree.io/f/abcxyzde` → ID is `abcxyzde`

### 2.2 Put ID in project

Edit `backend/public/js/config.js`:

```javascript
window.PAGEDATE_CONFIG = {
  FORMSPREE_ID: 'abcxyzde'   // your real ID
};
```

### 2.3 Test form locally

Open `backend/public/index.html` in browser (double-click file), submit the form — check your email.

---

## Part 3 — GitHub (code + website)

### 3.1 Create repository

1. GitHub → **New repository**  
2. Name: `PageDate` (or `page-date`)  
3. Public  
4. Do **not** add README (you already have one)

### 3.2 Push code

```bash
cd /home/leo/Projects/page-date

git init
git add .
git commit -m "PageDate open source release"

git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/PageDate.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

**Note:** `data/users.json` is gitignored (secrets). Never commit real API keys.

### 3.3 Enable GitHub Pages

1. Repo → **Settings** → **Pages**  
2. **Build and deployment** → Source: **GitHub Actions**  
3. Push to `main` (already done) — workflow `.github/workflows/pages.yml` runs automatically  
4. **Actions** tab → wait for green checkmark  
5. **Pages** settings shows URL, e.g.  
   `https://YOUR_USERNAME.github.io/PageDate/`

### 3.4 Verify website

Open:

- `https://YOUR_USERNAME.github.io/PageDate/` — landing  
- `https://YOUR_USERNAME.github.io/PageDate/privacy.html` — privacy  
- `https://YOUR_USERNAME.github.io/PageDate/terms.html` — terms  

Submit the form — you should get a Formspree email.

---

## Part 4 — Render (free API)

### 4.1 Create web service

1. https://dashboard.render.com → **New +** → **Web Service**  
2. Connect your **GitHub** account  
3. Select the **PageDate** repository  
4. Settings:

| Field | Value |
|-------|--------|
| Name | `pagedate-api` |
| Region | closest to you |
| Root directory | `backend` |
| Runtime | Node |
| Build command | `npm install` |
| Start command | `npm start` |
| Plan | **Free** |

5. **Create Web Service** — wait for first deploy (~3–5 min)

Your API URL: `https://pagedate-api.onrender.com` (or similar)

Test: `https://pagedate-api.onrender.com/health`

### 4.2 Add API users on Render

The server needs `data/users.json`. Free Render has no persistent disk across redeploys the way a VPS does, but the file survives normal restarts until you redeploy.

**First deploy:** `prestart` copies `users.json.example` → create your real file via Render Shell:

1. Render dashboard → your service → **Shell**  
2. Run:

```bash
cd /opt/render/project/src/backend/data
cat users.json
```

If it only has `CHANGE_ME`, edit it:

```bash
nano users.json
```

Paste (use your own key):

```json
{
  "users": [
    {
      "apiKey": "pagedate_sk_live_mysecretkey123456",
      "plan": "standard",
      "dailyScanLimit": 200,
      "name": "Leo (admin)",
      "email": "your@email.com"
    }
  ]
}
```

Save. Restart service: **Manual Deploy** → **Clear build cache & deploy** only when you change users.

**Easier long-term:** each time you add a user locally, paste the same JSON block into Render Shell (or redeploy with a private fork that includes users.json — not recommended for public repos).

### 4.3 Add new users when Formspree emails you

On **your computer**:

```bash
cd backend
node scripts/add-user.js "Jane Doe" "jane@example.com"
```

Copy the printed API key → email it to Jane.

Then update Render’s `users.json` (Shell → add the new user object to the `users` array) and restart, **or** keep one master file and update Shell when needed.

For ~100 users, updating `users.json` in Render Shell once per approval is fine.

### 4.4 Render free tier notes

- Service **sleeps** after ~15 minutes idle  
- First request after sleep may take **30–60 seconds** (cold start)  
- Fine for early users; upgrade to $7/mo later for always-on  

---

## Part 5 — Point extension to production

### 5.1 Default URL in extension (optional, for distribution)

Edit `content.js` and `popup.html` default API URL from `localhost` to Render:

```
https://pagedate-api.onrender.com
```

Search for `localhost:3847` in the project and replace.

### 5.2 Each user configures

In extension popup:

- **Backend URL:** `https://pagedate-api.onrender.com`  
- **API Key:** key you emailed them  

---

## Part 6 — Daily workflow (you as admin)

1. User submits form on GitHub Pages  
2. **Formspree** emails you their name, email, use case  
3. You decide yes/no  
4. If yes:

```bash
cd backend
node scripts/add-user.js "Their Name" "their@email.com"
```

5. Email them the API key + link to install extension  
6. Update Render `users.json` with the new user (Shell)  
7. Done  

---

## Part 7 — Chrome Web Store (when ready)

1. Zip extension folder (no `backend/node_modules`):

```bash
cd /home/leo/Projects/page-date
zip -r pagedate-extension.zip manifest.json content.js background.js detector.js extractor.js popup.html popup.js popup.css styles.css icons/
```

2. https://chrome.google.com/webstore/devconsole — one-time $5 developer fee  
3. **New item** → upload zip  
4. Required URLs:
   - **Privacy policy:** `https://YOUR_USERNAME.github.io/PageDate/privacy.html`  
   - **Homepage:** `https://YOUR_USERNAME.github.io/PageDate/`  
5. Explain permissions: reads page HTML to detect dates; sends to your API when key configured  
6. See `CHROME_STORE.md` for full checklist  

---

## Part 8 — Open source

Repo is MIT licensed. Others can self-host. Your Render API URL + keys stay under your control.

Link GitHub in store listing: `https://github.com/YOUR_USERNAME/PageDate`

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Form does nothing | Set `FORMSPREE_ID` in `js/config.js`, push to GitHub |
| API "Server unreachable" | Check Render URL, wait for cold start, verify `/health` |
| 403 Invalid API key | User not in Render `users.json` |
| 429 Daily limit | Normal — 200 scans/day per key; reset in popup or `usage.json` on server |
| GitHub Pages 404 | Enable Pages → GitHub Actions; check Actions tab for errors |
| CSS broken on Pages | Use relative links (`css/site.css`) — already fixed |

---

## Quick reference

```bash
# Local API
cd backend && npm start

# Add user
node scripts/add-user.js "Name" "email@example.com"

# Push website changes
git add backend/public && git commit -m "Update site" && git push
```

**Your links (fill in):**

- GitHub Pages: `https://_____________.github.io/PageDate/`  
- Render API: `https://_____________.onrender.com`  
- Formspree form: `https://formspree.io/f/_____________`  
- LinkedIn (author): https://www.linkedin.com/in/l3069  

---

## When you outgrow free

| Upgrade | Cost | Why |
|---------|------|-----|
| Render Starter | ~$7/mo | No sleep, faster |
| Formspree paid | if >50 forms/mo | More submissions |
| Custom domain on Pages | free | `pagedate.yourdomain.com` |
| Supabase | free tier | Real database for users |

You’re done. Start with Part 1 and go in order.
