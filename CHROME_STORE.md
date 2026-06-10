# Chrome Web Store submission checklist

## Developer info
- **Author:** Leo — [LinkedIn](https://www.linkedin.com/in/l3069)
- **Privacy policy:** `https://YOUR_API_DOMAIN/privacy` (host the backend landing page)
- **Homepage:** `https://YOUR_API_DOMAIN/` (set in Chrome Web Store dashboard)

## Single purpose description
PageDate detects and displays publish/creation dates on web pages and individual page elements (images, posts, ads, text).

## Permission justification
| Permission | Why |
|--------------|-----|
| `storage` | Save settings and API key |
| `activeTab` | Read current tab for scan |
| `<all_urls>` | Analyze dates on any page user visits |
| `archive.org` | Wayback Machine availability check |
| API host | Send page HTML for date analysis (optional, user-configured) |

## Data handling (declare in CWS form)
- Page HTML may be sent to user's configured API server for analysis
- No data sold to third parties
- API key stored in Chrome sync storage

## Before upload
1. Deploy API + landing + privacy pages (see DEPLOY.md)
2. Replace `localhost:3847` links in popup with production URL
3. Remove or hide default API key from extension for public release
4. Test on HTTP and HTTPS pages
5. Zip extension folder (exclude backend/node_modules)

## Screenshots needed
- Inspector widget on a news page
- Badges on images/ads
- Popup settings
- Click inspect mode
