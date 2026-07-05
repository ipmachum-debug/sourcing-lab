// ============================================================
// content-poizon.js — POIZON(得物/dewu) 상품 페이지 패시브 시세 리더 (v8.8.3)
// ============================================================
// 원칙: 유저가 "직접 본" 상품 페이지의 시세만, 저빈도로, 본인 세션에서 읽어 서버에 공유.
//   대량 크롤·자동 네비게이션 없음 → 밴 리스크 최소 (쿠팡 패시브와 동일 원리).
// ⚠️ POIZON DOM은 변동이 잦아 셀렉터는 실제 페이지 기준 튜닝 필요.
(function () {
  "use strict";
  let lastKey = "";

  function toNum(s) {
    const m = String(s || "").replace(/[,\s]/g, "").match(/([0-9]+(?:\.[0-9]+)?)/);
    return m ? Math.round(parseFloat(m[1])) : 0;
  }

  // 상품명 추출 (defensive: h1 → og:title → title)
  function pickName() {
    const h1 = document.querySelector("h1");
    if (h1 && h1.textContent && h1.textContent.trim().length > 1) return h1.textContent.trim();
    const og = document.querySelector('meta[property="og:title"]');
    if (og && og.content) return og.content.trim();
    return (document.title || "").trim();
  }

  // 브랜드 (defensive)
  function pickBrand() {
    const el = document.querySelector('[class*="brand" i] a, [class*="brand" i] span, a[href*="/brand"]');
    return el && el.textContent ? el.textContent.trim().slice(0, 100) : "";
  }

  // 사이즈 추출 (defensive: 선택된 사이즈 버튼/활성 옵션)
  function pickSize() {
    const sel = document.querySelector(
      '[class*="size" i][class*="active" i], [class*="size" i][class*="selected" i], [class*="sku" i][aria-selected="true"]'
    );
    const t = sel && sel.textContent ? sel.textContent.trim() : "";
    const m = t.match(/\d{2,3}(?:\.\d)?/);
    return m ? m[0] : "";
  }

  // 30일 판매량 추출 (defensive: "已售/月销/최근 판매 N" 패턴)
  function pickSold30d() {
    const txt = (document.body && document.body.innerText) || "";
    const m = txt.match(/(?:已售|月销|최근\s*판매|sold)\D{0,6}([0-9][0-9,]{0,6})/i);
    return m ? toNum(m[1]) : 0;
  }

  // 위안(¥) 시세 추출 (defensive: 명시 가격요소 → ¥ 텍스트 스캔)
  function pickPriceCny() {
    // 1) 가격으로 보이는 요소 우선
    const cand = document.querySelector('[class*="price" i]');
    if (cand && /[¥￥]|[0-9]/.test(cand.textContent || "")) {
      const v = toNum(cand.textContent);
      if (v >= 10 && v < 1000000) return v;
    }
    // 2) 본문에서 ¥ 패턴 (최저가로 보이는 첫 값)
    const txt = (document.body && document.body.innerText) || "";
    const m = txt.match(/[¥￥]\s*([0-9][0-9,]{1,7})/);
    if (m) {
      const v = toNum(m[1]);
      if (v >= 10 && v < 1000000) return v;
    }
    return 0;
  }

  function parseAndSend() {
    try {
      const productName = pickName().slice(0, 300);
      const priceCny = pickPriceCny();
      if (!productName || !priceCny) return; // 상품/가격 신호 없으면 스킵
      const brand = pickBrand();
      const size = pickSize();
      const soldCount30d = pickSold30d();
      const key = productName + "|" + size + "|" + priceCny;
      if (key === lastKey) return; // 같은 페이지 중복 방지
      lastKey = key;
      const base = { productName, brand: brand || undefined, priceCny };
      // 1) 최신 시세 스냅샷 (오늘의 SKU 자동 채움)
      chrome.runtime
        .sendMessage({ type: "SUBMIT_POIZON_PRICE", data: base })
        .catch(() => {});
      // 2) 체결 관측 (안정가 산출용, 사이즈/판매량 포함)
      chrome.runtime
        .sendMessage({
          type: "SUBMIT_POIZON_OBSERVE",
          data: { ...base, size: size || undefined, soldCount30d },
        })
        .catch(() => {});
    } catch (_) {}
  }

  // 로드 + SPA URL 변화 시에만 (저빈도, 본 것만)
  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(parseAndSend, 2500);
  }
  schedule();

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      schedule();
    }
  }, 2000);
})();
