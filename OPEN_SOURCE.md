# Open source

PageDate is open source under the [MIT License](LICENSE).

## Can I publish this on GitHub?

**Yes.** Push the repo to GitHub and share the link. Others can:

- Load the extension unpacked for personal use
- Self-host the API (`backend/`)
- Contribute fixes and features

## What to host where

| Part | GitHub Pages | GitHub repo only |
|------|--------------|------------------|
| Landing, privacy, terms | ✅ Yes (static) | Source in `backend/public/` |
| Scan API (`/scan`) | ❌ No | Run on Render/Fly/local |
| Registration form → your email | Use Formspree on Pages | Or `/api/register` when API runs |

GitHub Pages serves **static files only** — no Node.js, no Express.

## Before you push — secrets checklist

Do **not** commit:

- `backend/data/users.json` (real API keys) — use `users.json.example` instead
- `backend/data/usage.json` (already gitignored)
- Personal `ADMIN_PASSWORD`

After cloning, copy:

```bash
cp backend/data/users.json.example backend/data/users.json
# Edit and set your own apiKey
```

The extension default key in `content.js` / `popup` should be **your public demo key** or empty — rotate any key that was ever shared.

## GitHub Pages setup

1. Push repo to GitHub
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**
3. Push to `main` — workflow deploys `backend/public/`
4. Site: `https://YOUR_USERNAME.github.io/PageDate/`

On GitHub Pages, switch the registration form to **Formspree** (see [DEPLOY_FREE.md](DEPLOY_FREE.md)) because `/api/register` won't exist on static hosting.

## Chrome Web Store vs open source

You can do **both**:

- **Open source** on GitHub (MIT) — code is public
- **Chrome Web Store** — users install the packaged extension

Google does not require closed source. Link to your GitHub repo in the store listing for credibility.

## Author

[Leo — LinkedIn](https://www.linkedin.com/in/l3069)
