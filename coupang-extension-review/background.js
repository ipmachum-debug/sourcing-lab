chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'SEARCH_RESULTS_PARSED' && sender.tab?.id) {
    const tabId = sender.tab.id;
    const payload = {
      tabId,
      url: sender.tab.url,
      title: sender.tab.title,
      query: message.query || '',
      count: Array.isArray(message.items) ? message.items.length : 0,
      items: message.items || [],
      capturedAt: new Date().toISOString()
    };

    chrome.storage.session.set({ [`results:${tabId}`]: payload });
    chrome.runtime.sendMessage({ type: 'RESULTS_UPDATED', tabId }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'GET_RESULTS_FOR_TAB') {
    const key = `results:${message.tabId}`;
    chrome.storage.session.get([key]).then((obj) => {
      sendResponse({ ok: true, data: obj[key] || null });
    });
    return true;
  }
});
