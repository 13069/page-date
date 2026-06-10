# Render free tier — no Shell needed

Render **Shell is paid**. Use **Environment Variables** in the dashboard instead.

Your API: **https://page-date.onrender.com**

---

## Step 1 — One API key (you only)

Render dashboard → **page-date** → **Environment** → Add:

| Key | Value |
|-----|--------|
| `API_KEY` | `pagedate_sk_live_mysecretkey123456` |
| `ADMIN_PASSWORD` | your strong password |

Click **Save Changes** → wait for redeploy (~1 min).

Test:

```bash
curl -H "x-api-key: pagedate_sk_live_mysecretkey123456" https://page-date.onrender.com/usage
```

---

## Step 2 — Extension

Popup settings:

- **Backend URL:** `https://page-date.onrender.com`
- **API Key:** same as `API_KEY` above

---

## Step 3 — Multiple users (when Formspree sends requests)

On your computer:

```bash
cd backend
node scripts/add-user.js "Jane Doe" "jane@example.com"
node scripts/render-env.js
```

Copy the **USERS_JSON** one-liner from the output.

Render → **Environment**:

| Key | Value |
|-----|--------|
| `USERS_JSON` | paste the JSON one-liner |

Remove `API_KEY` if you use `USERS_JSON` (env users take priority).

**Save** → redeploy → email Jane her key.

Repeat `add-user` + update `USERS_JSON` for each new user.

---

## Admin panel

https://page-date.onrender.com/admin

Password = `ADMIN_PASSWORD` from Environment.

---

## Notes

- **Usage resets** on redeploy (free ephemeral disk) — acceptable for early users
- **Cold start:** first request after ~15 min idle may take 30–60s
- **GitHub Pages** stays separate: https://13069.github.io/page-date/
