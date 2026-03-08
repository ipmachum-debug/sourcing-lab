async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function getResults(tabId) {
  return chrome.runtime.sendMessage({ type: 'GET_RESULTS_FOR_TAB', tabId });
}

function render(data) {
  const summary = document.getElementById('summary');
  const results = document.getElementById('results');
  const tpl = document.getElementById('itemTemplate');
  results.innerHTML = '';

  if (!data || !Array.isArray(data.items) || data.items.length === 0) {
    summary.textContent = '쿠팡 검색 결과를 열면 여기에 상품이 표시됩니다.';
    return;
  }

  summary.textContent = `검색어: ${data.query || '-'} · ${data.count}개 감지 · ${new Date(data.capturedAt).toLocaleTimeString()}`;

  for (const item of data.items) {
    const node = tpl.content.cloneNode(true);
    node.querySelector('.position').textContent = `#${item.position} · 상품ID ${item.productId || '-'}`;
    node.querySelector('.title').textContent = item.title || '(제목 없음)';
    node.querySelector('.sub').textContent = `가격 ${item.price || '-'} / 평점 ${item.rating || '-'} / 리뷰 ${item.reviewCount || '-'}`;
    const link = node.querySelector('.link');
    link.href = item.url;
    results.appendChild(node);
  }
}

async function refreshFromCurrentTab() {
  const tab = await getActiveTab();
  if (!tab?.id) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        document.dispatchEvent(new Event('visibilitychange'));
      }
    });
  } catch (e) {
    console.warn(e);
  }

  const response = await getResults(tab.id);
  render(response?.data || null);
}

chrome.runtime.onMessage.addListener(async (message) => {
  if (message?.type === 'RESULTS_UPDATED') {
    const tab = await getActiveTab();
    if (tab?.id === message.tabId) {
      const response = await getResults(tab.id);
      render(response?.data || null);
    }
  }
});

document.getElementById('refreshBtn').addEventListener('click', refreshFromCurrentTab);
refreshFromCurrentTab();
