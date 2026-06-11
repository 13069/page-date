(() => {
  'use strict';

  const D = () => window.PageDateDetector;
  const X = () => window.PageDateExtractor;

  const ROOT_ID = 'pagedate-root';
  const POSITION_THROTTLE_MS = 80;
  const MIN_RESCAN_MS = 5000;
  const LAZY_IMG_DEBOUNCE = 800;
  const BATCH_SIZE = 25;
  const BATCH_DEBOUNCE = 600;

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

  let settings = { ...DEFAULT_SETTINGS };
  let rootEl, pageChipEl, tooltipEl, lazyObserver;
  let lastUrl = location.href;
  let lastScanTime = 0;
  let pageDateResult = null;
  let elementResults = [];
  let badgeMap = new Map();
  let cmsType = null;
  let isScanning = false;
  let confidenceLabel = '—';
  let scanError = null;
  let scannedCounts = emptyCounts();
  let datedCounts = emptyCounts();
  let clickHighlightEl = null;
  let clickModeActive = false;
  let inspectToastEl = null;
  let latestUpdate = null;
  let refRegistry = new Map();
  let processedRefs = new Set();
  let processedFingerprints = new Set();
  let batchRunning = false;
  let clickHistory = [];
  let started = false;
  let scanProgress = 0;
  let scanPhase = 'Starting…';
  let waybackResult = null;
  let waybackLoading = false;

  function emptyCounts() {
    return { images: 0, posts: 0, text: 0, containers: 0, total: 0 };
  }

  function normalizeCounts(c) {
    const base = emptyCounts();
    if (!c) return base;
    const images = c.images ?? 0;
    const posts = c.posts ?? 0;
    const text = c.text ?? 0;
    const containers = c.containers ?? 0;
    return {
      images, posts, text, containers,
      total: c.total ?? (images + posts + text + containers)
    };
  }

  function throttle(fn, ms) {
    let last = 0, timer = null;
    return (...args) => {
      const now = Date.now();
      if (now - last >= ms) { last = now; fn(...args); }
      else if (!timer) timer = setTimeout(() => { last = Date.now(); timer = null; fn(...args); }, ms - (now - last));
    };
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function formatDate(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatTime(d) {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function formatDateTime(d) {
    return `${formatDate(d)} ${formatTime(d)}`;
  }

  function confidenceLevel(c) {
    if (c >= 0.8) return 'High';
    if (c >= 0.6) return 'Medium';
    if (c >= 0.4) return 'Low';
    return 'Uncertain';
  }

  function isPlausibleDate(d) {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) return false;
    const y = d.getFullYear();
    const now = new Date();
    if (y < 1990 || y > now.getFullYear() + 1) return false;
    if (d > new Date(now.getTime() + 2 * 86400000)) return false;
    return true;
  }

  function sanitizeDate(d) {
    if (!d) return null;
    const date = d instanceof Date ? d : new Date(d);
    return isPlausibleDate(date) ? date : null;
  }

  function setProgress(pct, phase) {
    scanProgress = Math.min(100, Math.max(0, pct));
    if (phase) scanPhase = phase;
    renderPageChip();
  }

  function parseWaybackTimestamp(ts) {
    if (!ts || ts.length < 8) return null;
    const d = new Date(
      +ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8),
      +(ts.slice(8, 10) || 0), +(ts.slice(10, 12) || 0), +(ts.slice(12, 14) || 0)
    );
    return isPlausibleDate(d) ? d : null;
  }

  function fetchWayback() {
    waybackLoading = true;
    waybackResult = null;
    renderPageChip();
    chrome.runtime.sendMessage({ type: 'WAYBACK_CHECK', url: location.href }, (response) => {
      waybackLoading = false;
      if (response?.ok && response.data?.available) {
        waybackResult = response.data;
      }
      renderPageChip();
    });
  }

  function normSrc(s) {
    if (!s) return '';
    try { return new URL(s, location.href).href; } catch { return s; }
  }

  function fromServerResult(r) {
    const date = sanitizeDate(new Date(r.date));
    if (!date) return null;
    return {
      date,
      updatedDate: r.updatedDate ? sanitizeDate(new Date(r.updatedDate)) : null,
      source: r.source,
      confidence: r.confidence,
      method: r.method,
      inferred: r.inferred,
      cms: r.cms,
      title: r.title,
      elementType: r.elementType,
      pdRef: r.pdRef,
      src: r.src,
      field: r.field,
      linkUrl: r.linkUrl
    };
  }

  function updateLatestUpdate() {
    latestUpdate = elementResults.reduce((max, r) => {
      for (const d of [r.date, r.updatedDate].filter((x) => isPlausibleDate(x))) {
        if (!max || d > max) max = d;
      }
      return max;
    }, null);
    if (pageDateResult?.date && isPlausibleDate(pageDateResult.date)) {
      if (!latestUpdate || pageDateResult.date > latestUpdate) latestUpdate = pageDateResult.date;
    }
  }

  function registerRefs(refs = []) {
    for (const r of refs) refRegistry.set(r.ref, r);
  }

  function refFingerprint(info, el) {
    if (info?.src) return `img:${normSrc(info.src)}`;
    if (info?.ref) return `ref:${info.ref}`;
    if (el) {
      const tag = el.tagName?.toLowerCase() || '';
      const src = tag === 'img' ? normSrc(X().getImgSrc(el)) : '';
      if (src) return `img:${src}`;
      const pdRef = el.getAttribute?.('data-pd-ref');
      if (pdRef) return `ref:${pdRef}`;
      return `el:${tag}:${(el.textContent || '').trim().slice(0, 50)}`;
    }
    return `unk:${info?.type}:${info?.title || ''}`;
  }

  function resultFingerprint(r) {
    if (r.elementType === 'image' && r.src) return `img:${normSrc(r.src)}`;
    if (r.pdRef) return `ref:${r.pdRef}`;
    if (r.container) {
      const tag = r.container.tagName?.toLowerCase();
      if (tag === 'img') {
        const s = normSrc(X().getImgSrc(r.container));
        if (s) return `img:${s}`;
      }
      const ref = r.container.getAttribute?.('data-pd-ref');
      if (ref) return `ref:${ref}`;
    }
    return `${r.elementType}:${r.date?.getTime()}:${r.title || ''}`;
  }

  function dedupeResults(list) {
    const out = [];
    const seen = new Set();
    for (const r of list) {
      if (!r?.date || !isPlausibleDate(r.date)) continue;
      const fp = resultFingerprint(r);
      if (seen.has(fp)) continue;
      seen.add(fp);
      out.push(r);
    }
    return out;
  }

  function isElementAlreadyDated(el, info) {
    if (!el) return false;
    const fp = refFingerprint(info, el);
    if (processedFingerprints.has(fp)) return true;
    if (info?.ref && processedRefs.has(info.ref)) return true;
    for (const r of elementResults) {
      if (!r.container) continue;
      if (r.container === el) return true;
      if (r.container.contains?.(el) || el.contains?.(r.container)) return true;
      if (info?.src && r.src && normSrc(info.src) === normSrc(r.src)) return true;
    }
    return false;
  }

  function markProcessedFromResults(results) {
    for (const r of results) {
      processedFingerprints.add(resultFingerprint(r));
      if (r.pdRef) processedRefs.add(r.pdRef);
      else if (r.container) {
        const ref = r.container.getAttribute?.('data-pd-ref');
        if (ref) processedRefs.add(ref);
        processedFingerprints.add(refFingerprint(null, r.container));
      }
    }
  }

  function markRefAttempted(info, el) {
    if (info?.ref) processedRefs.add(info.ref);
    processedFingerprints.add(refFingerprint(info, el));
  }

  function applyResults(incoming) {
    elementResults = dedupeResults(mergeResults(elementResults, incoming));
    markProcessedFromResults(incoming);
    datedCounts = countLocalDated();
    updateLatestUpdate();
  }

  function getUndatedRefsInView(limit = BATCH_SIZE) {
    const out = [];
    for (const [ref, info] of refRegistry) {
      const el = document.querySelector(`[data-pd-ref="${ref}"]`);
      if (!el || !isInViewport(el)) continue;
      if (isElementAlreadyDated(el, info)) continue;
      out.push(info);
      if (out.length >= limit) break;
    }
    return out;
  }

  async function resolvePageDateWithRetry() {
    let result = await D().resolvePageDate({ deepScan: false });
    if (!result) {
      await new Promise((r) => setTimeout(r, 600));
      result = await D().resolvePageDate({ deepScan: true });
    }
    return result;
  }

  function getAnalyzeOptions() {
    return {
      images: settings.analyzeImages,
      posts: settings.analyzePosts,
      text: settings.analyzeText,
      containers: settings.analyzeContainers
    };
  }

  function matchServerElements(serverElements) {
    const matched = [];
    const used = new Set();

    for (const se of serverElements) {
      const item = fromServerResult(se);
      if (!item) continue;
      let container = null;

      if (se.pdRef) {
        container = document.querySelector(`[data-pd-ref="${se.pdRef}"]`);
      }

      if (!container && se.elementType === 'image') {
        const target = normSrc(se.src || se.imageUrl || '');
        container = [...document.querySelectorAll('img')].find((img) => {
          if (used.has(img)) return false;
          const s = normSrc(X().getImgSrc(img));
          return target && (s === target || s.endsWith(target.split('/').pop()));
        });
      }

      if (!container && se.title) {
        const sn = se.title.slice(0, 40).toLowerCase();
        container = [...document.querySelectorAll('article,.post,.card,h1,h2,h3,p,[class*="ad"],[class*="listing"],.listing-item')]
          .find((el) => !used.has(el) && el.textContent?.toLowerCase().includes(sn));
      }

      if (!container && se.pdRef?.startsWith('pd-click-')) {
        container = document.querySelector(`[data-pd-ref="${se.pdRef}"]`);
      }

      if (container && !used.has(container)) {
        used.add(container);
        matched.push({ ...item, container });
      }
    }
    return matched;
  }

  function apiScan(payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'API_SCAN', payload }, (response) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(response || { ok: false, error: 'No response' });
      });
    });
  }

  // ─── Click mode ──────────────────────────────────────────────────────────

  const INSPECT_TARGET_SEL = 'article,[role="article"],.post,.card,.entry,.listing-item,.listing,.item,figure,picture,img,time,[class*="publish"],.main-article-date,[class*="article-date"],[class*="oglas"],[class*="ad-item"],li';

  function findInspectTarget(el) {
    if (!el || el.closest?.('#pagedate-root')) return null;
    const hit = el.closest?.(INSPECT_TARGET_SEL);
    if (hit && !hit.closest('#pagedate-root')) return hit;
    return el;
  }

  function findExistingResultForElement(el) {
    if (!el) return null;
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      const hit = elementResults.find((r) => r.container === node);
      if (hit) return hit;
    }
    return elementResults.find((r) => r.container?.contains?.(el)) || null;
  }

  function pickBestInspectResult(...candidates) {
    let best = null;
    for (const r of candidates) {
      if (!r?.date) continue;
      if (!best || (r.confidence || 0) > (best.confidence || 0)) best = r;
    }
    return best;
  }

  function applyInspectResult(target, result) {
    if (!result?.date) return false;
    const r = {
      ...result,
      container: target,
      inspectHighlight: true,
      elementType: result.elementType || X().detectType(target)
    };
    const i = elementResults.findIndex((e) => e.container === target);
    if (i >= 0) elementResults[i] = r;
    else elementResults.push(r);
    clickHistory.push({
      ...r,
      clickedAt: new Date().toISOString(),
      selector: target.tagName,
      linkUrl: r.linkUrl || X().getLinkUrl(target)
    });
    datedCounts = countLocalDated();
    updateLatestUpdate();
    scanError = null;
    showInspectToast(target, r);
    renderInspectBadge(r);
    renderPageChip();
    return true;
  }

  function clearClickHighlight() {
    if (clickHighlightEl) {
      clickHighlightEl.classList.remove('pagedate-click-hover');
      clickHighlightEl = null;
    }
  }

  function onClickModeMove(e) {
    if (!settings.clickMode || !clickModeActive || e.target.closest('#pagedate-root')) return;
    const raw = document.elementFromPoint(e.clientX, e.clientY);
    const el = findInspectTarget(raw);
    if (!el) return;
    if (el !== clickHighlightEl) {
      clearClickHighlight();
      clickHighlightEl = el;
      el.classList.add('pagedate-click-hover');
    }
  }

  function onClickModeClick(e) {
    if (!settings.clickMode || !clickModeActive || e.target.closest('#pagedate-root')) return;
    const target = findInspectTarget(clickHighlightEl || e.target);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    inspectClickedElement(target);
    clearClickHighlight();
  }

  function positionFloatingPanel(el, panel, w = 240, h = 100) {
    const rect = el?.getBoundingClientRect?.() || { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 };
    const offscreen = rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth || rect.width < 2;

    let top, left;
    if (offscreen) {
      top = Math.max(12, window.innerHeight - h - 72);
      left = Math.max(12, window.innerWidth - w - 16);
    } else {
      top = rect.bottom + 8;
      left = rect.left;
      if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 8);
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
    }
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
  }

  function showInspectToast(el, result) {
    if (!inspectToastEl) {
      inspectToastEl = document.createElement('div');
      inspectToastEl.className = 'pagedate-inspect-toast';
      ensureRoot().appendChild(inspectToastEl);
    }
    const hasDate = result?.date instanceof Date && !isNaN(result.date.getTime());
    const updated = result?.updatedDate ? `<div class="pagedate-inspect-updated">Updated: ${formatDateTime(result.updatedDate)}</div>` : '';
    inspectToastEl.innerHTML = hasDate ? `
      <div class="pagedate-inspect-title">Inspect result</div>
      <div class="pagedate-inspect-date">${formatDateTime(result.date)}</div>
      ${updated}
      <div class="pagedate-inspect-meta">${result.inferred ? 'Inferred · ' : ''}${confidenceLevel(result.confidence)} confidence</div>
      <button class="pagedate-inspect-copy" type="button">Copy</button>` : `
      <div class="pagedate-inspect-title">Inspect result</div>
      <div class="pagedate-inspect-date">No date found</div>
      <div class="pagedate-inspect-meta">Try a date label, link, or image</div>`;
    inspectToastEl.style.display = 'block';
    positionFloatingPanel(el, inspectToastEl);

    const copyBtn = inspectToastEl.querySelector('.pagedate-inspect-copy');
    if (copyBtn && hasDate) {
      copyBtn.onclick = () => copyResults([result]);
    }

    clearTimeout(showInspectToast._t);
    showInspectToast._t = setTimeout(() => { if (inspectToastEl) inspectToastEl.style.display = 'none'; }, 8000);
  }

  async function inspectClickedElement(el) {
    if (!el) return;
    const target = findInspectTarget(el) || el;
    target.classList.add('pagedate-inspecting');

    const existing = findExistingResultForElement(target);
    let localResult = null;
    try {
      localResult = D().resolveElementDate(target, { visibleOnly: false });
      if (localResult) {
        localResult = {
          ...localResult,
          container: target,
          elementType: X().detectType(target),
          inspectHighlight: true
        };
      }
    } catch { /* local inspect optional */ }

    if (!settings.apiKey) {
      target.classList.remove('pagedate-inspecting');
      const best = pickBestInspectResult(existing, localResult);
      if (applyInspectResult(target, best)) return;
      scanError = 'API key required for deep inspect';
      clickHistory.push({ clickedAt: new Date().toISOString(), selector: target.tagName, noDate: true, linkUrl: X().getLinkUrl(target) });
      showInspectToast(target, null);
      renderPageChip();
      return;
    }

    const payload = X().buildElementSnapshot(target);
    const response = await apiScan(payload);
    target.classList.remove('pagedate-inspecting');

    let apiResult = null;
    if (response.ok) {
      const matched = matchServerElements(response.data.elements || []);
      if (matched.length) apiResult = { ...matched[0], container: target, inspectHighlight: true };
      else if (response.data.pageDate) {
        apiResult = {
          ...fromServerResult(response.data.pageDate),
          container: target,
          elementType: X().detectType(target),
          inspectHighlight: true
        };
      }
    }

    const best = pickBestInspectResult(apiResult, localResult, existing);
    if (applyInspectResult(target, best)) return;

    scanError = response.ok ? 'No date found on this element' : (response.error || 'Inspect failed');
    clickHistory.push({ clickedAt: new Date().toISOString(), selector: target.tagName, noDate: true, linkUrl: X().getLinkUrl(target) });
    showInspectToast(target, null);
    renderPageChip();
  }

  function renderInspectBadge(result) {
    if (!result?.container) return;
    const root = ensureRoot();
    const existing = badgeMap.get(result.container);
    if (existing) existing.badge.remove();
    const badge = createBadge(result);
    badge.classList.add('pagedate-inspect-badge');
    root.appendChild(badge);
    badgeMap.set(result.container, { badge, result });
    positionBadge(badge, result.container, result);
  }

  function setClickMode(on) {
    clickModeActive = on;
    if (on) {
      document.body.classList.add('pagedate-click-active');
      document.addEventListener('mousemove', onClickModeMove, true);
      document.addEventListener('click', onClickModeClick, true);
      badgeMap.forEach((e) => { e.badge.style.display = 'none'; });
    } else {
      document.body.classList.remove('pagedate-click-active');
      document.removeEventListener('mousemove', onClickModeMove, true);
      document.removeEventListener('click', onClickModeClick, true);
      clearClickHighlight();
      renderBadges();
    }
  }

  function countLocalDated() {
    return {
      images: elementResults.filter((e) => e.elementType === 'image').length,
      posts: elementResults.filter((e) => e.elementType === 'post').length,
      text: elementResults.filter((e) => e.elementType === 'text').length,
      containers: elementResults.filter((e) => e.elementType === 'container').length,
      total: elementResults.length
    };
  }

  // ─── UI ──────────────────────────────────────────────────────────────────

  function ensureRoot() {
    if (rootEl?.isConnected) return rootEl;
    rootEl = document.createElement('div');
    rootEl.id = ROOT_ID;
    document.documentElement.appendChild(rootEl);
    return rootEl;
  }

  const TYPE_LABELS = { image: 'IMG', post: 'POST', text: 'TXT', container: 'BOX' };

  function createBadge(result) {
    const badge = document.createElement('div');
    const type = result.elementType || 'container';
    badge.className = `pagedate-badge pagedate-type-${type}`;
    if (result.inferred) badge.classList.add('pagedate-inferred');
    const prefix = result.inferred ? '~' : '';
    const tag = TYPE_LABELS[type] ? `<span class="pagedate-badge-type">${TYPE_LABELS[type]}</span>` : '';
    badge.innerHTML = `${tag}<span class="pagedate-badge-icon">🕒</span><span class="pagedate-badge-text">${prefix}${formatDate(result.date)} <span class="pagedate-badge-time">${formatTime(result.date)}</span></span>`;
    badge.addEventListener('mouseenter', (e) => showTooltip(e, result));
    badge.addEventListener('mouseleave', hideTooltip);
    badge.addEventListener('mousemove', moveTooltip);
    return badge;
  }

  function createPageChip() {
    const chip = document.createElement('div');
    chip.className = 'pagedate-chip pagedate-inspector';
    chip.innerHTML = `
      <button class="pagedate-chip-toggle" aria-label="Toggle"><span class="pagedate-chip-arrow">◂</span></button>
      <div class="pagedate-chip-body">
        <div class="pagedate-chip-brand">PageDate</div>
        <div class="pagedate-progress-wrap" id="pd-progress-wrap">
          <div class="pagedate-progress-label" id="pd-progress-label">Starting…</div>
          <div class="pagedate-progress-track"><div class="pagedate-progress-bar" id="pd-progress-bar"></div></div>
        </div>
        <div class="pagedate-chip-divider"></div>
        <div class="pagedate-chip-row">📄 Page: <span class="pagedate-chip-val" id="pd-page-date">Starting…</span></div>
        <div class="pagedate-chip-row">🔍 Scanned: <span class="pagedate-chip-val" id="pd-scanned">0</span></div>
        <div class="pagedate-chip-row">✅ Dated: <span class="pagedate-chip-val" id="pd-dated">0</span></div>
        <div class="pagedate-chip-row" id="pd-updated-row" style="display:none">🔄 Latest update: <span class="pagedate-chip-val" id="pd-updated">—</span></div>
        <div class="pagedate-chip-row" id="pd-wayback-row" style="display:none">📚 Wayback: <a class="pagedate-wayback-link" id="pd-wayback" href="#" target="_blank" rel="noopener">—</a></div>
        <div class="pagedate-chip-row">Confidence: <span class="pagedate-chip-val" id="pd-conf">—</span></div>
        <div class="pagedate-chip-hint" id="pd-hint" style="display:none">Hover & click any element to inspect</div>
        <div class="pagedate-chip-actions">
          <button type="button" class="pagedate-chip-btn" id="pd-copy" title="Copy results">Copy</button>
          <button type="button" class="pagedate-chip-btn" id="pd-json" title="Export JSON">JSON</button>
          <button type="button" class="pagedate-chip-btn" id="pd-csv" title="Export CSV">CSV</button>
          <button type="button" class="pagedate-chip-btn" id="pd-timeline" title="Timeline report">Timeline</button>
          <button type="button" class="pagedate-chip-btn" id="pd-clear" title="Clear inspect history">Clear</button>
        </div>
        <div class="pagedate-chip-error" id="pd-error" style="display:none"></div>
      </div>`;
    chip.querySelector('.pagedate-chip-toggle').addEventListener('click', () => chip.classList.toggle('pagedate-chip-collapsed'));
    chip.querySelector('#pd-copy').addEventListener('click', () => copyResults(elementResults));
    chip.querySelector('#pd-json').addEventListener('click', () => downloadExport('json'));
    chip.querySelector('#pd-csv').addEventListener('click', () => downloadExport('csv'));
    chip.querySelector('#pd-timeline').addEventListener('click', () => downloadExport('timeline'));
    chip.querySelector('#pd-clear').addEventListener('click', clearInspectHistory);
    return chip;
  }

  function resultToPlain(r) {
    return {
      type: r.elementType,
      date: r.date?.toISOString?.() || '',
      updated: r.updatedDate?.toISOString?.() || '',
      confidence: r.confidence,
      inferred: r.inferred,
      source: r.source,
      title: r.title || '',
      src: r.src || '',
      linkUrl: r.linkUrl || '',
      text: r.container?.textContent?.trim().slice(0, 80) || ''
    };
  }

  function copyResults(results) {
    const data = results.map(resultToPlain);
    const text = JSON.stringify(data, null, 2);
    navigator.clipboard?.writeText(text).catch(() => {});
    flashChipMsg('Copied!');
  }

  function buildExportPayload() {
    return {
      url: location.href,
      title: document.title,
      scannedAt: new Date().toISOString(),
      pageDate: pageDateResult ? resultToPlain({ ...pageDateResult, elementType: 'page' }) : null,
      latestUpdate: latestUpdate?.toISOString() || null,
      wayback: waybackResult || null,
      scanned: scannedCounts,
      dated: datedCounts,
      elements: elementResults.map(resultToPlain),
      inspectHistory: clickHistory
    };
  }

  function downloadExport(format) {
    const payload = buildExportPayload();
    let content, mime, name;

    if (format === 'json') {
      content = JSON.stringify(payload, null, 2);
      mime = 'application/json';
      name = 'pagedate-scan.json';
    } else if (format === 'csv') {
      const rows = [['type', 'date', 'updated', 'confidence', 'inferred', 'source', 'title', 'src', 'linkUrl']];
      for (const e of payload.elements) {
        rows.push([e.type, e.date, e.updated, e.confidence, e.inferred, e.source, e.title, e.src, e.linkUrl]);
      }
      content = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      mime = 'text/csv';
      name = 'pagedate-scan.csv';
    } else {
      const lines = [
        `PageDate Timeline Report`,
        `URL: ${payload.url}`,
        `Title: ${payload.title}`,
        `Scanned: ${payload.scannedAt}`,
        `Page date: ${payload.pageDate?.date || '—'}`,
        `Latest update: ${payload.latestUpdate || '—'}`,
        `Wayback: ${payload.wayback?.url || '—'}`,
        `Dated elements: ${payload.dated.total}`,
        '',
        '--- Timeline (newest first) ---'
      ];
      const sorted = [...payload.elements].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      for (const e of sorted) {
        lines.push(`${e.date || '—'}  [${e.type}]  ${e.title || e.text || e.src || e.linkUrl || ''}  (conf ${e.confidence})`);
      }
      if (payload.inspectHistory.length) {
        lines.push('', '--- Click inspect history ---');
        for (const h of payload.inspectHistory) {
          lines.push(`${h.clickedAt}  ${h.noDate ? 'no date' : h.date}  ${h.linkUrl || h.selector || ''}`);
        }
      }
      content = lines.join('\n');
      mime = 'text/plain';
      name = 'pagedate-timeline.txt';
    }

    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    flashChipMsg('Exported!');
  }

  function clearInspectHistory() {
    clickHistory = [];
    elementResults = elementResults.filter((r) => !r.inspectHighlight);
    datedCounts = countLocalDated();
    render();
    flashChipMsg('Cleared');
  }

  function flashChipMsg(msg) {
    if (!pageChipEl) return;
    const el = pageChipEl.querySelector('#pd-error');
    el.style.display = 'block';
    el.style.color = '#2a7';
    el.textContent = msg;
    setTimeout(() => { el.style.display = 'none'; el.style.color = ''; }, 1800);
  }

  function fmtCounts(c) {
    return `📷${c.images} 📝${c.posts} 💬${c.text} 📦${c.containers}`;
  }

  function renderPageChip() {
    if (!settings.showPageDate) { if (pageChipEl) pageChipEl.style.display = 'none'; return; }
    if (!pageChipEl) { pageChipEl = createPageChip(); ensureRoot().appendChild(pageChipEl); }
    pageChipEl.style.display = '';

    const prefix = pageDateResult?.inferred ? '~' : '';
    const pageLabel = pageDateResult
      ? `${prefix}${formatDateTime(pageDateResult.date)}`
      : (isScanning || scanProgress < 100 ? 'Detecting…' : 'Not detected');
    pageChipEl.querySelector('#pd-page-date').textContent = pageLabel;
    pageChipEl.querySelector('#pd-scanned').textContent = fmtCounts(scannedCounts);
    pageChipEl.querySelector('#pd-dated').textContent = `${fmtCounts(datedCounts)} (${datedCounts.total})`;
    pageChipEl.querySelector('#pd-conf').textContent = confidenceLabel;

    const progWrap = pageChipEl.querySelector('#pd-progress-wrap');
    const progBar = pageChipEl.querySelector('#pd-progress-bar');
    const progLabel = pageChipEl.querySelector('#pd-progress-label');
    const showProgress = isScanning || batchRunning || scanProgress < 100;
    progWrap.style.display = showProgress ? '' : 'none';
    if (showProgress) {
      const total = refRegistry.size || scannedCounts.total || 0;
      const scrollPct = total > 0 ? Math.round((datedCounts.total / total) * 100) : 0;
      const pct = isScanning ? scanProgress : Math.max(scanProgress, Math.min(99, scrollPct));
      progBar.style.width = `${pct}%`;
      progLabel.textContent = isScanning ? scanPhase : (batchRunning ? `Finding more… ${datedCounts.total}/${total}` : scanPhase);
    }

    const updRow = pageChipEl.querySelector('#pd-updated-row');
    if (latestUpdate && isPlausibleDate(latestUpdate)) {
      updRow.style.display = '';
      pageChipEl.querySelector('#pd-updated').textContent = formatDateTime(latestUpdate);
    } else updRow.style.display = 'none';

    const wbRow = pageChipEl.querySelector('#pd-wayback-row');
    const wbLink = pageChipEl.querySelector('#pd-wayback');
    if (waybackLoading) {
      wbRow.style.display = '';
      wbLink.textContent = 'Checking…';
      wbLink.removeAttribute('href');
    } else if (waybackResult?.available) {
      wbRow.style.display = '';
      const wbDate = parseWaybackTimestamp(waybackResult.timestamp);
      wbLink.textContent = wbDate ? formatDateTime(wbDate) : waybackResult.timestamp;
      wbLink.href = waybackResult.url;
    } else {
      wbRow.style.display = 'none';
    }

    pageChipEl.querySelector('#pd-hint').style.display = settings.clickMode ? 'block' : 'none';

    const err = pageChipEl.querySelector('#pd-error');
    if (scanError) { err.style.display = 'block'; err.textContent = scanError; err.style.color = ''; }
    else if (err.style.color !== 'rgb(34, 170, 119)') err.style.display = 'none';
  }

  function showChipInstant() {
    ensureRoot();
    setProgress(5, 'PageDate ready…');
  }

  function ensureTooltip() {
    if (tooltipEl?.isConnected) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'pagedate-tooltip';
    tooltipEl.style.display = 'none';
    ensureRoot().appendChild(tooltipEl);
    return tooltipEl;
  }

  function showTooltip(e, result) {
    const tip = ensureTooltip();
    const labels = D().sourceLabel(result.source, result.method);
    const updated = result.updatedDate
      ? `<div class="pagedate-tooltip-row"><strong>Updated:</strong> ${formatDateTime(result.updatedDate)}</div>` : '';
    tip.innerHTML = `
      <div class="pagedate-tooltip-row"><strong>Published:</strong> ${formatDateTime(result.date)}</div>
      ${updated}
      <div class="pagedate-tooltip-row"><strong>Source:</strong> ${labels.source}</div>
      <div class="pagedate-tooltip-row"><strong>Confidence:</strong> ${result.confidence.toFixed(2)}</div>
      ${result.inferred ? '<div class="pagedate-tooltip-inferred">Inferred from metadata or server headers</div>' : ''}`;
    tip.style.display = 'block';
    moveTooltip(e);
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  function moveTooltip(e) {
    if (!tooltipEl || tooltipEl.style.display === 'none') return;
    let x = e.clientX + 12, y = e.clientY + 12;
    const r = tooltipEl.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 12;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - 12;
    tooltipEl.style.left = `${x}px`;
    tooltipEl.style.top = `${y}px`;
  }

  function isInViewport(el) {
    const r = el.getBoundingClientRect();
    return r.bottom > -50 && r.top < window.innerHeight + 50 && r.width > 0 && r.height > 0;
  }

  function positionBadge(badge, container, result) {
    if (!container?.isConnected) { badge.style.display = 'none'; return; }
    if (settings.clickMode && !result.inspectHighlight) { badge.style.display = 'none'; return; }
    const rect = container.getBoundingClientRect();
    if (rect.width < 1 && rect.height < 1) { badge.style.display = 'none'; return; }

    if (!isInViewport(container)) { badge.style.display = 'none'; return; }
    badge.style.display = '';

    const type = result.elementType || 'container';
    const inset = 6;
    let top, left;
    if (type === 'image') { top = rect.top + inset; left = rect.left + inset; }
    else if (type === 'text') { top = rect.bottom - 22 - inset; left = rect.left + inset; }
    else { top = rect.top + inset; left = rect.right - (badge.offsetWidth || 110) - inset; }

    top = Math.max(4, Math.min(top, window.innerHeight - 24));
    left = Math.max(4, Math.min(left, window.innerWidth - 110));
    badge.style.top = `${top}px`;
    badge.style.left = `${left}px`;
  }

  const updatePositions = throttle(() => {
    badgeMap.forEach((entry, container) => positionBadge(entry.badge, container, entry.result));
  }, POSITION_THROTTLE_MS);

  function renderBadges() {
    const root = ensureRoot();
    badgeMap.forEach((e) => e.badge.remove());
    badgeMap.clear();
    if (!settings.enabled || settings.clickMode) return;

    for (const result of elementResults) {
      if (!result.container?.isConnected) continue;
      const badge = createBadge(result);
      root.appendChild(badge);
      badgeMap.set(result.container, { badge, result });
      positionBadge(badge, result.container, result);
    }
    setupLazyObserver();
  }

  function setupLazyObserver() {
    if (lazyObserver) lazyObserver.disconnect();
    lazyObserver = new IntersectionObserver(() => updatePositions(), {
      rootMargin: '80px',
      threshold: 0.01
    });
    elementResults.forEach((r) => { if (r.container) lazyObserver.observe(r.container); });
    document.querySelectorAll('img[data-pd-ref]').forEach((img) => lazyObserver.observe(img));
  }

  function cleanup() {
    setClickMode(false);
    if (lazyObserver) lazyObserver.disconnect();
    badgeMap.forEach((e) => e.badge.remove());
    badgeMap.clear();
    if (pageChipEl) { pageChipEl.remove(); pageChipEl = null; }
    if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
    if (rootEl) { rootEl.remove(); rootEl = null; }
    X().untagElements();
  }

  function render() {
    if (!settings.enabled) { cleanup(); return; }
    setClickMode(settings.clickMode);
    renderPageChip();
    renderBadges();
  }

  function mergeResults(existing, incoming) {
    const map = new Map();
    for (const r of existing) {
      const fp = resultFingerprint(r);
      map.set(fp, r);
    }
    for (const r of incoming) {
      if (!r?.container && !r?.src) continue;
      const fp = resultFingerprint(r);
      map.set(fp, r);
    }
    return [...map.values()];
  }

  async function scan(force = false) {
    if (isScanning || !settings.enabled) return;
    if (!force && Date.now() - lastScanTime < MIN_RESCAN_MS) return;

    isScanning = true;
    scanError = null;
    scanProgress = 0;
    refRegistry.clear();
    processedRefs.clear();
    processedFingerprints.clear();
    elementResults = [];
    showChipInstant();
    fetchWayback();

    setProgress(15, 'Tagging elements…');
    const payload = X().buildSnapshot(getAnalyzeOptions());
    registerRefs(payload.refs);
    registerRefs(X().getAllRefs());
    scannedCounts = normalizeCounts(payload.scanned);
    cmsType = D().detectCMS();
    setProgress(30, 'Checking page date…');
    pageDateResult = await resolvePageDateWithRetry();
    if (pageDateResult?.date) {
      const d = sanitizeDate(pageDateResult.date);
      if (!d) pageDateResult = null;
      else pageDateResult.date = d;
    }
    confidenceLabel = pageDateResult ? confidenceLevel(pageDateResult.confidence) : '—';
    renderPageChip();

    try {
      if (!settings.apiKey) {
        scanError = 'API key required';
        render();
        return;
      }

      setProgress(45, 'Analyzing page…');
      const response = await apiScan(payload);
      lastScanTime = Date.now();
      setProgress(70, 'Processing results…');

      if (!response.ok) {
        scanError = response.status === 403
          ? 'Invalid API key — paste Render API_KEY in extension popup'
          : response.status === 429
          ? 'Daily limit — click Reset in popup'
          : (response.error || 'Server unreachable — is backend running?');
        elementResults = matchServerElements([]);
        datedCounts = countLocalDated();
        render();
        return;
      }

      const data = response.data;
      cmsType = data.cms || cmsType;
      if (data.pageDate) {
        const pd = fromServerResult(data.pageDate);
        if (pd) pageDateResult = pd;
      }
      else if (!pageDateResult) pageDateResult = await resolvePageDateWithRetry();
      confidenceLabel = data.confidenceLabel || confidenceLevel(pageDateResult?.confidence || 0);
      scannedCounts = normalizeCounts(data.scanned);
      elementResults = dedupeResults(matchServerElements(data.elements || []));
      markProcessedFromResults(elementResults);
      datedCounts = countLocalDated();
      updateLatestUpdate();
      scanError = null;
      render();

      setProgress(85, 'Probing images…');
      await probeImagesFromBrowser();
      markProcessedFromResults(elementResults);
      setProgress(100, 'Initial scan done');
      scheduleProgressiveScan();
    } finally {
      isScanning = false;
      if (!pageDateResult) {
        const local = await D().resolvePageDate({ deepScan: true });
        if (local?.date) {
          const d = sanitizeDate(local.date);
          if (d) {
            pageDateResult = { ...local, date: d };
            confidenceLabel = confidenceLevel(local.confidence);
          }
        }
      }
      if (!batchRunning) scanPhase = 'Done — scroll for more';
      renderPageChip();
    }
  }

  const scheduleProgressiveScan = debounce(() => runProgressiveBatch(), BATCH_DEBOUNCE);

  async function runProgressiveBatch() {
    if (batchRunning || !settings.apiKey || isScanning) return;

    const undated = getUndatedRefsInView();
    if (!undated.length) return;

    batchRunning = true;
    scanPhase = `Finding more… ${datedCounts.total}/${refRegistry.size || scannedCounts.total}`;
    renderPageChip();
    for (const info of undated) {
      const el = document.querySelector(`[data-pd-ref="${info.ref}"]`);
      markRefAttempted(info, el);
    }

    try {
      const payload = X().buildBatchPayload(undated);
      const response = await apiScan(payload);

      if (response.ok && response.data.elements?.length) {
        applyResults(matchServerElements(response.data.elements));
        render();
      }

      const remaining = getUndatedRefsInView(1);
      if (remaining.length) scheduleProgressiveScan();
    } finally {
      batchRunning = false;
      if (!isScanning) scanPhase = 'Done — scroll for more';
      renderPageChip();
    }
  }

  function probeImagesFromBrowser() {
    return new Promise((resolve) => {
      const datedSrcs = new Set(
        elementResults.filter((e) => e.elementType === 'image').map((e) => normSrc(e.src))
      );
      const urls = [...document.querySelectorAll('img')]
        .map((img) => ({ src: normSrc(X().getImgSrc(img)), img }))
        .filter(({ src, img }) => src && !datedSrcs.has(src) && !isElementAlreadyDated(img, { src }))
        .slice(0, 25)
        .map(({ src }) => src);

      if (!urls.length) { resolve(); return; }

      chrome.runtime.sendMessage({ type: 'PROBE_IMAGES', urls, referer: location.href }, (response) => {
        if (response?.ok && response.elements?.length) {
          applyResults(matchServerElements(response.elements));
          render();
        }
        resolve();
      });
    });
  }

  const probeLazyImages = debounce(async () => {
    const newRefs = X().tagNewImages();
    if (newRefs.length) {
      registerRefs(newRefs);
      const allRefs = X().getAllRefs();
      scannedCounts = normalizeCounts({
        images: allRefs.filter((r) => r.type === 'image').length,
        posts: allRefs.filter((r) => r.type === 'post').length,
        text: allRefs.filter((r) => r.type === 'text').length,
        containers: allRefs.filter((r) => r.type === 'container').length,
        total: allRefs.length
      });
      renderPageChip();
    }

    scheduleProgressiveScan();

    const datedSrcs = new Set(elementResults.filter((e) => e.src).map((e) => normSrc(e.src)));
    const urls = X().getNewUntaggedImages().filter((s) => !datedSrcs.has(normSrc(s)));
    if (!urls.length || !settings.apiKey) return;

    const response = await apiScan({
      url: location.href,
      mode: 'images',
      imageUrls: urls.slice(0, 20)
    });

    if (response.ok && response.data.elements?.length) {
      applyResults(matchServerElements(response.data.elements));
      render();
    }
  }, LAZY_IMG_DEBOUNCE);

  function hookHistory() {
    const ps = history.pushState, rs = history.replaceState;
    history.pushState = function (...a) { ps.apply(this, a); onRouteChange(); };
    history.replaceState = function (...a) { rs.apply(this, a); onRouteChange(); };
    window.addEventListener('popstate', onRouteChange);
    window.addEventListener('hashchange', onRouteChange);
  }

  function onRouteChange() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastScanTime = 0;
      elementResults = [];
      refRegistry.clear();
      processedRefs.clear();
      processedFingerprints.clear();
      clickHistory = [];
      waybackResult = null;
      cleanup();
      showChipInstant();
      fetchWayback();
      scan(true);
    }
  }

  function observeDOM() {
    new MutationObserver(throttle(() => {
      updatePositions();
      probeLazyImages();
      scheduleProgressiveScan();
    }, 800)).observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  function loadSettings(cb) {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
      settings = { ...DEFAULT_SETTINGS, ...stored };
      if (stored.hoverMode !== undefined) settings.clickMode = stored.hoverMode;
      settings.apiKey = (settings.apiKey || '').trim();
      settings.apiUrl = DEFAULT_SETTINGS.apiUrl;
      if (cb) cb();
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'RESCAN') {
      lastScanTime = 0;
      elementResults = [];
      refRegistry.clear();
      processedRefs.clear();
      processedFingerprints.clear();
      scan(true);
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === 'SETTINGS_CHANGED') {
      loadSettings(() => render());
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === 'GET_PAGE_STATUS') {
      sendResponse({
        pageDate: pageDateResult ? { date: pageDateResult.date.toISOString(), inferred: pageDateResult.inferred } : null,
        scanned: scannedCounts,
        dated: datedCounts,
        cms: cmsType,
        confidenceLabel,
        scanError
      });
      return true;
    }
  });

  function init() {
    showChipInstant();
    loadSettings(() => {
      if (!settings.enabled) { cleanup(); return; }
      hookHistory();
      window.addEventListener('scroll', () => {
        updatePositions();
        probeLazyImages();
        scheduleProgressiveScan();
      }, { passive: true });
      window.addEventListener('resize', updatePositions, { passive: true });

      const startOnce = () => {
        if (started) return;
        started = true;
        observeDOM();
        scan(true);
      };

      if (document.readyState === 'complete') setTimeout(startOnce, 400);
      else window.addEventListener('load', () => setTimeout(startOnce, 500));
      if (document.body) document.addEventListener('DOMContentLoaded', () => setTimeout(startOnce, 300));
    });
  }

  init();
})();
