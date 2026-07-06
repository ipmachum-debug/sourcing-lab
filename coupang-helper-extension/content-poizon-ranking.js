// ============================================================
// content-poizon-ranking.js — POIZON(kr.poizon.com) 랭킹/신상/리스트 패시브 정찰 리더 (v8.11.2)
// ============================================================
// 원칙: 유저가 "직접 연/스크롤한" 리스트에 로드된 상품만 읽어 공유 풀에 적립.
//   능동 크롤·자동 네비게이션 없음 → 밴 리스크 최소.
// ★ kr.poizon: 원(₩) + "거래 N만/천" 또는 "406K sold" + 한글/영문 상품명.
// v8.11.2: SPA 카테고리 이동·스크롤 무한로드 재수집(델타) — 홈 1회에서 멈추던 문제 해결.
//   - lastSig 대신 sentKeys(본 페이지 내 이미 보낸 카드) 델타 방식
//   - location.href 폴링(1.5s) + MutationObserver + 스크롤 감지로 재발화
//   - SPA 지연 렌더 대응 로드 후 3·6·11초 재시도
// ⚠️ 안티-devtools 있어 클래스명 대신 innerText 방어 파싱.
(function () {
  "use strict";

  let sentKeys = new Set(); // 이 페이지에서 이미 보낸 카드 키
  let rankCounter = 0; // 노출 순서(스크롤 델타 누적)
  let lastUrl = location.href;

  function wonToNum(s) {
    const m = String(s || "").replace(/[,\s]/g, "").match(/([0-9]+)/);
    return m ? parseInt(m[1], 10) : 0;
  }
  // "거래 1.4만"→14000, "993"→993, "406K sold"→406000, "1M sold"→1000000
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

  // 카테고리: URL 슬러그만 대분류로 매핑. 판별 불가 시 "" (title 절대 사용 안 함).
  //   → 서버 탭은 대분류(운동화/신발/의류/가방/액세서리/장난감/뷰티)만 노출.
  function pickCategory() {
    const m = location.pathname.match(/\/category\/([a-z0-9-]+)/i);
    if (m) {
      const map = {
        sneakers: "운동화", shoes: "신발", clothing: "의류", clothes: "의류", apparel: "의류",
        bag: "가방", bags: "가방", accessories: "액세서리", accessory: "액세서리",
        toys: "장난감", toy: "장난감", beauty: "뷰티",
      };
      return map[m[1].toLowerCase()] || ""; // 모르는 슬러그는 태그 안 함
    }
    const q = new URLSearchParams(location.search).get("keyword") || new URLSearchParams(location.search).get("q");
    if (q) return "검색:" + q.slice(0, 30);
    return ""; // 홈·기타: 카테고리 불명 → 전체에만 노출
  }
  function isNewPage() {
    return /new|上新|신상/i.test(location.href) || /신상/.test((document.body && document.body.innerText || "").slice(0, 300));
  }

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
      if (!prices.length) continue;
      const salePrice = prices[0];
      const lines = txt.split(/\n+/).map(s => s.trim()).filter(Boolean);
      const name = lines
        .filter(l => !/^\s*[0-9,]+\s*원/.test(l))
        .filter(l => l.replace(/[0-9,.\s원거래만천sold%할인]/gi, "").length >= 2)
        .sort((a, b) => b.length - a.length)[0];
      if (!name) continue;
      const key = name.slice(0, 60) + "|" + salePrice;
      if (seen.has(key)) continue;
      seen.add(key);
      const img = el.querySelector && el.querySelector("img");
      out.push({
        productName: name.slice(0, 300),
        priceCny: salePrice, // 필드명 유지, 값은 원화
        soldCount: parseVolume(txt),
        imageUrl: img && img.src ? img.src.slice(0, 1000) : undefined,
        _key: key,
      });
      if (out.length >= 300) break;
    }
    return out;
  }

  // 새로 나타난 카드만 델타로 전송
  function scanAndSend() {
    try {
      const cards = collectCards();
      const fresh = cards.filter(c => !sentKeys.has(c._key));
      if (fresh.length < 3) return; // 유의미한 신규가 없으면 스킵(단일상품 오탐 방지)
      if (sentKeys.size > 1200) return; // 페이지당 상한(폭주 방지)
      const category = pickCategory();
      const isNew = isNewPage();
      const items = fresh.map(c => {
        sentKeys.add(c._key);
        rankCounter += 1;
        return {
          productName: c.productName,
          priceCny: c.priceCny,
          soldCount: c.soldCount,
          imageUrl: c.imageUrl,
          rankPos: rankCounter,
          isNew,
          trendingScore: Math.max(0, 120 - rankCounter),
        };
      });
      chrome.runtime
        .sendMessage({ type: "SUBMIT_POIZON_TRENDING", data: { category, items } })
        .catch(() => {});
    } catch (_) {}
  }

  // 디바운스
  let dTimer = null;
  function debouncedScan(delay) {
    clearTimeout(dTimer);
    dTimer = setTimeout(scanAndSend, delay || 1200);
  }

  function onUrlChange() {
    lastUrl = location.href;
    sentKeys = new Set();
    rankCounter = 0;
    // SPA 지연 렌더 대응: 여러 번 재시도
    setTimeout(scanAndSend, 3000);
    setTimeout(scanAndSend, 6000);
    setTimeout(scanAndSend, 11000);
  }

  // 초기 진입
  onUrlChange();

  // URL 변경 폴링(SPA pushState도 location.href에 반영됨)
  setInterval(() => {
    if (location.href !== lastUrl) onUrlChange();
  }, 1500);

  // 무한 로드/카테고리 DOM 교체 감지
  try {
    const mo = new MutationObserver(() => debouncedScan(1200));
    mo.observe(document.body, { childList: true, subtree: true });
  } catch (_) {}

  // 스크롤 시 재수집(throttle 3s)
  let scrollLock = false;
  window.addEventListener(
    "scroll",
    () => {
      if (scrollLock) return;
      scrollLock = true;
      setTimeout(() => { scrollLock = false; scanAndSend(); }, 3000);
    },
    { passive: true }
  );
})();
