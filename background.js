const DEFAULT_SETTINGS = {
  enabled: true,
  clickMode: false,
  showPageDate: true,
  analyzeImages: true,
  analyzePosts: true,
  analyzeText: true,
  analyzeContainers: true,
  apiKey: '',
  apiUrl: 'https://page-date.onrender.com'
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    if (stored.hoverMode !== undefined) merged.clickMode = stored.hoverMode;
    delete merged.hoverMode;
    delete merged.deepAnalysis;
    delete merged.colorCoding;
    chrome.storage.sync.set(merged);
  });
});

function normalizeSettings(stored = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    apiKey: (stored.apiKey || '').trim(),
    apiUrl: (stored.apiUrl || DEFAULT_SETTINGS.apiUrl).trim().replace(/\/$/, '')
  };
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return normalizeSettings(stored);
}

async function apiRequest(path, { apiKey, apiUrl, method = 'GET', body } = {}) {
  const base = (apiUrl || DEFAULT_SETTINGS.apiUrl).replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: body ? JSON.stringify(body) : undefined,
    signal: controller.signal
  });
  clearTimeout(timer);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_SETTINGS') {
    chrome.storage.sync.get(DEFAULT_SETTINGS, sendResponse);
    return true;
  }

  if (message.type === 'SET_SETTINGS') {
    chrome.storage.sync.set(message.settings, () => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'API_SCAN' || message.type === 'DEEP_SCAN' || message.type === 'INSPECT_ELEMENT') {
    (async () => {
      try {
        const settings = await loadSettings();
        if (!settings.apiKey) {
          sendResponse({ ok: false, error: 'API key required' });
          return;
        }
        const payload = message.payload || {};
        const result = await apiRequest('/scan', {
          apiKey: settings.apiKey,
          apiUrl: settings.apiUrl,
          method: 'POST',
          body: payload
        });
        sendResponse({ ok: true, data: result });
      } catch (err) {
        sendResponse({ ok: false, error: err.message, status: err.status, data: err.data });
      }
    })();
    return true;
  }

  if (message.type === 'GET_QUOTA') {
    (async () => {
      try {
        const settings = await loadSettings();
        if (!settings.apiKey) {
          sendResponse({ ok: false, error: 'API key required' });
          return;
        }
        const quota = await apiRequest('/usage', {
          apiKey: settings.apiKey,
          apiUrl: settings.apiUrl
        });
        sendResponse({ ok: true, quota });
      } catch (err) {
        sendResponse({ ok: false, error: err.message, data: err.data });
      }
    })();
    return true;
  }

  if (message.type === 'PROBE_IMAGES') {
    (async () => {
      const { urls = [], referer = '' } = message;
      const out = [];
      for (const url of urls.slice(0, 25)) {
        try {
          const res = await fetch(url, {
            method: 'HEAD',
            headers: { Referer: referer, Accept: 'image/*,*/*' },
            redirect: 'follow'
          });
          const lm = res.headers.get('last-modified');
          if (lm) {
            const d = new Date(lm);
            const y = d.getFullYear();
            const now = new Date();
            if (!isNaN(d.getTime()) && y >= 1990 && y <= now.getFullYear() + 1 && d <= new Date(now.getTime() + 172800000)) {
              out.push({
                date: d.toISOString(),
                source: 'inferred',
                confidence: 0.7,
                method: 'tier5',
                inferred: true,
                elementType: 'image',
                src: url,
                from: 'Last-Modified (browser)'
              });
            }
          }
        } catch { /* skip */ }
      }
      sendResponse({ ok: true, elements: out });
    })();
    return true;
  }

  if (message.type === 'WAYBACK_CHECK') {
    (async () => {
      try {
        const pageUrl = message.url;
        if (!pageUrl) {
          sendResponse({ ok: false, error: 'url required' });
          return;
        }
        const { origin, hostname } = new URL(pageUrl);
        const candidates = [pageUrl, `${origin}/`, hostname];

        for (const target of candidates) {
          const res = await fetch(
            `https://archive.org/wayback/available?url=${encodeURIComponent(target)}`,
            { headers: { Accept: 'application/json' } }
          );
          if (!res.ok) continue;
          const data = await res.json();
          const snap = data?.archived_snapshots?.closest;
          if (snap?.available && snap.url && snap.timestamp) {
            sendResponse({
              ok: true,
              data: {
                available: true,
                url: snap.url,
                timestamp: snap.timestamp,
                status: snap.status,
                checkedUrl: target
              }
            });
            return;
          }
        }
        sendResponse({ ok: true, data: { available: false } });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'FETCH_URL') {
    (async () => {
      try {
        const settings = await loadSettings();
        if (!settings.apiKey) {
          sendResponse({ ok: false, error: 'API key required' });
          return;
        }
        const result = await apiRequest('/scan', {
          apiKey: settings.apiKey,
          apiUrl: settings.apiUrl,
          method: 'POST',
          body: { url: message.pageUrl, mode: 'fetch-url', linkUrl: message.linkUrl }
        });
        sendResponse({ ok: true, data: result });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'RESET_QUOTA') {
    (async () => {
      try {
        const settings = await loadSettings();
        if (!settings.apiKey) {
          sendResponse({ ok: false, error: 'API key required' });
          return;
        }
        await apiRequest('/reset-usage', {
          apiKey: settings.apiKey,
          apiUrl: settings.apiUrl,
          method: 'POST',
          body: {}
        });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_CHANGED' }).catch(() => {});
      }
    }
  });
});
