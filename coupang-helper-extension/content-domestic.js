// ============================================================
// content-domestic.js — 국내몰 상품 페이지 패시브 최저가 리더 (v8.12)
//   v8.12: JSON-LD gtin13/gtin/mpn → barcode 캡처 (POIZON SKU exact 매칭 다리)
// ============================================================
// 원칙: 유저가 "직접 본" 국내몰 상품가만, 저빈도로, 본인 세션에서 읽어 공유 풀에 적립.
//   대량 크롤·자동 네비게이션 없음 → 역직구 매입가(국내 절반) 데이터 축적.
//   POIZON 시세 풀과 상품 매칭 → "오늘 사야 할 상품" 추천 근거.
// ⚠️ 국내몰 DOM은 제각각이라 JSON-LD(구조화 데이터) → og 메타 → 텍스트 스캔 순 방어적 파싱.
(function () {
  "use strict";
  let lastKey = "";

  // 호스트 → 소스 코드 매핑
  function detectSource() {
    const h = location.hostname;
    if (/musinsa\./.test(h)) return "musinsa";
    if (/abcmart|a-rt\./.test(h)) return "abcmart";
    if (/crocs\./.test(h)) return "crocs";
    if (/nike\./.test(h)) return "nike";
    if (/adidas\./.test(h)) return "adidas";
    if (/newbalance\./.test(h)) return "newbalance";
    if (/lfmall\./.test(h)) return "lfmall";
    if (/lotteon\./.test(h)) return "lotteon";
    if (/ssg\./.test(h)) return "ssg";
    if (/29cm\./.test(h)) return "29cm";
    return "other";
  }

  function toNum(s) {
    const m = String(s || "").replace(/[,\s₩원]/g, "").match(/([0-9]{3,})/);
    return m ? parseInt(m[1], 10) : 0;
  }

  // 1) JSON-LD Product 구조화 데이터 (가장 신뢰도 높음)
  function fromJsonLd() {
    const out = {};
    const nodes = document.querySelectorAll('script[type="application/ld+json"]');
    for (const n of nodes) {
      let data;
      try {
        data = JSON.parse(n.textContent || "{}");
      } catch (_) {
        continue;
      }
      const arr = Array.isArray(data) ? data : data["@graph"] ? data["@graph"] : [data];
      for (const it of arr) {
        const type = it && it["@type"];
        const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
        if (!isProduct) continue;
        if (it.name) out.productName = String(it.name).trim().slice(0, 300);
        if (it.brand) out.brand = String(it.brand.name || it.brand).trim().slice(0, 100);
        if (it.sku) out.sku = String(it.sku).trim().slice(0, 120);
        // 바코드(GTIN) — POIZON SKU와 exact 매칭 다리. 여러 표기 방어적으로.
        const gtin =
          it.gtin13 || it.gtin || it.gtin14 || it.gtin12 || it.gtin8 || it.mpn;
        if (gtin) {
          const g = String(gtin).replace(/[^0-9A-Za-z]/g, "").slice(0, 40);
          if (g) out.barcode = g;
        }
        if (it.image) out.imageUrl = String(Array.isArray(it.image) ? it.image[0] : it.image).slice(0, 1000);
        const offers = it.offers && (Array.isArray(it.offers) ? it.offers[0] : it.offers);
        if (offers && offers.price) out.salePrice = toNum(offers.price);
        if (out.productName && out.salePrice) return out;
      }
    }
    return out;
  }

  // 2) og / product 메타 폴백
  function fromMeta() {
    const out = {};
    const og = document.querySelector('meta[property="og:title"]');
    if (og && og.content) out.productName = og.content.trim().slice(0, 300);
    const img = document.querySelector('meta[property="og:image"]');
    if (img && img.content) out.imageUrl = img.content.slice(0, 1000);
    const price =
      document.querySelector('meta[property="product:price:amount"], meta[property="og:price:amount"]');
    if (price && price.content) out.salePrice = toNum(price.content);
    return out;
  }

  // 3) 정상가(취소선/원가) — 할인율 계산용
  function pickListPrice() {
    const el = document.querySelector(
      'del, s, [class*="origin" i], [class*="regular" i], [class*="before" i], [class*="strike" i]'
    );
    return el ? toNum(el.textContent) : 0;
  }

  function parseAndSend() {
    try {
      const source = detectSource();
      const ld = fromJsonLd();
      const meta = fromMeta();
      const productName = ld.productName || meta.productName || "";
      const salePrice = ld.salePrice || meta.salePrice || 0;
      if (!productName || !salePrice) return; // 상품/가격 신호 없으면 스킵
      const listPrice = pickListPrice();
      const discountPct =
        listPrice > salePrice && listPrice > 0
          ? Math.round(((listPrice - salePrice) / listPrice) * 100)
          : 0;
      const key = source + "|" + productName + "|" + salePrice;
      if (key === lastKey) return;
      lastKey = key;
      chrome.runtime
        .sendMessage({
          type: "SUBMIT_DOMESTIC_PRICE",
          data: {
            source,
            productName,
            brand: ld.brand || undefined,
            sku: ld.sku || undefined,
            barcode: ld.barcode || undefined,
            listPrice: listPrice || salePrice,
            salePrice,
            discountPct,
            imageUrl: ld.imageUrl || meta.imageUrl || undefined,
            productUrl: location.href.slice(0, 1000),
            inStock: true,
          },
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
