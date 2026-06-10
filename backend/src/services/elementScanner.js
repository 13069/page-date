import * as cheerio from 'cheerio';
import { makeResult, parseDate, pickBest } from './parser.js';
import { parseFlexibleDate, parseTime, applyTime, parseRelativeWord } from './dateParse.js';

const DATE_PATTERNS = [
  /\b(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?\b/g,
  /\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g,
  /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g,
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi,
  /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{4})\b/gi
];

const RELATIVE = [
  { re: /\b(\d+)\s+days?\s+ago\b/i, fn: (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; } },
  { re: /\byesterday\b/i, fn: () => { const d = new Date(); d.setDate(d.getDate() - 1); return d; } },
  { re: /\blast\s+week\b/i, fn: () => { const d = new Date(); d.setDate(d.getDate() - 7); return d; } }
];

const DATE_SELECTORS = [
  'time[datetime]', '.published-date', '[class*="published-date"]', '.date-published',
  '.main-article-date', '[class*="article-date"]', '.post-date', '.entry-date',
  '.published', '.meta-date', '.date',
  '[class*="publish-date"]', '[class*="posted-date"]', '[class*="created-date"]',
  '[class*="date"]', '[datetime]'
].join(', ');

const TIME_SELECTORS = [
  '.published-time', '[class*="published-time"]', '.post-time', '[class*="post-time"]',
  'time[class*="time"]', '[class*="time"]:not([class*="datetime"])'
].join(', ');

const UPDATED_SELECTORS = [
  '.updated-date', '.modified-date', '[class*="updated-date"]', '[class*="modified-date"]',
  '[class*="last-updated"]', '[class*="last-modified"]', '.updated', '.modified'
].join(', ');

const PUBLISH_BLOCK_SELECTORS = [
  '.ad-publish-info-area', '[class*="publish-info"]', '[class*="ad-meta"]',
  '.post-meta', '.entry-meta', '.byline', '.meta-info', '[class*="posted"]'
].join(', ');

function parseDateText(text) {
  return parseFlexibleDate(text) || parseDate(text);
}

function extractDateTimePair($, $scope) {
  const results = { published: null, updated: null };

  $scope.find(PUBLISH_BLOCK_SELECTORS).addBack(PUBLISH_BLOCK_SELECTORS).each((_, block) => {
    const $block = $(block);
    const dateEl = $block.find(DATE_SELECTORS).first();
    const timeEl = $block.find(TIME_SELECTORS).first();
    if (!dateEl.length) return;

    let d = parseDateText(dateEl.attr('datetime') || dateEl.text());
    if (d && timeEl.length) {
      const tm = parseTime(timeEl.text());
      if (tm) d = applyTime(d, tm);
    }
    if (d) results.published = d;
  });

  if (!results.published) {
    $scope.find(DATE_SELECTORS).each((_, c) => {
      if (results.published) return;
      const $c = $(c);
      let d = parseDateText($c.attr('datetime') || $c.text());
      if (!d) return;
      const $sib = $c.siblings(TIME_SELECTORS).first();
      if ($sib.length) {
        const tm = parseTime($sib.text());
        if (tm) d = applyTime(d, tm);
      }
      results.published = d;
    });
  }

  $scope.find(UPDATED_SELECTORS).each((_, c) => {
    if (results.updated) return;
    const d = parseDateText($(c).attr('datetime') || $(c).text());
    if (d) results.updated = d;
  });

  return results;
}

