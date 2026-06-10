export function detectCMS({ html = '', url = '', cmsHints = {} } = {}) {
  const text = (html + url).toLowerCase();
  const hints = cmsHints.signals || [];

  if (
    hints.includes('wp-json') ||
    text.includes('/wp-json/') ||
    text.includes('wp-content') ||
    text.includes('wordpress')
  ) {
    return 'WordPress';
  }

  if (
    hints.includes('shopify') ||
    text.includes('cdn.shopify.com') ||
    text.includes('shopify') ||
    url.includes('?variant=')
  ) {
    return 'Shopify';
  }

  if (hints.includes('elementor') || text.includes('elementor')) {
    return 'Elementor';
  }

  if (text.includes('webflow')) return 'Webflow';
  if (text.includes('squarespace')) return 'Squarespace';
  if (text.includes('ghost')) return 'Ghost';

  return 'generic';
}

export function extractOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
