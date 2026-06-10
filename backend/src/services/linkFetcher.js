import * as cheerio from 'cheerio';
import { parseHtml, pickBest } from './parser.js';
import { scanSingleElement } from './elementScanner.js';

const FETCH_TIMEOUT = 4000;

export async function fetchUrlDate(url, referer = null) {
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,*/*'
    };
    if (referer) headers.Referer = referer;

    const res = await fetch(url, { signal: controller.signal, headers, redirect: 'follow' });
    clearTimeout(timer);
    if (!res.ok) return null;

    const html = (await res.text()).slice(0, 200_000);
    const parsed = parseHtml(html, url);
    const pageDate = parsed.pageDate;
    const $ = cheerio.load(html);
    const article = $('article, .post, .entry, main').first();
    const elDate = article.length
      ? scanSingleElement(`<body>${article.html()}</body>`, null)
      : null;

    const best = pickBest([pageDate, elDate].filter(Boolean));
    if (!best) return null;
    return { ...best, linkUrl: url, source: best.source || 'link-fetch' };
  } catch {
    clearTimeout(timer);
    return null;
  }
}
