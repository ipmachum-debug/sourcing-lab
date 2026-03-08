(function () {
  const MAX_ITEMS = 20;
  let debounceTimer = null;
  let lastSignature = '';

  function text(el) {
    return (el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function getQuery() {
    const url = new URL(location.href);
    return url.searchParams.get('q') || document.querySelector('input[type="search"]')?.value || '';
  }

  function parseProducts() {
    const products = [];

    const candidateSelectors = [
      'li.search-product',
      'li[class*="search-product"]',
      '[data-sentry-component="ProductUnit"]',
      'div[class*="search-product"]'
    ];

    const nodes = Array.from(document.querySelectorAll(candidateSelectors.join(',')));

    for (const node of nodes) {
      if (products.length >= MAX_ITEMS) break;

      const linkEl = node.querySelector('a[href*="/vp/products/"]') || node.querySelector('a.search-product-link');
      const titleEl = node.querySelector('.name') || node.querySelector('[class*="name"]') || linkEl;
      const priceEl = node.querySelector('.price-value') || node.querySelector('[class*="price"]');
      const ratingEl = node.querySelector('.rating') || node.querySelector('[class*="rating"]');
      const reviewEl = node.querySelector('.rating-total-count') || node.querySelector('[class*="review"]');
      const imageEl = node.querySelector('img');

      const href = linkEl?.href || '';
      if (!href) continue;

      const productIdMatch = href.match(/\/vp\/products\/(\d+)/);
      const productId = productIdMatch ? productIdMatch[1] : null;
      const item = {
        productId,
        title: text(titleEl),
        price: text(priceEl),
        rating: text(ratingEl),
        reviewCount: text(reviewEl).replace(/[()]/g, ''),
        url: href,
        imageUrl: imageEl?.src || imageEl?.getAttribute('data-img-src') || '',
        position: products.length + 1,
        query: getQuery()
      };

      if (!item.title && !item.price) continue;
      products.push(item);
    }

    return products;
  }

  function publishResults() {
    const items = parseProducts();
    const query = getQuery();
    const signature = JSON.stringify({ query, ids: items.map(i => i.productId || i.url) });

    if (signature === lastSignature) return;
    lastSignature = signature;

    chrome.runtime.sendMessage({
      type: 'SEARCH_RESULTS_PARSED',
      query,
      items
    }).catch(() => {});
  }

  function schedulePublish() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(publishResults, 600);
  }

  const observer = new MutationObserver(() => schedulePublish());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener('load', schedulePublish);
  document.addEventListener('visibilitychange', schedulePublish);
  schedulePublish();
})();
