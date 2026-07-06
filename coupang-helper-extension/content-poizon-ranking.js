// ============================================================
// content-poizon-ranking.js — POIZON(kr.poizon.com) 랭킹/신상 페이지 패시브 정찰 리더 (v8.11.1)
// ============================================================
// 원칙: 유저가 "직접 연" 랭킹/신상 페이지에 이미 로드된 상품만 읽어 공유 풀에 적립.
//   페이지를 프로그램이 순회하지 않음(능동 크롤 X) → 밴 리스크 최소.
// ★ kr.poizon.com은 원(₩) + "거래 N만/천" 형식 + 한글 상품명. (dewu 위안 아님)
// ⚠️ DOM은 변동이 잦고 안티-devtools가 있어 클래스명 대신 innerText 방어적 파싱.
(function () {
  "use strict";
  let lastSig = "";

  // "60,700" → 60700
  function wonToNum(s) {
    const m = String(s || "").replace(/[,\s]/g, "").match(/([0-9]+)/);
    return m ? parseInt(m[1], 10) : 0;
  }
  // 거래량: "거래 1.4만"→14000, "거래 993"→993, "거래 1천"→1000, "406K sold"→406000, "1M sold"→1000000
  function parseVolume(txt) {
    const s = String(txt || "");
    const ko = s.match(/거래\s*([0-9]+(?:\.[0-9]+)?)\s*(만|천)?/);
    if (ko) {
      const unit = ko[2] === "만" ? 10000 : ko[2] === "천" ? 1000 : 1;
      return Math.round(parseFloat(ko[1]) * unit);
    }
    const en = s.match(/([0-9]+(?:\.[0-9]+)?)\s*([KMkm])?\s*sold/i);
    if (en) {
      const u = /k/i.test(en[2] || "") ? 1000 : /m/i.test(en[2] || "") ? 1000000 : 1;
      return Math.round(parseFloat(en[1]) * u);
    }
    return 0;
  }
  // 텍스트에서 원(₩) 가격들 추출 (할인가/정상가 순서로 등장)
  function parseWonPrices(txt) {
    const out = [];
    const re = /([0-9][0-9,]{2,})\s*원/g;
    let m;
    while ((m = re.exec(txt))) {
      const v = wonToNum(m[1]);
      if (v >= 1000 && v < 100000000) out.push(v);
    }
    return out;
  }

  function pageContext() {
    const body = (document.body && document.body.innerText) || "";
    // 홈·카테고리·검색 등 리스트형 페이지 모두 대상(카드 5개 미만이면 어차피 스킵).
    const isNew = /new|上新|신상/i.test(location.href) || /신상|NEW/.test(body.slice(0, 400));
    return { isRanking: true, isNew, category: (document.title || "").trim().slice(0, 80) };
  }

  // 카드 후보 수집 (원 가격 + 상품명 텍스트를 가진 반복 구조)
  function collectCards() {
    const out = [];
    const seen = new Set();
    const sel =
      '[class*="item" i], [class*="card" i], [class*="product" i], [class*="goods" i], li, a[href*="/product"], a[href*="/pd/"]';
    const nodes = document.querySelectorAll(sel);
    for (const el of nodes) {
      const txt = (el.innerText || "").trim();
      if (!txt || txt.length < 4 || txt.length > 400) continue;
      const prices = parseWonPrices(txt);
      if (!prices.length) continue; // 원 가격 신호 없으면 상품카드 아님
      const salePrice = prices[0]; // 첫 값 = 표시가(할인가)
      // 상품명: 가격/거래 라인 제외한 가장 긴 라인
      const lines = txt.split(/\n+/).map(s => s.trim()).filter(Boolean);
      const name = lines
        .filter(l => !/원|거래|리뷰|판매/.test(l) || l.replace(/[0-9,원\s]/g, "").length > 3)
        .filter(l => !/^\s*[0-9,]+\s*원/.test(l))
        .sort((a, b) => b.length - a.length)[0];
      if (!name || name.replace(/[0-9,.\s원]/g, "").length < 2) continue;
      const key = name.slice(0, 60) + "|" + salePrice;
      if (seen.has(key)) continue;
      seen.add(key);
      const img = el.querySelector && el.querySelector("img");
      out.push({
        productName: name.slice(0, 300),
        priceCny: salePrice, // (필드명 유지, 값은 원화)
        soldCount: parseVolume(txt),
        imageUrl: img && img.src ? img.src.slice(0, 1000) : undefined,
      });
      if (out.length >= 100) break;
    }
    return out;
  }

  function parseAndSend() {
    try {
      const ctx = pageContext();
      if (!ctx.isRanking && !ctx.isNew) return;
      const cards = collectCards();
      if (cards.length < 5) return; // 리스트 신호 부족 → 단일상품 리더가 처리
      const sig = ctx.category + "|" + cards.length + "|" + cards[0].productName;
      if (sig === lastSig) return;
      lastSig = sig;
      const items = cards.map((c, i) => ({
        ...c,
        rankPos: i + 1,
        isNew: ctx.isNew,
        trendingScore: ctx.isRanking ? Math.max(0, 100 - i) : 0,
      }));
      chrome.runtime
        .sendMessage({ type: "SUBMIT_POIZON_TRENDING", data: { category: ctx.category, items } })
        .catch(() => {});
    } catch (_) {}
  }

  let timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(parseAndSend, 3000); }
  schedule();
  let lastUrl = location.href;
  setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; schedule(); } }, 2500);
})();
