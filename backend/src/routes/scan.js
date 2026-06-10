import { Router } from 'express';
import * as cheerio from 'cheerio';
import { detectCMS } from '../services/cmsDetector.js';
import { parseHtml, pickBest } from '../services/parser.js';
import { scanTaggedElements, scanUntaggedElements, scanSingleElement, countScanned } from '../services/elementScanner.js';
import { probeImages, probeSingleImage, probeImagesBatch } from '../services/imageProbe.js';
import { extractWordPress } from '../services/wordpress.js';
import { extractShopify } from '../services/shopify.js';
import { fetchUrlDate } from '../services/linkFetcher.js';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimitMiddleware } from '../middleware/rateLimit.js';
import { getQuota } from '../services/store.js';

const router = Router();
const MAX_HTML_BYTES = 900_000;
const MAX_ELEMENTS = 500;

router.get('/usage', authMiddleware, (req, res) => {
  res.json(getQuota(req.user.apiKey));
});

router.post('/reset-usage', authMiddleware, (req, res) => {
  import('../services/store.js').then(({ resetUsage }) => {
    resetUsage(req.user.apiKey);
    res.json({ ok: true, quota: getQuota(req.user.apiKey) });
  });
});

router.post('/scan', authMiddleware, rateLimitMiddleware, async (req, res) => {
  const start = Date.now();
  const {
    url,
    html,
    meta = {},
    cmsHints = {},
    refs = [],
    analyze = {},
    mode = 'deep',
    inspectUrl = null,
    elementHtml = null,
    imageUrls = null,
    linkUrl = null
  } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  const lightMode = mode === 'images' || mode === 'batch' || mode === 'fetch-url';

  if (mode === 'images' && Array.isArray(imageUrls)) {
    const probed = await probeImagesBatch(imageUrls, url, 25);
    return res.json({
      ok: true,
      mode: 'images',
      elements: probed,
      elementCount: probed.length,
      quota: getQuota(req.user.apiKey),
      elapsed: Date.now() - start
    });
  }

  if (mode === 'batch' && Array.isArray(refs) && refs.length) {
    const cms = detectCMS({ html: '', url, cmsHints });
    const batchRefs = refs.slice(0, 30);
    let elements = scanTaggedElements('', batchRefs, cms, new Map());

    const imageRefs = batchRefs.filter((r) => r.type === 'image' && r.src);
    if (imageRefs.length) {
      const probed = await probeImages(imageRefs, url);
      for (const [ref, probedEl] of probed) {
        const idx = elements.findIndex((e) => e.pdRef === ref);
        if (idx >= 0 && probedEl.confidence > (elements[idx].confidence || 0)) {
          elements[idx] = probedEl;
        } else if (idx < 0) elements.push(probedEl);
      }
    }

    for (const ref of batchRefs) {
      if (ref.linkUrl && !elements.some((e) => e.pdRef === ref.ref)) {
        const linked = await fetchUrlDate(ref.linkUrl, url);
        if (linked) {
          elements.push({
            ...linked,
            pdRef: ref.ref,
            elementType: ref.type || 'image',
            src: ref.src,
            title: ref.alt || ref.title
          });
        }
      }
    }

    return res.json({
      ok: true,
      mode: 'batch',
      elements: elements.filter((e) => e.date).slice(0, 30),
      elementCount: elements.length,
      dated: countDated(elements),
      quota: getQuota(req.user.apiKey),
      elapsed: Date.now() - start
    });
  }

  if (mode === 'fetch-url' && linkUrl) {
    const result = await fetchUrlDate(linkUrl, url);
    return res.json({
      ok: true,
      mode: 'fetch-url',
      pageDate: result,
      elements: result ? [{ ...result, elementType: 'link' }] : [],
      quota: getQuota(req.user.apiKey),
      elapsed: Date.now() - start
    });
  }

  let safeHtml = typeof html === 'string' ? html : '';
  if (safeHtml.length > MAX_HTML_BYTES) safeHtml = safeHtml.slice(0, MAX_HTML_BYTES);

  const cms = detectCMS({ html: safeHtml, url, cmsHints });
  const sources = ['html-parser'];

  if (mode === 'inspect' && elementHtml) {
    const clickRef = refs[0]?.ref || 'pd-click-0';
    let result = scanSingleElement(elementHtml, cms, clickRef);
    const $ = cheerio.load(elementHtml);
    const src = $('img').attr('src') || $('body').find('img').attr('src') || inspectUrl;
    const href = refs[0]?.linkUrl || linkUrl || $('a[href]').attr('href');

    if (!result && src) {
      result = await probeSingleImage(src, url);
      if (result) { result.elementType = 'image'; result.src = src; result.pdRef = clickRef; }
    }

    if (!result && href) {
      const fullUrl = href.startsWith('http') ? href : new URL(href, url).href;
      const linked = await fetchUrlDate(fullUrl, url);
      if (linked) {
        result = { ...linked, elementType: refs[0]?.type || 'link', pdRef: clickRef, linkUrl: fullUrl };
      }
    }

    if (!lightMode) req.recordUsage();
    return res.json({
      ok: true,
      cms,
      mode: 'inspect',
      pageDate: result,
      elements: result ? [result] : [],
      elementCount: result ? 1 : 0,
      scanned: { images: 0, posts: 0, text: 0, containers: 0, total: 1 },
      dated: countDated(result ? [result] : []),
      confidenceLabel: result ? (result.confidence >= 0.6 ? 'Medium' : 'Low') : 'None',
      sources,
      quota: getQuota(req.user.apiKey),
      elapsed: Date.now() - start
    });
  }

  const local = parseHtml(safeHtml, url, meta);
  let pageDate = local.pageDate;
  const $ = cheerio.load(safeHtml || '');

  const taggedHtml = scanTaggedElements(safeHtml, refs, cms, new Map());
  const untagged = scanUntaggedElements($, cms, {
    images: analyze.images !== false,
    posts: analyze.posts !== false,
    text: analyze.text !== false,
    containers: analyze.containers !== false
  });

  let elements = mergeElements(taggedHtml, untagged);

  const probedImages = await probeImages(refs, url);
  for (const [ref, probed] of probedImages) {
    const exists = elements.some((e) => e.pdRef === ref);
    if (!exists) elements.push(probed);
    else {
      const idx = elements.findIndex((e) => e.pdRef === ref);
      if (probed.confidence > (elements[idx].confidence || 0)) elements[idx] = probed;
    }
  }

  if (cms === 'WordPress' || cms === 'Elementor') {
    try {
      const wp = await Promise.race([
        extractWordPress(url, safeHtml),
        new Promise((r) => setTimeout(() => r(null), 2500))
      ]);
      if (wp?.pageDate && (!pageDate || wp.pageDate.confidence > pageDate.confidence)) {
        pageDate = wp.pageDate;
      }
      if (wp?.elements?.length) {
        elements = mergeElements(elements, wp.elements.map((e) => ({ ...e, elementType: 'post' })));
        sources.push('wordpress-api');
      }
    } catch { /* skip */ }
  }

  if (cms === 'Shopify' || safeHtml.includes('shopify') || safeHtml.includes('published_at')) {
    try {
      const shop = await Promise.race([
        extractShopify(url, safeHtml),
        new Promise((r) => setTimeout(() => r(null), 2500))
      ]);
      if (shop?.pageDate && (!pageDate || shop.pageDate.confidence > pageDate.confidence)) {
        pageDate = shop.pageDate;
      }
      if (shop?.elements?.length) {
        elements = mergeElements(elements, shop.elements.map((e) => ({ ...e, elementType: e.elementType || 'post' })));
        sources.push('shopify-api');
      }
    } catch { /* skip */ }
  }

  if (!pageDate && elements.length) {
    pageDate = pickBest(elements.map((e) => ({
      date: e.date,
      source: e.source,
      confidence: e.confidence,
      method: e.method,
      inferred: e.inferred
    })));
  }

  req.recordUsage();

  const scanned = countScanned(refs);
  const dated = countDated(elements);

  res.json({
    ok: true,
    cms,
    mode: 'deep',
    pageDate,
    elements: elements.slice(0, MAX_ELEMENTS),
    elementCount: elements.length,
    scanned,
    dated,
    breakdown: dated,
    confidenceLabel: pageDate
      ? pageDate.confidence >= 0.8 ? 'High' : pageDate.confidence >= 0.6 ? 'Medium' : 'Low'
      : elements.length ? 'Mixed' : 'None',
    sources,
    quota: getQuota(req.user.apiKey),
    elapsed: Date.now() - start
  });
});

function countDated(elements) {
  return {
    images: elements.filter((e) => e.elementType === 'image').length,
    posts: elements.filter((e) => e.elementType === 'post').length,
    text: elements.filter((e) => e.elementType === 'text').length,
    containers: elements.filter((e) => e.elementType === 'container').length,
    total: elements.length
  };
}

function mergeElements(a, b) {
  const seen = new Set();
  const out = [];
  for (const item of [...a, ...b]) {
    const key = item.pdRef
      || `${item.date}-${item.elementType}-${item.index ?? ''}-${item.title || item.src || item.text || ''}`;
    if (!seen.has(key)) { seen.add(key); out.push(item); }
  }
  return out;
}

export default router;
