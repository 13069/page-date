/* PageDate — Layered Forensic Metadata Resolver */
(() => {
  'use strict';

  const NETWORK_MIN_INTERVAL_MS = 2000;
  const NETWORK_MAX_REQUESTS = 3;

  let networkRequestCount = 0;
  let lastNetworkRequest = 0;

  // ─── Result factory ──────────────────────────────────────────────────────

  function makeResult(date, source, confidence, method, extra = {}) {
    const inferred = method === 'tier4' || method === 'tier5' || source === 'inferred';
    return {
      date,
      source,
      confidence: Math.round(Math.min(1, Math.max(0, confidence)) * 100) / 100,
      method,
      inferred,
      ...extra
    };
  }

  function pickBest(results) {
    if (!results?.length) return null;
    return [...results].sort((a, b) => {
      const tierOrder = { tier1: 5, tier2: 4, tier3: 3, tier4: 2, tier5: 1 };
      const tierDiff = (tierOrder[b.method] || 0) - (tierOrder[a.method] || 0);
      if (tierDiff !== 0) return tierDiff;
      return b.confidence - a.confidence || b.date - a.date;
    })[0];
  }

  function parseDate(str) {
    if (!str || typeof str !== 'string') return null;
    const trimmed = str.trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
      return false;
    }
    return true;
  }

  function isInViewport(el) {
    const rect = el.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight &&
      rect.right > 0 && rect.left < window.innerWidth;
  }

  function getContainer(el) {
    const selectors = [
      'article', '[role="article"]', '.post', '.card', '.entry',
      '.blog-post', '.listing', '.product-card', '.product',
      '[class*="post-"]', '[class*="article"]', '[class*="card"]',
      'li', 'figure'
    ];
    let node = el;
    for (let i = 0; i < 6 && node && node !== document.body; i++) {
      if (selectors.some((sel) => {
        try { return node.matches(sel); } catch { return false; }
      })) return node;
      node = node.parentElement;
    }
    return el;
  }

  function spatialWeight(el) {
    let boost = 0;
    const zones = [
      'header', '[role="banner"]', 'main', 'article', '.entry-header',
      '.post-header', '.byline', '.meta', '.author', '[class*="meta"]',
      'h1', 'h2', 'h3'
    ];
    let node = el;
    for (let i = 0; i < 8 && node; i++) {
      if (zones.some((sel) => {
        try { return node.matches?.(sel); } catch { return false; }
      })) {
        boost += 0.08 * (8 - i);
      }
      node = node.parentElement;
    }
    const text = (el.textContent || '').toLowerCase();
    const contextWords = ['posted', 'published', 'updated', 'author', 'ago', 'written'];
    if (contextWords.some((w) => text.includes(w))) boost += 0.06;
    return Math.min(0.25, boost);
  }

  async function throttledFetch(url, options = {}) {
    if (networkRequestCount >= NETWORK_MAX_REQUESTS) return null;
    const now = Date.now();
    const wait = NETWORK_MIN_INTERVAL_MS - (now - lastNetworkRequest);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (!url.startsWith(location.origin)) return null;

    try {
      lastNetworkRequest = Date.now();
      networkRequestCount++;
      const res = await fetch(url, { credentials: 'same-origin', ...options });
      if (!res.ok) return null;
      return res;
    } catch {
      return null;
    }
  }

  function resetNetworkBudget() {
    networkRequestCount = 0;
    lastNetworkRequest = 0;
  }

  // ─── CMS Detection ───────────────────────────────────────────────────────

  function detectCMS() {
    const gen = document.querySelector('meta[name="generator"]')?.content?.toLowerCase() || '';
    const bodyClass = document.body?.className || '';

    if (gen.includes('wordpress') || document.querySelector('link[href*="/wp-json/"]') || /postid-\d+/.test(bodyClass)) {
      return 'WordPress';
    }
    if (document.querySelector('link[href*="cdn.shopify.com"]') || window.Shopify) return 'Shopify';
    if (document.querySelector('.elementor') || gen.includes('elementor')) return 'Elementor';
    if (document.querySelector('html[data-wf-site]') || document.querySelector('.w-webflow-badge')) return 'Webflow';
    if (gen.includes('wix')) return 'Wix';
    if (gen.includes('squarespace')) return 'Squarespace';
    if (gen.includes('ghost')) return 'Ghost';
    return null;
  }

  function getWordPressPostId() {
    const bodyMatch = document.body?.className.match(/postid-(\d+)/);
    if (bodyMatch) return bodyMatch[1];
    const el = document.querySelector('[class*="post-"]');
    const cls = el?.className?.match(/\bpost-(\d+)\b/);
    return cls?.[1] || null;
  }

  // ─── Tier 1: Structured Metadata (0.8 – 1.0) ───────────────────────────

  function tier1Scan() {
    const results = [];

    const metaSpecs = [
      ['meta[property="article:published_time"]', 'content', 'meta', 0.98],
      ['meta[property="og:published_time"]', 'content', 'meta', 0.95],
      ['meta[name="pubdate"]', 'content', 'meta', 0.94],
      ['meta[name="publish-date"]', 'content', 'meta', 0.92],
      ['meta[name="date"]', 'content', 'meta', 0.88],
      ['meta[property="og:updated_time"]', 'content', 'meta', 0.85],
      ['meta[property="article:modified_time"]', 'content', 'meta', 0.82],
      ['meta[name="DC.date.issued"]', 'content', 'meta', 0.9],
      ['meta[name="parsely-pub-date"]', 'content', 'meta', 0.93]
    ];

    for (const [sel, attr, source, conf] of metaSpecs) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const d = parseDate(el.getAttribute(attr));
      if (d) results.push(makeResult(d, source, conf, 'tier1'));
    }

    document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
      try {
        const data = JSON.parse(script.textContent);
        collectJsonLdDates(data, results);
      } catch { /* invalid JSON-LD */ }
    });

    document.querySelectorAll('rss channel pubDate, feed entry published, feed entry updated').forEach((el) => {
      const d = parseDate(el.textContent);
      if (d) results.push(makeResult(d, 'meta', 0.9, 'tier1', { feedEmbedded: true }));
    });

    return results;
  }

  function collectJsonLdDates(obj, results, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 10) return;

    const fields = [
      ['datePublished', 0.99],
      ['dateCreated', 0.95],
      ['dateModified', 0.82],
      ['uploadDate', 0.9]
    ];

    for (const [field, conf] of fields) {
      if (obj[field]) {
        const d = parseDate(obj[field]);
        if (d) results.push(makeResult(d, 'jsonld', conf, 'tier1', { field }));
      }
    }

    if (obj['@graph']) {
      const graph = Array.isArray(obj['@graph']) ? obj['@graph'] : [obj['@graph']];
      graph.forEach((g) => collectJsonLdDates(g, results, depth + 1));
    }

    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object') collectJsonLdDates(val, results, depth + 1);
    }
  }

  // ─── Tier 2: Semantic HTML (0.6 – 0.8) ───────────────────────────────────

  function tier2Scan(scope = document, visibleOnly = false) {
    const results = [];
    const root = scope === document ? document : scope;

    root.querySelectorAll('time').forEach((el) => {
      if (visibleOnly && !isVisible(el)) return;
      if (scope !== document && !scope.contains(el)) return;

      let d = parseDate(el.getAttribute('datetime'));
      let conf = 0.78;
      if (!d) {
        d = parseDate(el.textContent);
        conf = 0.65;
      }
      if (d) {
        results.push(makeResult(d, 'time', conf, 'tier2', {
          element: el,
          container: getContainer(el)
        }));
      }
    });

    const dataAttrs = ['data-date', 'data-time', 'data-published', 'data-created', 'data-timestamp'];
    for (const attr of dataAttrs) {
      root.querySelectorAll(`[${attr}]`).forEach((el) => {
        if (visibleOnly && !isVisible(el)) return;
        const d = parseDate(el.getAttribute(attr));
        if (d) {
          results.push(makeResult(d, 'time', 0.72, 'tier2', {
            element: el,
            container: getContainer(el),
            attr
          }));
        }
      });
    }

    const cmsClasses = [
      '.post-date', '.entry-date', '.published', '.meta-date',
      '.date-published', '.post-meta time', '.article-date', '.publish-date'
    ];
    for (const sel of cmsClasses) {
      root.querySelectorAll(sel).forEach((el) => {
        if (visibleOnly && !isVisible(el)) return;
        const d = parseDate(el.getAttribute('datetime') || el.textContent);
        if (d) {
          results.push(makeResult(d, 'time', 0.68, 'tier2', {
            element: el,
            container: getContainer(el)
          }));
        }
      });
    }

    return results;
  }

  // ─── Tier 3: CMS Heuristics (0.5 – 0.7) ─────────────────────────────────

  function tier3ScanDOM(cms) {
    const results = [];
    const platform = cms || detectCMS();

    if (platform === 'Shopify') {
      const productJson = document.querySelector(
        '[data-product-json], script[type="application/json"][data-product], #ProductJson-product-template'
      );
      if (productJson) {
        try {
          const data = JSON.parse(productJson.textContent);
          const d = parseDate(data.published_at || data.created_at);
          if (d) results.push(makeResult(d, 'cms-api', 0.68, 'tier3', { cms: 'Shopify', domOnly: true }));
        } catch { /* skip */ }
      }
      if (window.meta?.product?.published_at) {
        const d = parseDate(window.meta.product.published_at);
        if (d) results.push(makeResult(d, 'cms-api', 0.65, 'tier3', { cms: 'Shopify', domOnly: true }));
      }
    }

    document.querySelectorAll('article, [role="article"], .post, .card, .entry').forEach((container) => {
      if (!isVisible(container)) return;
      const time = container.querySelector('time[datetime], .post-date, .entry-date, .published');
      if (!time) return;
      const d = parseDate(time.getAttribute('datetime') || time.textContent);
      if (d) {
        results.push(makeResult(d, 'time', 0.62, 'tier3', { container, element: time }));
      }
    });

    return results;
  }

  async function tier3ScanNetwork(cms) {
    const results = [];
    const platform = cms || detectCMS();

    if (platform === 'WordPress' || platform === 'Elementor') {
      const apiBase = document.querySelector('link[rel="https://api.w.org/"]')?.href
        || `${location.origin}/wp-json/wp/v2/`;
      const postId = getWordPressPostId();
      const slug = location.pathname.split('/').filter(Boolean).pop();

      const urls = [];
      if (postId) {
        urls.push(`${apiBase}posts/${postId}`);
        urls.push(`${apiBase}pages/${postId}`);
      }
      if (slug) {
        urls.push(`${apiBase}posts?slug=${encodeURIComponent(slug)}`);
        urls.push(`${apiBase}pages?slug=${encodeURIComponent(slug)}`);
      }

      for (const url of urls) {
        const res = await throttledFetch(url);
        if (!res) continue;
        const data = await res.json();
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const d = parseDate(item.date || item.date_gmt || item.modified);
          if (d) {
            results.push(makeResult(d, 'cms-api', 0.7, 'tier3', {
              cms: platform,
              title: item.title?.rendered
            }));
            return results;
          }
        }
      }
    }

    if (platform === 'Shopify') {
      const path = location.pathname;
      if (path.includes('/products/')) {
        const handle = path.split('/products/')[1]?.split('/')[0];
        if (handle) {
          const res = await throttledFetch(`${location.origin}/products/${handle}.json`);
          if (res) {
            const data = await res.json();
            const d = parseDate(data.product?.published_at || data.product?.created_at);
            if (d) {
              results.push(makeResult(d, 'cms-api', 0.68, 'tier3', { cms: 'Shopify' }));
            }
          }
        }
      }
    }

    return results;
  }

  // ─── Tier 4: Heuristic Text Parsing (0.2 – 0.5) ──────────────────────────

  const ABSOLUTE_PATTERNS = [
    { re: /\b(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?\b/g, base: 0.42 },
    { re: /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, base: 0.38 },
    { re: /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi, base: 0.4 },
    { re: /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{4})\b/gi, base: 0.4 }
  ];

  const RELATIVE_PATTERNS = [
    { re: /\b(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago\b/i, base: 0.35 },
    { re: /\byesterday\b/i, base: 0.32 },
    { re: /\blast\s+week\b/i, base: 0.28 },
    { re: /\blast\s+month\b/i, base: 0.28 }
  ];

  function parseRelativeDate(text) {
    const now = new Date();
    const ago = text.match(/\b(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago\b/i);
    if (ago) {
      const n = parseInt(ago[1], 10);
      const unit = ago[2].toLowerCase();
      const d = new Date(now);
      const map = { second: 1000, minute: 60000, hour: 3600000, day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 };
      d.setTime(d.getTime() - n * (map[unit] || 0));
      return d;
    }
    if (/\byesterday\b/i.test(text)) {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return d;
    }
    if (/\blast\s+week\b/i.test(text)) {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return d;
    }
    if (/\blast\s+month\b/i.test(text)) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      return d;
    }
    return null;
  }

  function tier4Scan(scope = document, visibleOnly = false) {
    const results = [];
    const seen = new Set();
    const root = scope === document ? document : scope;

    const candidates = root.querySelectorAll(
      'article span, article p, article small, .post span, .post p, .card p, ' +
      '.entry p, .meta, .byline, [class*="date"], [class*="time"], small'
    );

    candidates.forEach((el) => {
      if (visibleOnly && !isVisible(el)) return;
      if (scope !== document && !scope.contains(el)) return;
      if (el.children.length > 4) return;

      const text = el.textContent?.trim() || '';
      if (text.length < 4 || text.length > 100) return;

      const weight = spatialWeight(el);
      let found = null;

      for (const { re, base } of ABSOLUTE_PATTERNS) {
        re.lastIndex = 0;
        const match = re.exec(text);
        if (match) {
          const d = parseDate(match[0]);
          if (d && d.getFullYear() > 1990 && d.getFullYear() <= new Date().getFullYear() + 1) {
            found = makeResult(d, 'regex', Math.min(0.5, base + weight), 'tier4', {
              element: el,
              container: getContainer(el),
              match: match[0]
            });
            break;
          }
        }
      }

      if (!found) {
        for (const { re, base } of RELATIVE_PATTERNS) {
          if (re.test(text)) {
            const d = parseRelativeDate(text);
            if (d) {
              found = makeResult(d, 'inferred', Math.min(0.45, base + weight), 'tier4', {
                element: el,
                container: getContainer(el),
                relative: true
              });
              break;
            }
          }
        }
      }

      if (found) {
        const key = `${found.date.toISOString()}-${found.container?.tagName}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push(found);
        }
      }
    });

    return results;
  }

  // ─── Tier 5: Network / Source Resolution (optional) ──────────────────────

  async function tier5Scan() {
    const results = [];
    const origin = location.origin;

    const endpoints = [
      `${origin}/feed/`,
      `${origin}/feed.xml`,
      `${origin}/rss.xml`,
      `${origin}/atom.xml`,
      `${origin}/sitemap.xml`,
      `${origin}/api/posts`,
      `${origin}/wp-json/wp/v2/posts?per_page=1&orderby=date&order=desc`
    ];

    for (const url of endpoints) {
      const res = await throttledFetch(url, { headers: { Accept: 'application/json, application/xml, text/xml, */*' } });
      if (!res) continue;

      const contentType = res.headers.get('content-type') || '';
      const text = await res.text();

      if (contentType.includes('json') || url.includes('wp-json') || url.includes('/api/')) {
        try {
          const data = JSON.parse(text);
          const items = Array.isArray(data) ? data : [data];
          for (const item of items) {
            const raw = item.date || item.date_gmt || item.published_at || item.created_at || item.published;
            const d = parseDate(raw);
            if (d) {
              results.push(makeResult(d, 'inferred', 0.45, 'tier5', { endpoint: url }));
              return results;
            }
          }
        } catch { /* not JSON */ }
      }

      const pubMatch = text.match(/<pubDate>([^<]+)<\/pubDate>/i) ||
        text.match(/<published>([^<]+)<\/published>/i) ||
        text.match(/<lastmod>([^<]+)<\/lastmod>/i);
      if (pubMatch) {
        const d = parseDate(pubMatch[1]);
        if (d) {
          results.push(makeResult(d, 'inferred', 0.4, 'tier5', { endpoint: url }));
          return results;
        }
      }
    }

    return results;
  }

  // ─── Progressive page resolver ───────────────────────────────────────────

  async function resolvePageDate({ deepScan = false } = {}) {
    resetNetworkBudget();

    const t1 = tier1Scan();
    const best1 = pickBest(t1);
    if (best1 && best1.confidence >= 0.8) return best1;

    const t2 = tier2Scan(document, false);
    const headerScope = document.querySelector('header, [role="banner"], main, article, .entry-header');
    if (headerScope) t2.push(...tier2Scan(headerScope));
    const best2 = pickBest(t2);
    if (best2 && best2.confidence >= 0.6) return best2;

    const cms = detectCMS();
    const t3dom = tier3ScanDOM(cms);
    const best3 = pickBest(t3dom);
    if (best3 && best3.confidence >= 0.5) return best3;

    if (deepScan) {
      const t3net = await tier3ScanNetwork(cms);
      const best3n = pickBest(t3net);
      if (best3n && best3n.confidence >= 0.5) return best3n;

      const t5 = await tier5Scan();
      const best5 = pickBest(t5);
      if (best5) return best5;
    }

    const t4 = tier4Scan(document, false);
    const headerT4 = headerScope ? tier4Scan(headerScope) : [];
    const best4 = pickBest([...t4, ...headerT4]);
    if (best4) return best4;

    return pickBest([best1, best2, best3, ...t3dom, ...t4].filter(Boolean));
  }

  // ─── Element resolver (per container) ────────────────────────────────────

  function resolveElementDate(container, { visibleOnly = true } = {}) {
    if (!container?.isConnected) return null;
    if (visibleOnly && !isVisible(container)) return null;

    const t2 = tier2Scan(container, visibleOnly);
    const best2 = pickBest(t2);
    if (best2 && best2.confidence >= 0.6) return { ...best2, container };

    const t3 = tier3ScanDOM().filter((r) => r.container === container || container.contains(r.element));
    const best3 = pickBest(t3);
    if (best3 && best3.confidence >= 0.5) return { ...best3, container };

    const t4 = tier4Scan(container, visibleOnly);
    const best4 = pickBest(t4);
    if (best4) return { ...best4, container };

    return best2 ? { ...best2, container } : null;
  }

  function resolveElementDates({ visibleOnly = true, maxItems = 80 } = {}) {
    const results = [];
    const seen = new WeakSet();

    const containers = document.querySelectorAll(
      'article, [role="article"], .post, .card, .entry, .blog-post, .listing, .product-card'
    );

    const visible = [];
    const belowFold = [];

    containers.forEach((c) => {
      if (!isVisible(c)) return;
      (isInViewport(c) ? visible : belowFold).push(c);
    });

    for (const container of visible) {
      if (seen.has(container)) continue;
      const r = resolveElementDate(container, { visibleOnly });
      if (r) {
        seen.add(container);
        results.push(r);
      }
    }

    return { results: results.slice(0, maxItems), pending: belowFold, seen };
  }

  function resolvePendingElements(pending, seen, maxItems = 80, existing = []) {
    const results = [...existing];
    for (const container of pending) {
      if (results.length >= maxItems) break;
      if (seen.has(container)) continue;
      if (!isVisible(container)) continue;
      const r = resolveElementDate(container, { visibleOnly: true });
      if (r) {
        seen.add(container);
        results.push(r);
      }
    }
    return results.slice(0, maxItems);
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  window.PageDateDetector = {
    detectCMS,
    resolvePageDate,
    resolveElementDates,
    resolvePendingElements,
    resetNetworkBudget,
    pickBest,
    makeResult,
    tier1Scan,
    tier2Scan,
    tier3ScanDOM,
    tier3ScanNetwork,
    tier4Scan,
    tier5Scan,
    isVisible,
    isInViewport,
    getContainer,
    sourceLabel(source, method) {
      const labels = {
        meta: 'meta tag',
        jsonld: 'schema.org JSON-LD',
        time: 'semantic HTML',
        'cms-api': 'CMS API',
        regex: 'text pattern',
        inferred: 'inferred'
      };
      const tierLabels = {
        tier1: 'Tier 1 · Structured metadata',
        tier2: 'Tier 2 · Semantic HTML',
        tier3: 'Tier 3 · CMS heuristics',
        tier4: 'Tier 4 · Text parsing',
        tier5: 'Tier 5 · Network resolution'
      };
      return {
        source: labels[source] || source,
        method: tierLabels[method] || method
      };
    }
  };
})();
