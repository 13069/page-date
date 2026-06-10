# PageDate

Detect publish dates on any webpage — images, posts, ads, articles — with a Chrome extension and optional Node.js API.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Author:** [Leo](https://www.linkedin.com/in/l3069)

## Features

- Inspector widget with page date, scan progress, Wayback link
- Badges on dated elements (scroll-aware, progressive scan)
- Multilingual dates (English, Macedonian/Cyrillic, relative “today/денес”)
- Click-to-inspect any element
- Export JSON / CSV / timeline report
- Backend: WordPress, Shopify, JSON-LD, image Last-Modified probes

## Quick start

### Extension (local)

1. `chrome://extensions/` → Developer mode → **Load unpacked** → this folder
2. Start API (optional but recommended):

```bash
cd backend
cp data/users.json.example data/users.json   # first time only
npm install && npm start
```

3. Extension popup → Backend URL `http://localhost:3847` → your API key from `users.json`

### Self-hosted API

See **[SETUP_FREE.md](SETUP_FREE.md)** for the full step-by-step guide (GitHub Pages + Formspree + Render).

See [DEPLOY_FREE.md](DEPLOY_FREE.md) (Render + Vercel/Formspree) or [DEPLOY.md](DEPLOY.md) (VPS).

## Hosting cheat sheet

| What | GitHub Pages | Render | Vercel |
|------|--------------|--------|--------|
| Landing / privacy | ✅ Free | — | ✅ Free |
| Scan API | ❌ | ✅ Free tier | ❌ (serverless limits) |

Details: [OPEN_SOURCE.md](OPEN_SOURCE.md) · [DEPLOY_FREE.md](DEPLOY_FREE.md)

## Project layout

```
page-date/
├── manifest.json      Chrome extension (MV3)
├── content.js         UI, scan orchestration
├── extractor.js       DOM tagging
├── detector.js        Local page-date tiers
├── background.js      API bridge
├── backend/           Node.js API + landing static files
│   └── public/        Deploy this folder to GitHub Pages / Vercel
└── LICENSE            MIT
```

## API

```bash
curl -X POST http://localhost:3847/scan \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{"url":"https://example.com","html":"<body>...</body>","mode":"deep","refs":[]}'
```

## Chrome Web Store

See [CHROME_STORE.md](CHROME_STORE.md).

## License

MIT — see [LICENSE](LICENSE). You may use, modify, and distribute with attribution.