function findDateInSubtree($, $el) {
  const results = [];
  const pair = extractDateTimePair($, $el);

  if (pair.published) {
    results.push(makeResult(pair.published, 'time', 0.82, 'tier2', { field: 'published' }));
  }
  if (pair.updated) {
    results.push(makeResult(pair.updated, 'time', 0.78, 'tier2', { field: 'updated' }));
  }

  $el.find('time[datetime]').addBack('time[datetime]').each((_, t) => {
    const d = parseDateText($(t).attr('datetime'));
    if (d) results.push(makeResult(d, 'time', 0.8, 'tier2'));
  });

  const dataAttrs = [
    'data-date', 'data-time', 'data-published', 'data-created', 'data-timestamp',
    'data-modified', 'data-updated', 'data-publish-date', 'data-post-date'
  ];
  for (const attr of dataAttrs) {
    const d = parseDateText($el.attr(attr));
    if (d) results.push(makeResult(d, 'time', 0.75, 'tier2', { attr }));
    $el.find(`[${attr}]`).each((_, c) => {
      const dv = parseDateText($(c).attr(attr));
      if (dv) results.push(makeResult(dv, 'time', 0.72, 'tier2', { attr }));
    });
  }

  const text = $el.text().trim();
  const textLimit = $el.find(DATE_SELECTORS).length ? 800 : 300;
  if (text.length >= 4 && text.length <= textLimit) {
    for (const re of DATE_PATTERNS) {
      re.lastIndex = 0;
      const m = re.exec(text);
      if (m) {
        const d = parseDateText(m[0]);
        if (d && d.getFullYear() > 1990) {
          results.push(makeResult(d, 'regex', 0.48, 'tier4', { match: m[0] }));
          break;
        }
      }
    }
    if (!results.length) {
      const flex = parseFlexibleDate(text);
      if (flex && flex.getFullYear() > 1990) {
        results.push(makeResult(flex, 'regex', 0.52, 'tier4', { match: text.slice(0, 40) }));
      }
    }
    const rel = parseRelativeWord(text);
    if (rel) results.push(makeResult(rel, 'inferred', 0.55, 'tier4', { relative: true }));
    else for (const { re, fn } of RELATIVE) {
      if (re.test(text)) {
        const n = parseInt(text.match(/\d+/)?.[0] || '1', 10);
        const rd = fn(n);
        if (rd) results.push(makeResult(rd, 'inferred', 0.38, 'tier4', { relative: true }));
        break;
      }
    }
  }

  const best = pickBest(results);
  if (!best) return null;

  const updated = results.find((r) => r.field === 'updated');
  if (updated && updated !== best) {
    return { ...best, updatedDate: updated.date };
  }
  return best;
}

function dateFromImageSrc(src) {
  if (!src) return null;
  const patterns = [
    /\/(\d{4})\/(\d{2})\/(\d{2})\//,
    /\/(\d{4})[/_-](\d{2})[/_-](\d{2})/,
    /(\d{4})-(\d{2})-(\d{2})/,
    /(\d{8})/,
    /\/files\/(\d{4})\/(\d{2})\//
  ];
  for (const re of patterns) {
    const m = src.match(re);
    if (m) {
      let y, mo, da;
      if (m[1].length === 8) {
        y = m[1].slice(0, 4); mo = m[1].slice(4, 6); da = m[1].slice(6, 8);
      } else {
        y = m[1]; mo = m[2]; da = m[3] || '01';
      }
      const d = new Date(`${y}-${mo}-${da}T12:00:00Z`);
      if (!isNaN(d.getTime()) && d.getFullYear() > 1990) {
        return makeResult(d, 'inferred', 0.45, 'tier4', { fromSrc: true });
      }
    }
  }
  return null;
}

function loadElement($, html, ref, refInfo) {
  let $el = $(`[data-pd-ref="${ref}"]`);
  if ($el.length) return { $, $el };

  if (refInfo.html) {
    const $frag = cheerio.load(`<body>${refInfo.html}</body>`);
    const $fEl = $frag('body').children().first();
    if ($fEl.length) return { $: $frag, $el: $fEl };
  }
  return { $, $el: null };
}

export function scanTaggedElements(html, refs = [], cms, probedImages = new Map()) {
  const $ = cheerio.load(html || '');
  const elements = [];
  const seen = new Set();

  for (const refInfo of refs) {
    const { ref, type } = refInfo;
    const { $: $ctx, $el } = loadElement($, html, ref, refInfo);
    if (!$el?.length) continue;

    let best = findDateInSubtree($ctx, $el);

    if (!best && type === 'image') {
      const probed = probedImages.get(ref);
      if (probed) best = probed;

      if (!best) {
        const img = $el.is('img') ? $el : $el.find('img').first();
        const src = refInfo.src || img.attr('src') || img.attr('data-src') || '';
        best = dateFromImageSrc(src);
        if (!best) {
          const alt = refInfo.alt || img.attr('alt') || $el.find('figcaption').text() || '';
          for (const re of DATE_PATTERNS) {
            re.lastIndex = 0;
            const m = re.exec(alt);
            if (m) {
              const d = parseDateText(m[0]);
              if (d) { best = makeResult(d, 'regex', 0.4, 'tier4'); break; }
            }
          }
        }
      }
    }

    if (!best && type === 'text') {
      const raw = ($el.text() || refInfo.text || '').trim().slice(0, 200);
      const d = parseFlexibleDate(raw);
      if (d) best = makeResult(d, 'regex', 0.45, 'tier4');
    }

    if (best && !seen.has(ref)) {
      seen.add(ref);
      elements.push({
        ...best,
        pdRef: ref,
        elementType: type,
        cms: cms || undefined,
        src: refInfo.src || undefined,
        title: refInfo.alt || refInfo.title || refInfo.text?.slice(0, 60) || undefined
      });
    }
  }

  return elements;
}

