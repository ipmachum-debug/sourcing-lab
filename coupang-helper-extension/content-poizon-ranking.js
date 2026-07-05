// ============================================================
// content-poizon-ranking.js — POIZON 랭킹/신상 페이지 패시브 정찰 리더 (v8.11)
// ============================================================
// 원칙: 유저가 "직접 연" 랭킹/신상 페이지에 이미 로드된 상품만 읽어 공유 풀에 적립.
//   페이지를 프로그램이 순회하지 않음(능동 크롤 X) → 밴 리스크 최소.
// ⚠️ POIZON DOM은 변동이 잦아 셀렉터는 실제 페이지 기준 튜닝 필요(방어적 기본값).
(function () {
  "use strict";
  let lastSig = "";

  function toNum(s) {
    const m = String(s || "").replace(/[,\s]/g, "").match(/([0-9]+(?:\.[0-9]+)?)/);
    return m ? Math.round(parseFloat(m[1])) : 0;
  }

  // 랭킹/신상 페이지 신호 (URL·텍스트). 아니면 조용히 종료.
  function pageContext() {
    const url = location.href;
    const body = (document.body && document.body.innerText) || "";
    const isRanking = /rank|hot|热榜|热销|排行|list|category|brand|search/i.test(url);
    const isNew = /新品|new|上新|신상/i.test(url) || /新品|신상/.test(body.slice(0, 400));
    const catM = (document.title || "").trim().slice(0, 80);
    return { isRanking, isNew, category: catM };
  }

  // 카드 후보 수집 (¥ 가격 + 상품명 텍스트를 가진 반복 구조)
  function collectCards() {
    const out = [];
    const seen = new Set();
    const sel =
      '[class*="item" i], [class*="card" i], [class*="product" i], [class*="goods" i], li, a[href*="product"], a[href*="/pd/"]';
    const nodes = document.querySelectorAll(sel);
    for (const el of nodes) {
      const txt = (el.innerText || "").trim();
      if (!txt || txt.length < 4 || txt.length > 300) continue;
      const priceM = txt.match(/[¥￥]\s*([0-9][0-9,]{1,7})/);
      if (!priceM) continue; // 가격 신호 없는 건 상품 카드로 안 봄
      const priceCny = toNum(priceM[1]);
      if (priceCny < 10 || priceCny > 1000000) continue;
      // 상품명: 가장 긴 텍스트 라인(가격/판매량 라인 제외)
      const lines = txt.split(/\n+/).map(s => s.trim()).filter(Boolean);
      const name = lines
        .filter(l => !/[¥￥]|已售|월|판매|sold/i.test(l))
        .sort((a, b) => b.length - a.length)[0];
      if (!name || name.length < 3) continue;
      const key = name.slice(0, 60) + "|" + priceCny;
      if (seen.has(key)) continue;
      seen.add(key);
      const soldM = txt.match(/(?:已售|月销|판매|sold)\D{0,6}([0-9][0-9,]{0,6})/i);
      const img = el.querySelector && el.querySelector("img");
      out.push({
        productName: name.slice(0, 300),
        priceCny,
        soldCount: soldM ? toNum(soldM[1]) : 0,
        imageUrl: img && img.src ? img.src.slice(0, 1000) : undefined,
      });
      if (out.length >= 100) break;
    }
    return out;
  }

  function parseAndSend() {
    try {
      const ctx = pageContext();
      if (!ctx.isRanking && !ctx.isNew) return; // 랭킹/신상 페이지가 아니면 스킵
      const cards = collectCards();
      if (cards.length < 5) return; // 리스트 신호 부족(단일 상품 등) → content-poizon.js가 처리
      const sig = ctx.category + "|" + cards.length + "|" + cards[0].productName;
      if (sig === lastSig) return; // 같은 페이지 중복 방지
      lastSig = sig;
      const items = cards.map((c, i) => ({
        ...c,
        rankPos: i + 1, // 노출 순서를 순위로
        isNew: ctx.isNew,
        trendingScore: ctx.isRanking ? Math.max(0, 100 - i) : 0,
      }));
      chrome.runtime
        .sendMessage({ type: "SUBMIT_POIZON_TRENDING", data: { category: ctx.category, items } })
        .catch(() => {});
    } catch (_) {}
  }

  // 로드 + SPA URL 변화 시에만 (저빈도, 본 것만)
  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(parseAndSend, 3000);
  }
  schedule();

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      schedule();
    }
  }, 2500);
})();
