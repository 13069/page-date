(() => {
  'use strict';

  const MAX_HTML = 350_000;
  const MAX_PER_TYPE = { image: 800, post: 400, text: 400, container: 200 };
  const MAX_REF_HTML = 8000;

  function resolveUrl(src, base) {
    if (!src || src.startsWith('data:')) return '';
    try { return new URL(src, base || location.href).href; } catch { return src; }
  }

  function getImgSrc(img) {
    return resolveUrl(
      img.currentSrc || img.src ||
      img.getAttribute('data-src') ||
      img.getAttribute('data-lazy-src') ||
      img.getAttribute('data-original') ||
      img.getAttribute('data-url') || '',
      location.href
    );
  }

  function getLinkUrl(el) {
    const a = el.closest?.('a[href]') || el.querySelector?.('a[href]');
    if (!a) return '';
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return '';
    return resolveUrl(href, location.href);
  }

  function isInDocument(el) {
    return el?.isConnected && !el.closest('#pagedate-root');
  }

  function detectType(el) {
    const tag = el.tagName?.toLowerCase();
    if (tag === 'img' || el.querySelector('img')) return 'image';
    if (tag === 'article' || el.matches?.('.post, .card, .entry, .node, .listing-item, [class*="ad-item"], [class*="listing"]')) return 'post';
    if (el.matches?.('.comment, .comment-body, [class*="comment"]')) return 'comment';
    if (el.matches?.('.published-date, .published-time, .main-article-date, .ad-publish-info-area, [class*="publish"], [class*="article-date"], time, bdi')) return 'text';
    if (['p', 'span', 'blockquote', 'li', 'h1', 'h2', 'h3', 'h4', 'a', 'bdi'].includes(tag)) return 'text';
    return 'container';
  }

  function refHtml(el) {
    try { return el.outerHTML.slice(0, MAX_REF_HTML); } catch { return ''; }
  }

  function clearTags() {
    document.querySelectorAll('[data-pd-ref]').forEach((el) => el.removeAttribute('data-pd-ref'));
  }

  function collectCmsHints() {
    const html = document.documentElement.innerHTML.slice(0, 50000).toLowerCase();
    const signals = [];
    if (html.includes('/wp-json/') || html.includes('wp-content') || html.includes('sites/default/files')) signals.push('wp-json');
    if (html.includes('drupal') || html.includes('sites/default')) signals.push('drupal');
    if (html.includes('shopify')) signals.push('shopify');
    if (html.includes('elementor')) signals.push('elementor');
    return { signals, url: location.href };
  }

  function countRefs(refs) {
    return {
      images: refs.filter((r) => r.type === 'image').length,
      posts: refs.filter((r) => r.type === 'post').length,
      text: refs.filter((r) => r.type === 'text').length,
      containers: refs.filter((r) => r.type === 'container').length,
      total: refs.length
    };
  }

  function tagElements(analyze = {}, { preserve = false } = {}) {
    if (!preserve) clearTags();
    const refs = [];
    let idx = document.querySelectorAll('[data-pd-ref]').length;

    const tagged = new Set([...document.querySelectorAll('[data-pd-ref]')]);

    const tag = (el, type, extra = {}) => {
      if (!isInDocument(el) || tagged.has(el)) return;
      const cap = MAX_PER_TYPE[type] || 300;
      if (refs.filter((r) => r.type === type).length >= cap) return;
      const ref = `pd-${idx++}`;
      el.setAttribute('data-pd-ref', ref);
      tagged.add(el);
      refs.push({ ref, type, html: refHtml(el), ...extra });
    };

    if (analyze.posts !== false) {
      document.querySelectorAll('.ad-publish-info-area, [class*="publish-info"], .published-date, .main-article-date').forEach((el) => {
        const card = el.closest(
          '[class*="ad"], [class*="listing"], [class*="oglas"], article, .card, .post, li, .row > div, .item, main'
        ) || el.parentElement?.parentElement || el;
        tag(card, el.matches?.('.main-article-date, .published-date') ? 'text' : 'post', {
          title: card.querySelector?.('h1,h2,h3,h4,.title,a')?.textContent?.trim().slice(0, 80) || el.textContent?.trim().slice(0, 80) || '',
          text: el.textContent?.trim().slice(0, 120) || ''
        });
      });
    }

    if (analyze.images !== false) {
      document.querySelectorAll('img').forEach((img) => {
        const src = getImgSrc(img);
        if (!src) return;
        tag(img, 'image', {
          alt: img.alt?.slice(0, 100) || '',
          src,
          linkUrl: getLinkUrl(img)
        });
      });
    }

    if (analyze.posts !== false) {
      document.querySelectorAll(
        'article, [role="article"], .post, .card, .entry, .blog-post, .listing-item, .node, .views-row, .product, [class*="ad-item"], [class*="listing-card"], [class*="oglas"], [class*="AdCard"]'
      ).forEach((el) => {
        tag(el, 'post', {
          title: el.querySelector('h1,h2,h3,h4,.title')?.textContent?.trim().slice(0, 80) || '',
          linkUrl: getLinkUrl(el)
        });
      });
    }

    if (analyze.text !== false) {
      document.querySelectorAll(
        'p, blockquote, .excerpt, li, .comment-body, [class*="comment"], time, .main-article-date, [class*="article-date"], bdi'
      ).forEach((el) => {
        tag(el, 'text', { text: el.textContent?.trim().slice(0, 120) || '' });
      });
    }

    if (analyze.containers !== false) {
      document.querySelectorAll('section, main > div, .content, [class*="block"], [class*="region"]').forEach((el) => {
        if (el.closest('article, .post, .listing-item, [class*="ad-item"]')) return;
        tag(el, 'container', {
          title: el.querySelector('h1,h2,h3')?.textContent?.trim().slice(0, 60) || ''
        });
      });
    }

    return refs;
  }

  function getAllRefs() {
    const refs = [];
    document.querySelectorAll('[data-pd-ref]').forEach((el) => {
      const ref = el.getAttribute('data-pd-ref');
      const type = detectType(el);
      const img = el.tagName === 'IMG' ? el : el.querySelector('img');
      refs.push({
        ref,
        type,
        html: refHtml(el),
        src: img ? getImgSrc(img) : undefined,
        alt: img?.alt?.slice(0, 100) || '',
        linkUrl: getLinkUrl(el),
        text: el.textContent?.trim().slice(0, 120) || '',
        title: el.querySelector?.('h1,h2,h3,h4,.title')?.textContent?.trim().slice(0, 80) || ''
      });
    });
    return refs;
  }

  function buildSnapshot(analyze = {}) {
    const refs = tagElements(analyze);
    const clone = document.body?.cloneNode(true);
    if (clone) {
      clone.querySelectorAll('#pagedate-root, script, noscript, iframe').forEach((el) => el.remove());
    }

    let html = clone ? `<body>${clone.innerHTML}</body>` : '';
    if (html.length > MAX_HTML) html = html.slice(0, MAX_HTML);

    return {
      url: location.href,
      html,
      meta: {
        title: document.title || '',
        description: document.querySelector('meta[name="description"]')?.content || ''
      },
      cmsHints: collectCmsHints(),
      refs,
      scanned: countRefs(refs),
      analyze: {
        images: analyze.images !== false,
        posts: analyze.posts !== false,
        text: analyze.text !== false,
        containers: analyze.containers !== false
      },
      mode: 'deep'
    };
  }

  function buildBatchPayload(refs) {
    return {
      url: location.href,
      refs: refs.map((r) => {
        const el = document.querySelector(`[data-pd-ref="${r.ref}"]`);
        return {
          ...r,
          html: el ? refHtml(el) : r.html,
          linkUrl: r.linkUrl || (el ? getLinkUrl(el) : '')
        };
      }),
      cmsHints: collectCmsHints(),
      mode: 'batch'
    };
  }

  function buildElementSnapshot(el) {
    document.querySelectorAll('[data-pd-ref^="pd-click-"]').forEach((node) => {
      node.removeAttribute('data-pd-ref');
    });
    const type = detectType(el);
    const ref = 'pd-click-0';
    el.setAttribute('data-pd-ref', ref);
    const img = el.tagName === 'IMG' ? el : el.querySelector('img');
    const src = img ? getImgSrc(img) : '';
    const linkUrl = getLinkUrl(el);
    const html = `<body>${el.outerHTML}</body>`;

    return {
      url: location.href,
      html,
      elementHtml: html,
      inspectUrl: src || linkUrl || null,
      linkUrl: linkUrl || null,
      meta: { title: document.title || '' },
      cmsHints: collectCmsHints(),
      refs: [{ ref, type, src, linkUrl, html: refHtml(el), alt: img?.alt || '', text: el.textContent?.trim().slice(0, 120) }],
      mode: 'inspect'
    };
  }

  function getNewUntaggedImages() {
    const urls = [];
    document.querySelectorAll('img:not([data-pd-ref])').forEach((img) => {
      const src = getImgSrc(img);
      if (src) urls.push(src);
    });
    return urls;
  }

  function tagNewImages() {
    return tagElements({ images: true, posts: false, text: false, containers: false }, { preserve: true });
  }

  function untagElements() { clearTags(); }

  window.PageDateExtractor = {
    buildSnapshot,
    buildBatchPayload,
    buildElementSnapshot,
    collectCmsHints,
    tagElements,
    untagElements,
    clearTags,
    detectType,
    countRefs,
    getAllRefs,
    getImgSrc,
    getLinkUrl,
    getNewUntaggedImages,
    tagNewImages,
    resolveUrl
  };
})();