export function scanSingleElement(html, cms, ref = null) {
  const $ = cheerio.load(html || '');
  const $root = $('body').children().first();
  if (!$root.length) return null;

  const tag = $root.prop('tagName')?.toLowerCase();
  let type = 'container';
  if (tag === 'img' || $root.find('img').length) type = 'image';
  else if (['p', 'span', 'blockquote', 'li', 'h1', 'h2', 'h3', 'h4', 'bdi'].includes(tag)) type = 'text';
  else if (['article'].includes(tag) || /post|card|entry|ad|listing|oglas/i.test($root.attr('class') || '')) type = 'post';

  const best = findDateInSubtree($, $root);
  if (!best && type === 'image') {
    const src = $root.attr('src') || $root.find('img').attr('src') || '';
    const fromSrc = dateFromImageSrc(src);
    if (fromSrc) return { ...fromSrc, elementType: 'image', src, pdRef: ref || undefined };
  }
  return best ? { ...best, elementType: type, pdRef: ref || undefined } : null;
}

export function scanUntaggedElements($, cms, analyze = {}) {
  const elements = [];
  const seen = new Set();

  const add = (best, type, extra = {}) => {
    if (!best) return;
    const key = extra.pdRef || `${best.date}-${type}-${extra.index ?? extra.title ?? extra.src ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    elements.push({ ...best, elementType: type, cms: cms || undefined, ...extra });
  };

  if (analyze.posts !== false) {
    $('article, [role="article"], .post, .card, .entry, .blog-post, .listing-item, .node, .comment, [class*="ad-item"], [class*="listing-card"], [class*="oglas"]').each((i, el) => {
      const $el = $(el);
      add(findDateInSubtree($, $el), 'post', {
        title: $el.find('h1,h2,h3,h4').first().text().trim().slice(0, 80),
        index: i
      });
    });
  }

  if (analyze.images !== false) {
    $('img').each((i, el) => {
      const $el = $(el);
      const src = $el.attr('src') || $el.attr('data-src') || '';
      let best = findDateInSubtree($, $el.parent()) || dateFromImageSrc(src);
      add(best, 'image', { title: $el.attr('alt')?.slice(0, 60), src, index: i });
    });
  }

  if (analyze.text !== false) {
    $('p, blockquote, .comment, .comment-body, li, span, bdi, .published-date, .published-time').each((i, el) => {
      const $el = $(el);
      const text = $el.text().trim();
      if (text.length < 4 || text.length > 400) return;
      if ($el.children().length > 5) return;
      add(findDateInSubtree($, $el), 'text', { text: text.slice(0, 80), index: i });
    });
  }

  if (analyze.containers !== false) {
    $('section, .content, [class*="block"], [class*="region"], .ad-publish-info-area').each((i, el) => {
      const $el = $(el);
      if ($el.find('article, .post, .listing-item').length) return;
      add(findDateInSubtree($, $el), 'container', { index: i });
    });
  }

  return elements.filter((e) => e.date).slice(0, 500);
}

export function countScanned(refs = []) {
  const counts = { images: 0, posts: 0, text: 0, containers: 0, comments: 0, total: refs.length };
  for (const r of refs) {
    if (r.type === 'image') counts.images++;
    else if (r.type === 'post') counts.posts++;
    else if (r.type === 'text') counts.text++;
    else if (r.type === 'container') counts.containers++;
    else if (r.type === 'comment') counts.comments++;
  }
  return counts;
}
