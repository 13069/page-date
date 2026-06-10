import * as cheerio from 'cheerio';
import { makeResult, parseDate, pickBest } from './parser.js';

export function extractShopifyFromHtml(html, url) {
  const $ = cheerio.load(html || '');
  const results = [];

  $('script[type="application/json"]').each((_, el) => {
    const text = $(el).html() || '';
    if (!text.includes('published_at') && !text.includes('created_at')) return;
    try {
      const data = JSON.parse(text);
      const product = data.product || data;
      const d = parseDate(product.published_at || product.created_at);
      if (d) {
        results.push(makeResult(d, 'cms-api', 0.9, 'tier3', {
          cms: 'Shopify',
          title: product.title
        }));
      }
    } catch { /* skip */ }
  });

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || '');
      const walk = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (obj.datePublished) {
          const d = parseDate(obj.datePublished);
          if (d) results.push(makeResult(d, 'jsonld', 0.88, 'tier1', { cms: 'Shopify' }));
        }
        for (const v of Object.values(obj)) {
          if (v && typeof v === 'object') walk(v);
        }
      };
      walk(data);
    } catch { /* skip */ }
  });

  return { pageDate: pickBest(results), elements: results.slice(0, 20) };
}

export async function extractShopify(url, html) {
  const fromHtml = extractShopifyFromHtml(html, url);

  if (fromHtml.pageDate) return fromHtml;

  try {
    const path = new URL(url).pathname;
    if (!path.includes('/products/')) return fromHtml;

    const handle = path.split('/products/')[1]?.split('/')[0];
    if (!handle) return fromHtml;

    const origin = new URL(url).origin;
    const res = await fetch(`${origin}/products/${handle}.json`, {
      headers: { Accept: 'application/json', 'User-Agent': 'PageDate-Scanner/1.0' }
    });
    if (!res.ok) return fromHtml;

    const data = await res.json();
    const d = parseDate(data.product?.published_at || data.product?.created_at);
    if (d) {
      return {
        pageDate: makeResult(d, 'cms-api', 0.88, 'tier3', {
          cms: 'Shopify',
          title: data.product?.title
        }),
        elements: []
      };
    }
  } catch { /* network blocked */ }

  return fromHtml;
}
