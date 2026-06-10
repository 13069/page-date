import * as cheerio from 'cheerio';
import { parseFlexibleDate } from './dateParse.js';
import { sanitizeDate } from './dateValidate.js';

export function parseDate(str) {
  if (!str || typeof str !== 'string') return null;
  const flex = parseFlexibleDate(str);
  if (flex) return sanitizeDate(flex);
  const d = new Date(str.trim());
  return sanitizeDate(d);
}

export function makeResult(date, source, confidence, method, extra = {}) {
  const inferred = method === 'tier4' || method === 'tier5' || source === 'inferred';
  return {
    date: date.toISOString(),
    source,
    confidence: Math.round(Math.min(1, Math.max(0, confidence)) * 100) / 100,
    method,
    inferred,
    ...extra
  };
}

export function pickBest(results) {
  if (!results?.length) return null;
  const tierOrder = { tier1: 5, tier2: 4, tier3: 3, tier4: 2, tier5: 1 };
  return [...results].sort((a, b) => {
    const td = (tierOrder[b.method] || 0) - (tierOrder[a.method] || 0);
    if (td !== 0) return td;
    return b.confidence - a.confidence;
  })[0];
}

export function parseUrlDatePattern(url) {
  const m = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
    if (!isNaN(d.getTime())) {
      return makeResult(d, 'inferred', 0.45, 'tier4', { fromUrl: true });
    }
  }
  const m2 = url.match(/\/(\d{4})\/(\d{2})\//);
  if (m2) {
    const d = new Date(`${m2[1]}-${m2[2]}-01T12:00:00Z`);
    if (!isNaN(d.getTime())) {
      return makeResult(d, 'inferred', 0.35, 'tier4', { fromUrl: true });
    }
  }
  return null;
}

export function parseStructuredMetadata($) {
  const results = [];

  const metaSpecs = [
    ['meta[property="article:published_time"]', 'content', 0.98],
    ['meta[property="og:published_time"]', 'content', 0.95],
    ['meta[name="pubdate"]', 'content', 0.94],
    ['meta[name="publish-date"]', 'content', 0.92],
    ['meta[property="og:updated_time"]', 'content', 0.85],
    ['meta[property="article:modified_time"]', 'content', 0.82]
  ];

  for (const [sel, attr, conf] of metaSpecs) {
    const val = $(sel).attr(attr);
    const d = parseDate(val);
    if (d) results.push(makeResult(d, 'meta', conf, 'tier1'));
  }

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || '');
      collectJsonLd(data, results);
    } catch { /* skip */ }
  });

  return results;
}

function collectJsonLd(obj, results, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 10) return;
  const fields = [['datePublished', 0.99], ['dateCreated', 0.95], ['dateModified', 0.82], ['uploadDate', 0.9]];
  for (const [field, conf] of fields) {
    if (obj[field]) {
      const d = parseDate(obj[field]);
      if (d) results.push(makeResult(d, 'jsonld', conf, 'tier1', { field }));
    }
  }
  if (obj['@graph']) {
    const g = Array.isArray(obj['@graph']) ? obj['@graph'] : [obj['@graph']];
    g.forEach((item) => collectJsonLd(item, results, depth + 1));
  }
  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object') collectJsonLd(val, results, depth + 1);
  }
}

