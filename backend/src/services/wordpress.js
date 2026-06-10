import { makeResult, parseDate, pickBest } from './parser.js';

const FETCH_TIMEOUT = 8000;

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'PageDate-Scanner/1.0' }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function slugFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
}

function postIdFromHtml(html) {
  const m = html.match(/class="[^"]*\bpostid-(\d+)\b/);
  return m?.[1] || null;
}

export async function extractWordPress(url, html) {
  const origin = new URL(url).origin;
  const apiBase = `${origin}/wp-json/wp/v2/`;
  const slug = slugFromUrl(url);
  const postId = postIdFromHtml(html);
  const results = [];
  const elements = [];

  const urls = [];
  if (postId) {
    urls.push(`${apiBase}posts/${postId}`);
    urls.push(`${apiBase}pages/${postId}`);
  }
  if (slug) {
    urls.push(`${apiBase}posts?slug=${encodeURIComponent(slug)}`);
    urls.push(`${apiBase}pages?slug=${encodeURIComponent(slug)}`);
  }

  for (const apiUrl of urls) {
    const data = await fetchJson(apiUrl);
    if (!data) continue;

    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      const published = parseDate(item.date || item.date_gmt);
      const modified = parseDate(item.modified || item.modified_gmt);

      if (published) {
        results.push(makeResult(published, 'cms-api', 0.93, 'tier3', {
          cms: 'WordPress',
          author: item._embedded?.author?.[0]?.name,
          modified: modified?.toISOString(),
          title: item.title?.rendered?.replace(/<[^>]+>/g, '')
        }));
      }

      elements.push(makeResult(published || modified, 'cms-api', 0.88, 'tier3', {
        cms: 'WordPress',
        title: item.title?.rendered?.replace(/<[^>]+>/g, '')?.slice(0, 80)
      }));

      if (results.length) break;
    }
    if (results.length) break;
  }

  return {
    pageDate: pickBest(results),
    elements: elements.filter((e) => e.date).slice(0, 80)
  };
}
