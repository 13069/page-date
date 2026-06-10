# Deploying PageDate API on Hostinger

PageDate needs **Node.js** (v18+). Shared PHP hosting cannot run this API directly — use one of these options:

## Option A: Hostinger VPS (recommended)

1. Create a VPS on Hostinger (Ubuntu 22.04).
2. SSH in and install Node.js:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs git
   ```
3. Upload the `backend/` folder (git clone or SFTP).
4. Configure environment:
   ```bash
   cd backend
   npm install
   export ADMIN_PASSWORD="your-strong-password"
   export PORT=3847
   ```
5. Run with PM2 (keeps it alive):
   ```bash
   sudo npm install -g pm2
   pm2 start src/server.js --name pagedate-api
   pm2 save && pm2 startup
   ```
6. Point a subdomain (e.g. `api.yourdomain.com`) to the VPS IP.
7. Install Nginx reverse proxy + free SSL (Let's Encrypt):
   ```nginx
   server {
     listen 443 ssl;
     server_name api.yourdomain.com;
     location / {
       proxy_pass http://127.0.0.1:3847;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
     }
   }
   ```

## Option B: Hostinger + separate Node host

- Host **landing page only** on Hostinger (static files from `backend/public/`).
- Run the API on Railway, Render, Fly.io, or a VPS.
- Update extension default `apiUrl` to your API domain.

## After deploy

1. Set `ADMIN_PASSWORD` — never use the default.
2. Visit `https://api.yourdomain.com/` — landing page.
3. Visit `https://api.yourdomain.com/admin` — review API requests.
4. In Chrome extension popup, set **API URL** to `https://api.yourdomain.com`.
5. Approve users in admin → copy API key → email them manually.

## Google Chrome Web Store

- **Privacy policy URL:** `https://api.yourdomain.com/privacy`
- **Homepage URL:** `https://api.yourdomain.com/`
- **Single purpose:** Detect and display publish dates on web pages.
- Explain in listing that optional API sends page HTML for analysis.

## Files served

| URL | Purpose |
|-----|---------|
| `/` | Landing + API signup |
| `/privacy` | Privacy policy (required by Google) |
| `/terms` | Terms of service |
| `/admin` | Admin panel for API approvals |
| `/scan` | Extension API |
| `/health` | Health check |

## Author

[Leo — LinkedIn](https://www.linkedin.com/in/l3069)