export function parseSemanticHtml($) {
  const results = [];

  $('time[datetime]').each((_, el) => {
    const d = parseDate($(el).attr('datetime'));
    if (d) results.push(makeResult(d, 'time', 0.78, 'tier2', { selector: 'time' }));
  });

  $('time').each((_, el) => {
    const d = parseDate($(el).text());
    if (d) results.push(makeResult(d, 'time', 0.65, 'tier2', { selector: 'time-text' }));
  });

  const dataAttrs = ['data-date', 'data-time', 'data-published', 'data-created'];
  for (const attr of dataAttrs) {
    $(`[${attr}]`).each((_, el) => {
      const d = parseDate($(el).attr(attr));
      if (d) results.push(makeResult(d, 'time', 0.72, 'tier2', { attr }));
    });
  }

  const cmsSels = [
    '.post-date', '.entry-date', '.published', '.meta-date', '.date-published',
    '.published-date', '.published-time', '.ad-publish-info-area', '[class*="publish-info"]',
    '.updated-date', '.modified-date', '[class*="updated-date"]'
  ];
  for (const sel of cmsSels) {
    $(sel).each((_, el) => {
      const d = parseDate($(el).attr('datetime') || $(el).text());
      if (d) results.push(makeResult(d, 'time', 0.68, 'tier2', { selector: sel }));
    });
  }

  return results;
}

const DATE_PATTERNS = [
  /\b(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?\b/g,
  /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g,
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi
];

const RELATIVE_PATTERNS = [
  { re: /\b(\d+)\s+days?\s+ago\b/i, days: (n) => n },
  { re: /\byesterday\b/i, days: () => 1 },
  { re: /\blast\s+week\b/i, days: () => 7 }
];

export function parseHeuristicDates($, html) {
  const results = [];
  const zones = ['header', '[role="banner"]', 'article', '.entry-header', '.post-header', '.byline', '.meta'];

  for (const zone of zones) {
    $(zone).find('span, small, p, time').each((_, el) => {
      const text = $(el).text().trim();
      if (text.length < 4 || text.length > 100) return;
      let boost = 0.1;
      if (/posted|published|updated|author|ago/i.test(text)) boost += 0.08;

      for (const re of DATE_PATTERNS) {
        re.lastIndex = 0;
        const m = re.exec(text);
        if (m) {
          const d = parseDate(m[0]);
          if (d && d.getFullYear() > 1990) {
            results.push(makeResult(d, 'regex', Math.min(0.5, 0.38 + boost), 'tier4', { match: m[0] }));
            return;
          }
        }
      }

      for (const { re, days } of RELATIVE_PATTERNS) {
        if (re.test(text)) {
          const n = text.match(/\d+/) ? parseInt(text.match(/\d+/)[0], 10) : days();
          const d = new Date();
          d.setDate(d.getDate() - (typeof days === 'function' ? days(n) : n));
          results.push(makeResult(d, 'inferred', Math.min(0.45, 0.32 + boost), 'tier4', { relative: true }));
          return;
        }
      }
    });
  }

  return results;
}

export function parseElements($, cms) {
  const elements = [];
  const seen = new Set();

  $('article, [role="article"], .post, .card, .entry, .blog-post').each((_, el) => {
    const $el = $(el);
    const title = $el.find('h1,h2,h3').first().text().trim().slice(0, 80);
    let best = null;

    const time = $el.find('time[datetime]').first();
    if (time.length) {
      const d = parseDate(time.attr('datetime'));
      if (d) best = makeResult(d, 'time', 0.75, 'tier2', { title });
    }

    if (!best) {
      const dateEl = $el.find('.post-date, .entry-date, .published, [class*="date"]').first();
      if (dateEl.length) {
        const d = parseDate(dateEl.attr('datetime') || dateEl.text());
        if (d) best = makeResult(d, 'time', 0.65, 'tier2', { title });
      }
    }

    if (best) {
      const key = `${best.date}-${title}`;
      if (!seen.has(key)) {
        seen.add(key);
        elements.push({ ...best, cms: cms || undefined, title });
      }
    }
  });

  return elements.slice(0, 80);
}

export function parseHtml(html, url, meta = {}) {
  const $ = cheerio.load(html || '');
  const results = [];

  results.push(...parseStructuredMetadata($));
  results.push(...parseSemanticHtml($));
  results.push(...parseHeuristicDates($, html));

  const urlDate = parseUrlDatePattern(url);
  if (urlDate) results.push(urlDate);

  const pageDate = pickBest(results);
  const elements = parseElements($, null);

  return { pageDate, elements, allCandidates: results };
}
