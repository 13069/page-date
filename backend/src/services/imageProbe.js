import { makeResult, parseDate } from './parser.js';

const PROBE_TIMEOUT = 2500;
const MAX_PROBES = 40;
const CONCURRENCY = 8;
const GLOBAL_PROBE_BUDGET_MS = 4000;

async function fetchHeaders(url, referer) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'image/avif,image/webp,image/*,*/*;q=0.8'
  };
  if (referer) headers.Referer = referer;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);

  try {
    let res = await fetch(url, { method: 'HEAD', signal: controller.signal, headers, redirect: 'follow' });
    if (!res.ok || !res.headers.get('last-modified')) {
      res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { ...headers, Range: 'bytes=0-1' },
        redirect: 'follow'
      });
    }
    clearTimeout(timer);
    return res;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function dateFromFilename(url) {
  if (!url) return null;
  const name = url.split('/').pop()?.split('?')[0] || '';
  const patterns = [
    /(\d{4})[-_](\d{2})[-_](\d{2})/,
    /(\d{4})(\d{2})(\d{2})/,
    /[-_](\d{2})[-_](\d{4})[-_]/
  ];
  for (const re of patterns) {
    const m = name.match(re);
    if (m) {
      let y, mo, da;
      if (m[1].length === 4) { y = m[1]; mo = m[2]; da = m[3] || '01'; }
      else { y = m[2]; mo = m[1]; da = '01'; }
      const d = parseDate(`${y}-${mo}-${da}`);
      if (d && d.getFullYear() > 1990) {
        return makeResult(d, 'inferred', 0.38, 'tier4', { from: 'filename', src: url });
      }
    }
  }
  return null;
}

export async function probeImageUrl(url, referer = null) {
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const fromName = dateFromFilename(url);
  if (fromName) return { ...fromName, src: url };

  const res = await fetchHeaders(url, referer);
  if (!res) return null;

  const lastMod = res.headers.get('last-modified');
  if (lastMod) {
    const d = parseDate(lastMod);
    if (d) {
      return makeResult(d, 'inferred', 0.65, 'tier5', {
        from: 'Last-Modified',
        imageUrl: url.slice(0, 300),
        src: url
      });
    }
  }

  return null;
}

async function probeOne(ref, pageUrl) {
  const found = await probeImageUrl(ref.src, pageUrl);
  if (!found) return null;
  return {
    ...found,
    pdRef: ref.ref,
    elementType: 'image',
    title: ref.alt,
    src: ref.src
  };
}

async function runPool(items, fn, concurrency) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        const r = await fn(items[idx]);
        if (r) results.push(r);
      } catch { /* skip failed probe */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export async function probeImages(refs = [], pageUrl = null) {
  const imageRefs = refs.filter((r) => r.type === 'image' && r.src).slice(0, MAX_PROBES);
  if (!imageRefs.length) return new Map();

  const deadline = Date.now() + GLOBAL_PROBE_BUDGET_MS;
  const probePromise = runPool(imageRefs, (ref) => probeOne(ref, pageUrl), CONCURRENCY);
  const timeoutPromise = new Promise((resolve) => {
    const wait = Math.max(0, deadline - Date.now());
    setTimeout(() => resolve([]), wait);
  });

  const found = await Promise.race([probePromise, timeoutPromise]);
  const map = new Map();
  for (const item of found) {
    if (item.pdRef) map.set(item.pdRef, item);
  }
  return map;
}

export async function probeSingleImage(url, referer = null) {
  return probeImageUrl(url, referer);
}

export async function probeImagesBatch(urls, pageUrl, limit = 10) {
  const refs = urls.slice(0, limit).map((src, i) => ({ ref: `pd-batch-${i}`, type: 'image', src }));
  const map = await probeImages(refs, pageUrl);
  return [...map.values()];
}
