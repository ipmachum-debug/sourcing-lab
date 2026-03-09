/* ============================================================
   Coupang Sourcing Helper — Content Script v7.0.0
   "마켓 대시보드 패널" — 시장 분석 + TOP3 + 미니 차트

   원칙:
   1) 검색 시 자동 플로팅 패널 (오른쪽)
   2) 시장 개요: 상품수·평균가·리뷰·경쟁도·그래프
   3) TOP 3 상품만 간결 표시
   4) 쿠팡 DOM 최소 건드림

   v7.0.0 하이브리드 아키텍처:
   - V2 React DOM 자동감지 (#product-list > li[class^="ProductUnit_productUnit"])
   - aria-label 평점 추출 (셀러라이프 방식)
   - 배송유형 6종 분류 (data-badge-id 기반)
   - V1/V2 자동 전환 + SSR JSON 폴백 (Background 파서 연동)

   v6.6.2 평점 파싱 강화:
   - 쿠팡 2026 DOM 변경 대응: 별점 텍스트 미표시 대응
   - SVG 별점 감지 대폭 강화 (clipPath, gradient, opacity, getComputedStyle)
   - getComputedStyle 기반 CSS width 별점 감지 추가
   - 접근성(a11y) 숨겨진 텍스트에서 평점 추출
   - calcParseQuality 개선: 리뷰수 기반 추정도 유효 파싱으로 인정
   - 경고 임계값 60% → 30%로 조정 (쿠팡 구조 변경 반영)

   v5.5.7 1688 한국어 직접 전달 (번역 제거):
   - 1688이 한국어를 자동 분석/번역해줌 → 번역 로직 완전 제거
   - 쿠팡 제품 제목을 그대로 1688에 전달
   - encodeURIComponent 제거, 공백만 +로 치환
   - &charset=utf8 파라미터 추가
   - Google Translate 번역 → GBK 깨짐 문제 완전 해결

   v5.5.5 1688 인코딩 버그 수정:
   v5.5.4 1688 키워드 버그 수정:
   - extractKw()가 CN 매핑 없을 때 한국어를 cn으로 반환하던 버그 수정
   - 1688 버튼: 서버AI → 로컬사전 → Google Translate → 한국어 4단계 폴백
   - 콘솔에 상세 디버그 로그 추가 (키워드 변환 과정)
   - AliExpress 버튼: 한국어 키워드 사용 (AliExpress는 한국어 잘 지원)

   v5.5.3 파싱 전면 재작성:
   - 가격: 할인가 우선, "N% N,NNN원" 패턴 추출
          적립금·단위가격·배송비 엄격 제거
          최소값이 아닌 "할인 패턴 뒤" 값 우선
   - 평점: star width 기반 비율 계산 (시각적 별점)
          + aria-label, title 속성 기반 fallback
   - 리뷰: "(N,NNN)" 괄호 패턴, 단위가격 괄호 제외
   - 광고: AD 텍스트 + ad-badge 클래스 + "광고 서비스" 문구
   - 로켓: badge-rocket 클래스 + rocket 이미지 + 텍스트
   - 순위: 이미지 위 1,2,3 배지 (비-광고 상품에서만)
   ============================================================ */
(function () {
  'use strict';
  const VER = '7.0.0';

  if (window.__SH_LOADED__) return;
  window.__SH_LOADED__ = true;

  // 이전 버전 잔재 제거
  document.querySelectorAll(
    '#sh-float-bar,#sh-topbar,#sh-card-styles,#sh-styles-v531,' +
    '.sh-card-overlay,.sh-databar,.sh-mini-badge,.sh-card-box,' +
    '.sh-modal-backdrop,.sh-modal-panel,.sh-hover-highlight,' +
    '[data-sh-badge],[data-sh-overlay],[data-sh-card],[data-sh],' +
    '#sh-overlay-styles,#sh-modal-styles,#sh-debug-panel,#sh-version-badge,' +
    '.sh-tag,#sh-panel,#sh-panel-css'
  ).forEach(el => el.remove());

  console.log(`%c[SH] v${VER} 마켓 대시보드 로드`, 'color:#16a34a;font-weight:bold;font-size:14px;');

  // ============================================================
  //  v6.5: Selector Registry — DOM 변경 시 여기만 수정하면 됨
  // ============================================================
  const SELECTORS = {
    productCard: [
      'li.search-product',
      'li[class*="search-product"]',
      '.search-product',
      'li[data-sentry-component="SearchProduct"]',
    ],
    productLink: [
      'a.search-product-link',
      'a[href*="/vp/products/"]',
      'a[href*="/products/"]',
    ],
    productName: [
      'div.name', '.name',
      '.search-product-wrap .name',
      '[class*="name"]', '[class*="title"]',
    ],
    priceValue: [
      '.search-product__price-value',
      '[class*="price-value"]:not([class*="unit"]):not([class*="per"])',
      '[class*="priceValue"]:not([class*="unit"])',
      'strong.price-value', '.price-value',
    ],
    basePrice: [
      '.search-product__base-price',
      '[class*="base-price"]', '[class*="basePrice"]',
      'del[class*="price"]', 'del[class*="Price"]',
      '[class*="original-price"]', '[class*="originalPrice"]',
    ],
    ratingScore: [
      '.search-product__rating-score',
      '[class*="rating-score"]:not([class*="count"])',
      '[class*="ratingScore"]', '[class*="RatingScore"]',
      'em.rating',
    ],
    ratingCount: [
      '.search-product__rating-count',
      '[class*="rating-count"]', '[class*="ratingCount"]',
      '[class*="RatingCount"]',
      'span.rating-total-count', '.rating-total-count',
    ],
    starWidth: [
      '.search-product__rating [style*="width"]',
      '[class*="rating-star"] [style*="width"]',
      '[class*="star-rating"] [style*="width"]',
      '[class*="star"]', '[class*="Star"]',
    ],
    adBadge: [
      '.search-product__ad-badge', '.ad-badge',
      '.ad-badge-text', '[class*="ad-badge"]',
      '[class*="AdBadge"]', '[class*="ad_badge"]',
    ],
    rocketBadge: [
      '.badge-rocket', '[class*="badge-rocket"]',
      '[class*="rocket-icon"]', '[class*="RocketBadge"]',
      '[class*="rocket_icon"]', '[class*="Rocket"]',
    ],
  };

  // ============================================================
  //  CSS
  // ============================================================
  const css = document.createElement('style');
  css.id = 'sh-panel-css';
  css.textContent = `
    #sh-panel {
      position: fixed !important;
      top: 60px !important;
      right: 10px !important;
      width: 340px !important;
      max-height: calc(100vh - 80px) !important;
      z-index: 2147483640 !important;
      font-family: -apple-system, 'Noto Sans KR', 'Malgun Gothic', sans-serif !important;
      font-size: 12px !important;
      color: #1e293b !important;
      background: #fff !important;
      border-radius: 14px !important;
      box-shadow: 0 8px 40px rgba(0,0,0,0.15), 0 1px 4px rgba(0,0,0,0.06) !important;
      display: flex !important;
      flex-direction: column !important;
      overflow: hidden !important;
      border: 1px solid rgba(0,0,0,0.06) !important;
      user-select: none !important;
      transition: opacity 0.2s !important;
    }
    #sh-panel.sh-min {
      width: 44px !important; max-height: 44px !important;
      border-radius: 22px !important; cursor: pointer !important;
    }
    #sh-panel.sh-min .sh-hc, #sh-panel.sh-min .sh-body { display: none !important; }
    #sh-panel.sh-drag { opacity: 0.8 !important; cursor: grabbing !important; }

    /* 헤더 */
    .sh-hd {
      background: linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%) !important;
      color: #fff !important;
      padding: 10px 14px !important;
      display: flex !important; align-items: center !important; justify-content: space-between !important;
      cursor: grab !important; flex-shrink: 0 !important;
      border-radius: 14px 14px 0 0 !important;
    }
    #sh-panel.sh-min .sh-hd { border-radius: 22px !important; padding: 10px !important; justify-content: center !important; }
    .sh-hd .logo { font-size: 15px !important; font-weight: 800 !important; }
    .sh-hc { display: flex !important; align-items: center !important; gap: 6px !important; flex:1 !important; }
    .sh-hc .ver { font-size: 8px !important; opacity: .6 !important; background: rgba(255,255,255,.12) !important; padding: 1px 5px !important; border-radius: 3px !important; }
    .sh-hc .qr { font-size: 11px !important; background: rgba(255,255,255,.18) !important; padding: 2px 8px !important; border-radius: 5px !important; max-width: 120px !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; font-weight: 600 !important; }
    .sh-hc .cnt { font-size: 10px !important; background: rgba(255,255,255,.22) !important; padding: 2px 6px !important; border-radius: 5px !important; font-weight: 700 !important; }
    .sh-hbtns { display: flex !important; gap: 3px !important; }
    .sh-hb { width: 22px !important; height: 22px !important; display: flex !important; align-items: center !important; justify-content: center !important; border: none !important; background: rgba(255,255,255,.12) !important; color: #fff !important; border-radius: 5px !important; cursor: pointer !important; font-size: 12px !important; padding: 0 !important; }
    .sh-hb:hover { background: rgba(255,255,255,.28) !important; }

    /* 바디 */
    .sh-body { overflow-y: auto !important; flex: 1 !important; }
    .sh-body::-webkit-scrollbar { width: 3px !important; }
    .sh-body::-webkit-scrollbar-thumb { background: #cbd5e1 !important; border-radius: 3px !important; }

    /* 섹션 */
    .sh-sec { padding: 12px 14px !important; border-bottom: 1px solid #f1f5f9 !important; }
    .sh-sec-title { font-size: 10px !important; font-weight: 700 !important; color: #94a3b8 !important; text-transform: uppercase !important; letter-spacing: .5px !important; margin-bottom: 8px !important; }

    /* 시장 통계 그리드 */
    .sh-stats { display: grid !important; grid-template-columns: 1fr 1fr 1fr !important; gap: 8px !important; }
    .sh-st {
      background: #f8fafc !important; border-radius: 8px !important; padding: 8px 10px !important;
      display: flex !important; flex-direction: column !important; align-items: center !important;
      border: 1px solid #f1f5f9 !important;
    }
    .sh-st-v { font-size: 15px !important; font-weight: 800 !important; color: #1e293b !important; line-height: 1.2 !important; }
    .sh-st-v.accent { color: #6366f1 !important; }
    .sh-st-v.red { color: #dc2626 !important; }
    .sh-st-v.green { color: #16a34a !important; }
    .sh-st-v.amber { color: #d97706 !important; }
    .sh-st-l { font-size: 9px !important; color: #94a3b8 !important; margin-top: 2px !important; }

    /* 경쟁도 바 */
    .sh-comp-bar { height: 6px !important; border-radius: 3px !important; background: #f1f5f9 !important; margin-top: 6px !important; overflow: hidden !important; }
    .sh-comp-fill { height: 100% !important; border-radius: 3px !important; transition: width .3s !important; }
    .sh-comp-lbl { display: flex !important; justify-content: space-between !important; margin-top: 3px !important; font-size: 9px !important; color: #94a3b8 !important; }
    .sh-comp-easy { background: #16a34a !important; }
    .sh-comp-mid { background: #f59e0b !important; }
    .sh-comp-hard { background: #dc2626 !important; }

    /* 미니 차트 (가격 분포, 리뷰 분포) */
    .sh-charts { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 8px !important; margin-top: 10px !important; }
    .sh-chart {
      background: #f8fafc !important; border-radius: 8px !important; padding: 8px !important;
      border: 1px solid #f1f5f9 !important;
    }
    .sh-chart-title { font-size: 9px !important; font-weight: 600 !important; color: #94a3b8 !important; margin-bottom: 6px !important; }
    .sh-bars { display: flex !important; align-items: flex-end !important; gap: 2px !important; height: 40px !important; }
    .sh-bar {
      flex: 1 !important; background: #c7d2fe !important; border-radius: 2px 2px 0 0 !important;
      min-height: 2px !important; transition: height .3s !important; position: relative !important;
    }
    .sh-bar:hover { background: #6366f1 !important; }
    .sh-bar-lbl { position: absolute !important; bottom: -13px !important; left: 50% !important; transform: translateX(-50%) !important; font-size: 7px !important; color: #94a3b8 !important; white-space: nowrap !important; }
    .sh-bar-active { background: #6366f1 !important; }

    /* TOP3 상품 */
    .sh-top {
      display: flex !important; gap: 8px !important; padding: 8px 0 !important;
      border-bottom: 1px solid #f1f5f9 !important; align-items: flex-start !important;
      cursor: pointer !important; transition: background .15s !important;
    }
    .sh-top:last-child { border-bottom: none !important; }
    .sh-top:hover { background: #f8fafc !important; border-radius: 6px !important; }
    .sh-top-rank {
      width: 20px !important; height: 20px !important; border-radius: 5px !important;
      display: flex !important; align-items: center !important; justify-content: center !important;
      font-size: 10px !important; font-weight: 800 !important; flex-shrink: 0 !important;
    }
    .sh-r1 { background: #fef3c7 !important; color: #92400e !important; }
    .sh-r2 { background: #e0e7ff !important; color: #3730a3 !important; }
    .sh-r3 { background: #f1f5f9 !important; color: #64748b !important; }
    .sh-top-img {
      width: 40px !important; height: 40px !important; border-radius: 6px !important;
      object-fit: cover !important; flex-shrink: 0 !important; background: #f1f5f9 !important;
    }
    .sh-top-info { flex: 1 !important; min-width: 0 !important; }
    .sh-top-name {
      font-size: 11px !important; font-weight: 600 !important; color: #1e293b !important;
      white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important;
      margin-bottom: 3px !important; line-height: 1.3 !important;
    }
    .sh-top-meta {
      display: flex !important; align-items: center !important; gap: 5px !important; flex-wrap: wrap !important;
    }
    .sh-top-price { font-size: 11px !important; font-weight: 700 !important; color: #dc2626 !important; }
    .sh-top-rev { font-size: 9px !important; color: #64748b !important; }
    .sh-top-grade {
      font-size: 9px !important; font-weight: 800 !important; padding: 1px 5px !important;
      border-radius: 3px !important; color: #fff !important;
    }
    .sh-gs { background: #16a34a !important; }
    .sh-ga { background: #3b82f6 !important; }
    .sh-gb { background: #f59e0b !important; }
    .sh-gc { background: #9ca3af !important; }
    .sh-gd { background: #dc2626 !important; }

    .sh-top-btns { display: flex !important; gap: 3px !important; margin-top: 4px !important; }
    .sh-tb {
      height: 20px !important; padding: 0 7px !important; border: none !important;
      border-radius: 4px !important; font-size: 9px !important; font-weight: 700 !important;
      cursor: pointer !important; color: #fff !important; display: inline-flex !important;
      align-items: center !important;
    }
    .sh-tb:hover { opacity: .85 !important; }
    .sh-tb-1688 { background: #ea580c !important; }
    .sh-tb-ali { background: #dc2626 !important; }
    .sh-tb-save { background: #6366f1 !important; }
    .sh-tb-saved { background: #16a34a !important; }

    /* 하이라이트 */
    .sh-hl { outline: 3px solid #6366f1 !important; outline-offset: -2px !important; transition: outline .15s !important; }

    /* 풋터 */
    .sh-foot {
      padding: 6px 14px !important; background: #f8fafc !important; border-top: 1px solid #f1f5f9 !important;
      font-size: 9px !important; color: #94a3b8 !important; text-align: center !important; flex-shrink: 0 !important;
    }
    .sh-foot a { color: #6366f1 !important; text-decoration: none !important; font-weight: 600 !important; }

    @media (max-width: 1200px) { #sh-panel { width: 300px !important; } }
  `;
  document.head.appendChild(css);

  // ============================================================
  //  키워드 매핑
  // ============================================================
  const CN = {
    // 생활용품
    '텀블러':'保温杯','물병':'水杯','보온병':'保温瓶','수건':'毛巾','타올':'毛巾',
    '비누':'肥皂','칫솔':'牙刷','치약':'牙膏','면도기':'剃须刀','빗':'梳子',
    '수세미':'百洁布','스펀지':'海绵','솔':'刷子','청소':'清洁','세제':'洗涤剂',
    '걸레':'拖把','행주':'抹布','극세사':'超细纤维','실리콘':'硅胶','세척':'清洗',
    '쓰레받기':'簸箕','빗자루':'扫帚','빗자루세트':'扫把套装','먼지떨이':'鸡毛掸子',
    '쓰레기통':'垃圾桶','방향제':'香薰','후크':'挂钩',
    // 주방
    '냄비':'锅','프라이팬':'平底锅','도마':'砧板','접시':'盘子','그릇':'碗',
    '젓가락':'筷子','숟가락':'勺子','밀폐용기':'密封盒','보관용기':'保鲜盒',
    '물통':'水壶','주전자':'水壶','머그컵':'马克杯','컵':'杯子',
    '칼':'刀','가위':'剪刀',
    // 가전/전자
    '충전기':'充电器','케이블':'数据线','이어폰':'耳机','헤드폰':'头戴耳机',
    '블루투스':'蓝牙','스피커':'音箱','마우스':'鼠标','키보드':'键盘',
    '보조배터리':'充电宝','거치대':'支架','케이스':'手机壳','필름':'贴膜',
    '무선충전':'无线充电','조명':'照明','램프':'灯','스탠드':'台灯',
    '전구':'灯泡','리모컨':'遥控器','모니터':'显示器','웹캠':'摄像头',
    // 미용/뷰티 가전
    '드라이어':'吹风机','드라이기':'吹风机','헤어드라이어':'吹风机','헤어드라이기':'吹风机',
    '고데기':'卷发棒','헤어':'头发','전문가용':'专业','초고출력':'大功率','고출력':'大功率',
    '다리미':'熨斗','선풍기':'电风扇','가습기':'加湿器','제습기':'除湿机',
    '공기청정기':'空气净化器','에어프라이어':'空气炸锅','믹서기':'搅拌机',
    '전기포트':'电热水壶','토스터':'烤面包机','전동칫솔':'电动牙刷',
    '마사지기':'按摩器','안마기':'按摩器',
    // 자동차
    '차량용':'车载','차량':'汽车','자동차':'汽车','접이식':'折叠','회전':'旋转',
    // 의류/패션
    '티셔츠':'T恤','반팔':'短袖','긴팔':'长袖','맨투맨':'卫衣','후드':'连帽衫',
    '자켓':'夹克','점퍼':'外套','코트':'大衣','바지':'裤子','청바지':'牛仔裤',
    '양말':'袜子','속옷':'内衣','모자':'帽子','벨트':'腰带','장갑':'手套',
    '가방':'包','백팩':'双肩包','크로스백':'斜挎包','지갑':'钱包',
    '신발':'鞋','운동화':'运动鞋','슬리퍼':'拖鞋','샌들':'凉鞋',
    // 액세서리
    '목걸이':'项链','반지':'戒指','팔찌':'手链','귀걸이':'耳环',
    '선글라스':'太阳镜','안경':'眼镜','시계':'手表','헤어밴드':'发带',
    // 완구/유아
    '장난감':'玩具','인형':'玩偶','블록':'积木','퍼즐':'拼图','스티커':'贴纸',
    // 문구
    '펜':'笔','볼펜':'圆珠笔','노트':'笔记本','다이어리':'日记本','테이프':'胶带',
    // 운동/레저
    '요가매트':'瑜伽垫','아령':'哑铃','텐트':'帐篷','등산':'登山',
    // 인테리어
    '커튼':'窗帘','러그':'地毯','이불':'被子','베개':'枕头','매트':'垫子',
    '침대':'床','액자':'相框','쿠션':'靠垫','방석':'坐垫',
    // 수납/정리
    '다용도':'多用途','수납':'收纳','선반':'架子','행거':'衣架',
    '정리함':'收纳盒','거울':'镜子','세트':'套装',
    // 식품
    '찹쌀떡':'糯米糕','떡':'年糕','모찌':'麻薯',
    // 뷰티
    '립스틱':'口红','로션':'乳液','크림':'面霜','선크림':'防晒霜',
    '샴푸':'洗发水','린스':'护发素','바디워시':'沐浴露',
    // 반려동물
    '사료':'宠物粮','간식':'零食','목줄':'牵引绳',
  };
  const NOISE = new Set([
    '1개','2개','3개','4개','5개','6개','7개','8개','9개','10개',
    '1P','2P','3P','1+1','2+1','3+1','1팩','2팩','1세트','2세트',
    '무료배송','당일발송','국내배송','무료반품','최저가','특가','세일',
    '할인','초특가','핫딜','타임딜','쿠폰','적립','인기','추천','베스트',
    '고급','프리미엄','럭셔리','대용량','소용량','미니','슬림',
    '정품','국내정품','수입정품','공식','공식판매',
    '블랙','화이트','그레이','네이비','베이지','브라운','핑크',
    '레드','블루','그린','옐로우','퍼플','오렌지',
    '입점특가','단품','혼합색상',
    // 모델명/수식어 (검색 방해)
    '파워','플러스','프로','슈퍼','울트라','맥스','라이트','미니','매직',
    '터보','스마트','원터치','오토','듀얼','멀티','에코','클래식',
    '뉴','올뉴','리뉴얼','업그레이드','개선','신형','최신','스페셜',
    '초고속','고속','저소음','강력','휴대용','이온','음이온',
  ]);
  const BRANDS = new Set([
    '삼성','엘지','LG','SAMSUNG','APPLE','애플','나이키','NIKE',
    '아디다스','ADIDAS','뉴발란스','컨버스','무인양품','이케아','IKEA',
    '샤오미','XIAOMI','앤커','ANKER','로지텍','필립스','다이슨',
    '소니','SONY','파나소닉','보쉬','쿠쿠','쿠첸','위닉스',
    '블라우풍트','유닉스','CKI','Rotima','SUNGDIN','SAMSEA',
    '쿠팡브랜드','곰곰','탐사','코멧','오뚜기','CJ','비비고',
  ]);

  console.log(`%c[SH] v${VER} | 1688 사전: ${Object.keys(CN).length}개 | 브랜드: ${BRANDS.size}개 | 노이즈: ${NOISE.size}개`, 'color:#6366f1;font-weight:bold;');

  function extractKw(title) {
    if (!title) return { cn: '', ko: '' };
    const c = title.replace(/\[.*?\]|\(.*?\)|【.*?】/g, ' ')
      .replace(/[\/\\|~`!@#$%^&*=+{};:'"<>,.?]/g, ' ')
      .replace(/\d+(ml|g|kg|cm|mm|개입|매입|세트|팩|롤)/gi, ' ')
      .replace(/\d+[Ww]\b/g, ' ') // 2400W 같은 와트수 제거 (검색 방해)
      .replace(/\d+rpm/gi, ' ') // rpm 스펙 제거
      .trim();
    let w = c.split(/\s+/).filter(x => {
      if (x.length <= 1) return false;
      if (NOISE.has(x)) return false;
      if (/^\d+$/.test(x)) return false;
      // 브랜드 제거
      if (BRANDS.has(x) || BRANDS.has(x.toUpperCase())) return false;
      // 알파벳만으로 된 짧은 단어 (모델명) 제거
      if (/^[a-zA-Z][-a-zA-Z0-9]*$/.test(x) && !CN[x] && x.length <= 8) return false;
      return true;
    });
    // 복합어 매칭: "헤어 드라이어" → "헤어드라이어"
    for (let i = 0; i < w.length - 1; i++) {
      const compound = w[i] + w[i + 1];
      if (CN[compound]) {
        w.splice(i, 2, compound);
      }
    }
    // CN 매핑이 있는 단어를 우선 배치
    const mapped = w.filter(x => CN[x]);
    const unmapped = w.filter(x => !CN[x]);
    const sorted = [...mapped, ...unmapped];
    const coreWords = sorted.slice(0, 4);
    const cnParts = coreWords.map(x => CN[x]).filter(Boolean);
    const koKw = coreWords.join(' ');
    // 중국어 키워드가 있으면 사용, 없으면 빈 문자열 (한국어 폴백 금지 — 1688에서 깨짐)
    const cnKw = cnParts.length > 0 ? cnParts.join(' ') : '';
    return { cn: cnKw, ko: koKw };
  }

  // ============================================================
  //  점수 & 등급
  // ============================================================
  function calcScore(item) {
    let s = 50;
    if (item.reviewCount < 50) s += 20;
    else if (item.reviewCount < 200) s += 12;
    else if (item.reviewCount < 500) s += 5;
    else if (item.reviewCount > 2000) s -= 10;
    if (item.rating >= 4.5) s += 5;
    else if (item.rating < 3.5 && item.rating > 0) s -= 5;
    if (item.price >= 5000 && item.price <= 30000) s += 10;
    else if (item.price > 0 && item.price < 3000) s -= 5;
    if (item.isAd) s -= 8;
    return Math.max(0, Math.min(100, Math.round(s)));
  }

  // ============================================================
  //  검색어 기반 소싱 키워드 추출 (v5.5.5)
  //  규칙: 쿠팡 검색어 + 제목에서 검색어 앞 수식어(사용처/소재/특성)
  //  "부모님 용돈봉투", "게이밍 마우스패드", "스테인레스 텀블러" 등
  // ============================================================
  const GOOD_MODS = new Set([
    '어린이','유아','아동','아기','청소년','성인','남성','여성','남자','여자',
    '부모님','어르신','신랑','신부','결혼','돌잔치','생일','축하','감사',
    '사무실','학교','회사','캠핑','등산','운동','여행','출장','차량용',
    '가죽','천연','실리콘','스테인레스','나무','원목','대나무','유리','크리스탈',
    '전문가용','업소용','산업용','가정용','휴대용',
    '전통','한복','빈티지','레트로','모던','클래식',
    '대형','소형','중형','초대형',
    '보온보냉','보온','보냉','방수','방진','접이식','무선',
    '게이밍','오피스','초고속','저소음','미스트','초경량',
  ]);
  function extractSourcingKw(query, title) {
    if (!query || !title) return query || '';
    const q = query.trim();
    const tWords = title.replace(/\s+/g, ' ').trim().split(/\s+/);
    const qNorm = q.replace(/\s+/g, '');
    // 제목에서 검색어 매칭 위치 (공백 무시)
    let mi = -1;
    for (let i = 0; i < tWords.length; i++) {
      let c = '';
      for (let j = i; j < tWords.length; j++) {
        c += tWords[j];
        if (c === qNorm) { mi = i; break; }
        if (c.length > qNorm.length) break;
      }
      if (mi >= 0) break;
      if (tWords[i].includes(qNorm)) { mi = i; break; }
    }
    if (mi <= 0) return q;
    // 앞 단어에서 수식어 추출
    const before = tWords.slice(0, mi);
    for (let i = before.length - 1; i >= 0; i--) {
      const w = before[i];
      if (w.length < 2) continue;
      if (/^\d+[a-zA-Z가-힣]*$/.test(w)) continue;
      if (/^[A-Za-z0-9\-_.]+$/.test(w)) continue;
      if (NOISE.has(w)) continue;
      if (GOOD_MODS.has(w)) return `${w} ${q}`;
      if (i === 0 && /^[가-힣]{2,5}$/.test(w)) continue;
      return `${w} ${q}`;
    }
    return q;
  }

  function getGrade(sc) {
    if (sc >= 80) return { l: 'S', c: 'sh-gs' };
    if (sc >= 65) return { l: 'A', c: 'sh-ga' };
    if (sc >= 50) return { l: 'B', c: 'sh-gb' };
    if (sc >= 35) return { l: 'C', c: 'sh-gc' };
    return { l: 'D', c: 'sh-gd' };
  }

  // ============================================================
  //  유틸리티
  // ============================================================
  const MAX = 36;
  function getQ() {
    try {
      const u = new URL(location.href);
      return u.searchParams.get('q') || u.searchParams.get('query') || u.searchParams.get('keyword') || '';
    } catch { return ''; }
  }
  function tx(el) { return (el?.textContent || '').replace(/\s+/g, ' ').trim(); }
  function nm(s) {
    if (!s) return 0;
    s = s.trim();
    // "N,NNN원" or "N,NNN" pattern → extract last price-like number
    const priceMatch = s.match(/(\d{1,3}(?:,\d{3})+)\s*원?$/);
    if (priceMatch) return parseInt(priceMatch[1].replace(/,/g, ''), 10) || 0;
    // "NNN원" pattern
    const simpleMatch = s.match(/(\d+)\s*원?$/);
    if (simpleMatch) return parseInt(simpleMatch[1], 10) || 0;
    // Pure number with commas "N,NNN"
    const commaMatch = s.match(/(\d{1,3}(?:,\d{3})+)/);
    if (commaMatch) return parseInt(commaMatch[1].replace(/,/g, ''), 10) || 0;
    // Fallback: strip non-digits (legacy behavior)
    return parseInt(s.replace(/[^0-9]/g, ''), 10) || 0;
  }
  function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

  // ============================================================
  //  ★★★ 상품 파싱 v7.0 (하이브리드) ★★★
  //
  //  핵심 전략:
  //  0. V2 React DOM 감지 (셀러라이프 방식: #product-list > li[class^="ProductUnit_productUnit"])
  //  1. 각 상품 카드의 개별 DOM 요소를 하나씩 순회
  //  2. 각 요소의 텍스트를 분석하여 역할 파악
  //  3. "적립", "당", "배송비" 등이 포함된 가격 텍스트는 확실히 제외
  //  4. 별점은 star 관련 요소의 width 비율 또는 aria-label에서 추출
  //  5. 리뷰수는 "(\d+)" 패턴에서 추출, 단위가격 괄호 제외
  //  6. 배송유형 6종 분류 (rocket, seller-rocket, global-rocket, normal, overseas, unknown)
  // ============================================================
  function parseProducts() {
    const items = [], seen = new Set(), q = getQ();

    // ── V2 DOM 감지 (셀러라이프 coupangItemSummaryV2 방식) ──────
    // 2025~2026 React 기반 DOM: #product-list > li[class^="ProductUnit_productUnit"]
    let isV2 = false;
    let productBoxes = [...document.querySelectorAll('#product-list > li[class^="ProductUnit_productUnit"]')];
    if (productBoxes.length > 0) {
      isV2 = true;
      // V2 광고 카드 제외
      productBoxes = productBoxes.filter(el => !el.querySelector('[class*="AdMark_adMark"]'));
      console.log(`[SH] V2 DOM 감지: ${productBoxes.length}개 상품 카드 (React)`);
    }

    // ── V1 폴백: 상품 카드 수집 ──────────────────────
    if (!productBoxes.length) {
      // 방법 A: <li class*="search-product"> 기반
      productBoxes = [...document.querySelectorAll('li[class*="search-product"]')];
    }

    // 방법 B: fallback — productList 내 li
    if (!productBoxes.length) {
      const ul = document.querySelector('#productList, ul[class*="product"]');
      if (ul) productBoxes = [...ul.querySelectorAll(':scope > li')];
    }

    // 방법 C: a[href*="/vp/products/"] 링크 기반
    if (!productBoxes.length) {
      const anchors = document.querySelectorAll('a[href*="/vp/products/"]');
      const boxSet = new Set();
      for (const a of anchors) {
        let box = a;
        for (let i = 0; i < 8 && box.parentElement; i++) {
          box = box.parentElement;
          if (box.tagName === 'LI' || box.tagName === 'ARTICLE') break;
        }
        if (!boxSet.has(box)) { boxSet.add(box); productBoxes.push(box); }
      }
    }

    for (const box of productBoxes) {
      if (items.length >= MAX) break;

      // 상품 링크 찾기 (V2: <a> 직접, V1: href 패턴)
      const link = isV2
        ? (box.querySelector('a[href*="/vp/products/"], a[href*="/products/"]') || box.querySelector('a'))
        : box.querySelector('a[href*="/vp/products/"]');
      if (!link) continue;

      const linkHref = link.href || link.getAttribute('href') || '';
      const m = linkHref.match(/\/products\/(\d+)/);
      if (!m) continue;
      const pid = m[1];
      if (seen.has(pid)) continue;
      seen.add(pid);

      // vendorItemId 추출 (URL 파라미터에서)
      let vendorItemId = null;
      const vidMatch = linkHref.match(/[?&]vendorItemId=(\d+)/i) || linkHref.match(/[?&]itemId=(\d+)/i);
      if (vidMatch) vendorItemId = vidMatch[1];

      // ── 상품명 (V2 우선 셀렉터 추가) ──────────────────────────────
      let nameEl;
      if (isV2) {
        nameEl = box.querySelector('[class*="ProductUnit_productName"], [class*="ProductUnit_productInfo"] [class*="name"]');
      }
      if (!nameEl) nameEl = box.querySelector('div.name, [class*="name"], [class*="title"]');
      const title = (nameEl ? tx(nameEl) : '') || tx(link) || (box.querySelector('img')?.alt || '');
      if (!title || title.length < 3) continue;

      // ══════════════════════════════════════════
      // ▶ 가격 추출 (v7.0 — V2 + V1 하이브리드)
      // ══════════════════════════════════════════
      let price = 0;
      let originalPrice = 0;

      // V2 전용 가격 선택자 (셀러라이프 방식)
      if (isV2) {
        const v2PriceEl = box.querySelector('[class*="Price_priceValue"]');
        if (v2PriceEl) { const p = nm(tx(v2PriceEl)); if (p >= 100 && p < 1e8) price = p; }
        if (!price) {
          // PriceArea 내 값 탐색
          const priceArea = box.querySelector('[class*="PriceArea_priceArea"]');
          if (priceArea) {
            for (const d of priceArea.querySelectorAll('div, span, strong')) {
              const t = tx(d);
              if (t && t.endsWith('원') && !t.includes('%') && (t.includes(',') || /\d{3,}원/.test(t))) {
                const p = nm(t);
                if (p >= 100 && p < 1e8) { price = p; break; }
              }
            }
          }
        }
        const v2BaseEl = box.querySelector('[class*="Price_basePrice"], [class*="OriginalPrice"], del');
        if (v2BaseEl) originalPrice = nm(tx(v2BaseEl));
      }

      // 전략 0: 쿠팡 2026 search-product 전용 선택자
      const spPriceEl = box.querySelector(
        '.search-product__price-value, [class*="price-value"]:not([class*="unit"]):not([class*="per"]), ' +
        '[class*="priceValue"]:not([class*="unit"]), [class*="PriceValue"]:not([class*="unit"])'
      );
      if (spPriceEl) {
        const pv = nm(tx(spPriceEl));
        if (pv >= 100 && pv < 1e8) price = pv;
      }
      // 원래 가격 (정가/취소선)
      const spOrigEl = box.querySelector(
        '.search-product__base-price, [class*="base-price"], [class*="basePrice"], ' +
        'del[class*="price"], del[class*="Price"], [class*="original-price"], [class*="originalPrice"]'
      );
      if (spOrigEl) originalPrice = nm(tx(spOrigEl));

      // 전략 1: 클래스 기반 직접 추출
      if (!price) {
        const priceValueEl = box.querySelector('strong.price-value, .price-value, [class*="price-value"]');
        if (priceValueEl) {
          const pv = nm(tx(priceValueEl));
          if (pv >= 1000) price = pv;
        }
        if (!originalPrice) {
          const basePriceEl = box.querySelector('del.base-price, .base-price, del[class*="price"]');
          if (basePriceEl) originalPrice = nm(tx(basePriceEl));
        }
      }

      // 전략 1b: sale/discount 관련 클래스
      if (!price) {
        for (const sel of [
          '[class*="sale-price"]:not([class*="original"])',
          '[class*="salePrice"]:not([class*="original"])',
          '[class*="discount-price"]',
          '[class*="discountPrice"]',
          '.price strong',
          '.price em',
        ]) {
          const el = box.querySelector(sel);
          if (el && !el.closest('#sh-panel')) {
            const v = nm(tx(el));
            if (v >= 100 && v < 1e8) { price = v; break; }
          }
        }
      }

      // 전략 2: 개별 엘리먼트 순회하여 가격 역할 분석
      if (!price) {
        const candidates = [];
        const walker = document.createTreeWalker(box, NodeFilter.SHOW_ELEMENT);
        let node;
        while ((node = walker.nextNode())) {
          // sh-panel 내부 요소는 무시
          if (node.closest('#sh-panel')) continue;

          const t = tx(node);
          if (!t) continue;

          // 이 요소의 고유 텍스트 (자식 제외)
          const ownText = [...node.childNodes]
            .filter(n => n.nodeType === 3)
            .map(n => n.textContent.trim())
            .join(' ');

          // "원" 포함 검사 — 요소 자체 또는 직계 텍스트
          const checkText = ownText || t;
          if (!/[\d,]+\s*원/.test(checkText) && !/^\d[\d,]*$/.test(checkText.trim())) continue;

          // ★ 제외 조건 ★
          // 1) 적립금: "적립" 단어가 같은 요소나 부모에 있음
          const parentText = tx(node.parentElement);
          if (/적립/.test(t) || /적립/.test(parentText)) continue;
          // 2) 단위가격: "당" 이 포함 (100g당, 10ml당 등)
          if (/\d+\s*(g|kg|ml|l|개|매|입)\s*당/i.test(t)) continue;
          if (/당\s*[\d,]+\s*원/.test(t)) continue;
          // 3) 배송비
          if (/배송비/.test(t) || /배송비/.test(parentText)) continue;
          // 4) 쿠팡추천, 도착예정 등 비가격 텍스트
          if (/도착|배송|출발|반품|적립|캐시/.test(t) && !/[\d,]+\s*원/.test(ownText)) continue;

          // 숫자 추출
          const priceMatch = checkText.match(/([\d,]+)\s*원/);
          if (priceMatch) {
            const v = nm(priceMatch[1]);
            if (v >= 1000 && v < 1e8) {
              // 취소선(del) 태그면 정가
              const isStrike = node.tagName === 'DEL' || node.closest('del') ||
                               (node.className && /base.?price|original|old/i.test(node.className));
              candidates.push({ value: v, isOriginal: isStrike, el: node });
            }
          }
        }

        if (candidates.length > 0) {
          // 판매가 = 정가가 아닌 것 중 최소값 (할인가)
          const salePrices = candidates.filter(c => !c.isOriginal);
          const origPrices = candidates.filter(c => c.isOriginal);

          if (salePrices.length > 0) {
            // 할인가가 여러개면 가장 작은 게 실제 판매가
            price = Math.min(...salePrices.map(c => c.value));
          } else if (origPrices.length > 0) {
            // 정가만 있으면 그것이 판매가
            price = Math.min(...origPrices.map(c => c.value));
          }
          if (!originalPrice && origPrices.length > 0) {
            originalPrice = Math.max(...origPrices.map(c => c.value));
          }
        }
      }

      // 전략 3: 텍스트 전체에서 할인 패턴 기반 추출 (최후 수단)
      if (!price) {
        const fullText = tx(box);
        // 적립/단위가격/배송비 문장 제거
        let cleanText = fullText
          .replace(/최대\s*[\d,]+\s*원\s*적립/g, '')
          .replace(/[\d,]+\s*원\s*적립/g, '')
          .replace(/\d+\s*(g|kg|ml|l|개|매|입)\s*당\s*[\d,]+\s*원/gi, '')
          .replace(/배송비\s*[\d,]+\s*원/g, '');

        // "N% N,NNN원" 할인 패턴
        const discMatch = cleanText.match(/(\d{1,2})%\s*([\d,]+)\s*원/);
        if (discMatch) {
          const p = nm(discMatch[2]);
          if (p >= 1000 && p < 1e8) price = p;
        }

        if (!price) {
          const allPrices = [...cleanText.matchAll(/([\d,]+)\s*원/g)]
            .map(m => nm(m[1]))
            .filter(n => n >= 1000 && n < 1e8);
          if (allPrices.length === 1) {
            price = allPrices[0];
          } else if (allPrices.length >= 2) {
            allPrices.sort((a, b) => a - b);
            price = allPrices[0];
          }
        }
      }

      // ★ 가격 최종 검증 — 비정상 가격 제거
      if (price >= 1e8) price = 0;
      if (originalPrice >= 1e8) originalPrice = 0;

      // ══════════════════════════════════════════
      // ▶ 평점 추출 (v7.0 — V2 aria-label 우선 + V1 16단계 전략)
      // 쿠팡 2026 DOM: React hydration으로 클래스 랜덤화
      // → 복수의 선택자, 텍스트 패턴, style, data 속성, aria 등 다각도 탐색
      // 추정값(4.0/4.5)은 최후의 최후 수단으로만 사용
      // ══════════════════════════════════════════
      let rating = 0;
      let ratingIsEstimated = false; // 추정값 여부 플래그

      // ★★★ V2 전략: aria-label 평점 추출 (셀러라이프 핵심 방식) ★★★
      // V2 DOM에서는 aria-label="4.5" 속성으로 평점을 표시
      if (isV2) {
        const ariaEl = box.querySelector('[aria-label]');
        if (ariaEl) {
          const ariaVal = ariaEl.getAttribute('aria-label');
          const rMatch = ariaVal?.match(/([\d.]+)/);
          if (rMatch) {
            const r = parseFloat(rMatch[1]);
            if (r >= 1.0 && r <= 5.0) rating = r;
          }
        }
        // V2 폴백: ProductRating 컨테이너 텍스트
        if (!rating) {
          const v2RatingEl = box.querySelector('[class*="ProductRating"], [class*="productRating"]');
          if (v2RatingEl) {
            const rMatch = tx(v2RatingEl).match(/([\d.]+)/);
            if (rMatch) {
              const r = parseFloat(rMatch[1]);
              if (r >= 1.0 && r <= 5.0) rating = r;
            }
          }
        }
      }

      // 전략 0: 쿠팡 2026 search-product 전용 선택자 (가장 정확)
      // <div class="search-product__rating"> <em class="search-product__rating-score">4.5</em>
      // <span class="search-product__rating-count">(1,234)</span> </div>
      const ratingScoreEl = box.querySelector(
        '.search-product__rating-score, [class*="rating-score"]:not([class*="count"]), ' +
        '[class*="ratingScore"], [class*="RatingScore"]'
      );
      if (ratingScoreEl) {
        const rm = tx(ratingScoreEl).match(/(\d+\.?\d*)/);
        if (rm) { const v = parseFloat(rm[1]); if (v > 0 && v <= 5) rating = v; }
      }

      // 전략 1: em.rating 텍스트 (클래식)
      if (!rating) {
        const ratEl = box.querySelector('em.rating');
        if (ratEl) {
          const rm = tx(ratEl).match(/(\d+\.?\d*)/);
          if (rm) { const v = parseFloat(rm[1]); if (v > 0 && v <= 5) rating = v; }
        }
      }

      // 전략 1b: 쿠팡 다이나믹 클래스 패턴 — rating 컨테이너 내 첫 번째 숫자 자식
      if (!rating) {
        const ratingContainer = box.querySelector(
          '[class*="rating"]:not([class*="count"]):not([class*="total"]):not([class*="bar"])'
        );
        if (ratingContainer) {
          // 직접 자식에서 숫자만 가진 요소 탐색
          for (const child of ratingContainer.querySelectorAll('em, span, strong, div')) {
            if (child.children.length > 0) continue; // leaf 노드만
            const t = tx(child).trim();
            const rm = t.match(/^(\d+\.?\d*)$/);
            if (rm) { const v = parseFloat(rm[1]); if (v > 0 && v <= 5) { rating = v; break; } }
          }
        }
      }

      // 전략 2: rating 관련 클래스의 숫자 텍스트
      if (!rating) {
        for (const el of box.querySelectorAll('[class*="rating"]:not([class*="count"]):not([class*="total"])')) {
          if (el.closest('#sh-panel')) continue;
          const t = tx(el).trim();
          // "4.5" 또는 "4" 형태
          const rm = t.match(/^(\d+\.?\d*)$/);
          if (rm) { const v = parseFloat(rm[1]); if (v > 0 && v <= 5) { rating = v; break; } }
          // "4.5점" 형태
          const rm2 = t.match(/(\d+\.?\d*)\s*점/);
          if (rm2) { const v = parseFloat(rm2[1]); if (v > 0 && v <= 5) { rating = v; break; } }
        }
      }

      // 전략 3: aria-label, title, data-rating, data-score 속성에서 추출
      if (!rating) {
        for (const el of box.querySelectorAll('[aria-label], [title], [data-rating], [data-score], [data-star]')) {
          if (el.closest('#sh-panel')) continue;
          // data-rating / data-score / data-star 속성 (가장 직접적)
          for (const attr of ['data-rating', 'data-score', 'data-star']) {
            const dr = el.getAttribute(attr);
            if (dr) { const v = parseFloat(dr); if (v > 0 && v <= 5) { rating = v; break; } }
          }
          if (rating) break;

          const label = (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '');
          if (!label.trim()) continue;
          let rm = label.match(/만점에\s*(\d+\.?\d*)/);
          if (!rm) rm = label.match(/(\d+\.?\d*)\s*점/);
          if (!rm) rm = label.match(/(\d+\.?\d*)\s*out\s*of\s*5/i);
          if (!rm) rm = label.match(/별점\s*(\d+\.?\d*)/);
          if (!rm) rm = label.match(/(\d+\.?\d*)\s*\/\s*5/);
          if (!rm) rm = label.match(/rating[:\s]+(\d+\.?\d*)/i);
          if (rm) {
            const v = parseFloat(rm[1]);
            if (v > 0 && v <= 5) { rating = v; break; }
          }
        }
      }

      // 전략 4: style="width: XX%" 기반 별점 (쿠팡 2026 표준 방식)
      // 쿠팡은 <div class="...star..."><div style="width:90%"> 형태로 별점을 표시
      if (!rating) {
        // 별점 컨테이너를 폭넓게 탐색 (순서: 정확한 것 먼저)
        const starSelectors = [
          '.search-product__rating [style*="width"]',
          '[class*="rating-star"] [style*="width"]',
          '[class*="star-rating"] [style*="width"]',
          '[class*="star"]', '[class*="Star"]', '[class*="rating-star"]',
          '[class*="star-rating"]', '[class*="StarRating"]',
          '[class*="rating"] [style*="width"]',
        ];
        for (const sel of starSelectors) {
          if (rating) break;
          for (const container of box.querySelectorAll(sel)) {
            if (container.closest('#sh-panel')) continue;
            // 자기 자신 또는 자식에서 width% 찾기
            const targets = [container, ...container.querySelectorAll('[style*="width"]')];
            for (const el of targets) {
              const style = el.getAttribute('style') || '';
              const wm = style.match(/width:\s*([\d.]+)%/);
              if (wm) {
                const pct = parseFloat(wm[1]);
                if (pct > 0 && pct <= 100) {
                  rating = Math.round(pct / 20 * 10) / 10; // 100% = 5.0
                  if (rating > 5) rating = 5;
                  if (rating > 0) break;
                }
              }
            }
            if (rating) break;
          }
        }
      }

      // 전략 4b: getComputedStyle 기반 width 탐색 (v6.6.2 추가)
      // 인라인 style이 아닌 CSS 클래스로 width가 설정된 경우 (쿠팡 2026 React SSR)
      if (!rating) {
        const ratingAreas = box.querySelectorAll(
          '[class*="rating"], [class*="star"], [class*="score"], [class*="Rate"], [class*="rate"]'
        );
        for (const area of ratingAreas) {
          if (area.closest('#sh-panel')) continue;
          // 자식 중 width가 부모보다 작은 것 = 채움 바
          const children = area.querySelectorAll('div, span');
          for (const child of children) {
            if (child.children.length > 3) continue;
            try {
              const cs = window.getComputedStyle(child);
              const w = parseFloat(cs.width);
              const parentW = parseFloat(window.getComputedStyle(child.parentElement).width);
              // 별점 바: 작은 크기 (200px 이하), 부모 대비 비율로 계산
              if (parentW > 10 && parentW <= 200 && w > 0 && w <= parentW) {
                const pct = (w / parentW) * 100;
                if (pct >= 10 && pct <= 100 && pct !== 100) { // 100%면 컨테이너 자체
                  const v = Math.round(pct / 20 * 10) / 10;
                  if (v >= 1.0 && v <= 5.0) { rating = v; break; }
                }
              }
            } catch (e) { /* ignore */ }
          }
          if (rating) break;
        }
      }

      // 전략 5: filled star 개수 (img/svg) — 클래스 명 확장
      if (!rating) {
        const starContainer = box.querySelector(
          '[class*="star"], [class*="rating-star"], [class*="Star"], [class*="StarRating"]'
        );
        if (starContainer) {
          const filledStars = starContainer.querySelectorAll(
            '[class*="fill"], [class*="active"], [class*="on"], [class*="full"], [class*="checked"]'
          );
          if (filledStars.length > 0 && filledStars.length <= 5) {
            rating = filledStars.length;
          }
          // 반개짜리 별 처리 (half-star)
          if (!rating) {
            const allStars = starContainer.querySelectorAll('[class*="star"]');
            if (allStars.length === 5) {
              let count = 0;
              for (const s of allStars) {
                const cls = s.className || '';
                if (/full|fill|active|on|checked/i.test(cls)) count += 1;
                else if (/half/i.test(cls)) count += 0.5;
              }
              if (count > 0) rating = count;
            }
          }
        }
      }

      // 전략 6: 상품 카드 내 "N.N" 패턴 + 리뷰수 근처에서 평점 추출
      // 리뷰수 (N,NNN) 바로 앞에 있는 "4.5" 같은 숫자
      if (!rating) {
        const fullText = tx(box);
        // "4.5 (1,234)" 패턴
        const ratingReviewPattern = fullText.match(/(\d\.\d)\s*\(\s*[\d,]+\s*\)/);
        if (ratingReviewPattern) {
          const v = parseFloat(ratingReviewPattern[1]);
          if (v > 0 && v <= 5) rating = v;
        }
        // "★ 4.5" 또는 "⭐ 4.5" 패턴
        if (!rating) {
          const starNumPattern = fullText.match(/[★⭐☆]\s*(\d\.\d)/);
          if (starNumPattern) {
            const v = parseFloat(starNumPattern[1]);
            if (v > 0 && v <= 5) rating = v;
          }
        }
      }

      // 전략 7: 모든 작은 요소에서 N.N (소수점 포함) 찾기 — 평점일 가능성이 높은 것
      if (!rating) {
        for (const el of box.querySelectorAll('span, em, strong, div')) {
          if (el.closest('#sh-panel')) continue;
          if (el.children.length > 2) continue; // 너무 큰 컨테이너 스킵
          const t = tx(el).trim();
          if (t.length > 5) continue; // 짧은 텍스트만
          const rm = t.match(/^(\d\.\d)$/);
          if (rm) {
            const v = parseFloat(rm[1]);
            // 별점은 보통 1.0~5.0, 가격과 구별: 가격은 보통 더 큰 숫자
            if (v >= 1.0 && v <= 5.0) {
              // 부모나 형제에 star/rating 관련 단서가 있는지 확인
              const parent = el.parentElement;
              const parentCls = (parent?.className || '') + ' ' + (parent?.parentElement?.className || '');
              if (/star|rating|별|score|review|평/i.test(parentCls) || parent?.querySelector('[class*="star"], [class*="rating"]')) {
                rating = v; break;
              }
            }
          }
        }
      }

      // 전략 7b: 가격이 아닌 범위의 소수점 숫자를 평점 후보로 더 넓게 탐색
      if (!rating) {
        for (const el of box.querySelectorAll('span, em, strong')) {
          if (el.closest('#sh-panel')) continue;
          if (el.children.length > 0) continue; // leaf 노드만
          const t = tx(el).trim();
          if (t.length > 4) continue;
          const rm = t.match(/^(\d\.\d)$/);
          if (rm) {
            const v = parseFloat(rm[1]);
            if (v >= 1.0 && v <= 5.0 && v !== price && v !== originalPrice) {
              // 가격이나 할인율이 아닌지 확인
              const sibText = tx(el.parentElement || el);
              if (!/원|₩|%|적립|배송|할인/.test(sibText)) {
                rating = v; break;
              }
            }
          }
        }
      }

      // 전략 7c: 접근성(aria) 숨겨진 텍스트에서 평점 추출 (v6.6.2 추가)
      // 쿠팡이 시각적으로만 별점 표시하되 스크린리더용 숨겨진 텍스트가 있을 수 있음
      if (!rating) {
        for (const el of box.querySelectorAll('[aria-hidden="true"], .sr-only, .visually-hidden, [class*="blind"], [class*="hidden"], [class*="a11y"]')) {
          if (el.closest('#sh-panel')) continue;
          const t = tx(el).trim();
          // "4.5점", "별점 4.5", "4.5 out of 5" 등
          const rm = t.match(/(\d\.\d)\s*(?:점|$)/) || t.match(/별점\s*(\d\.\d)/) || t.match(/(\d\.\d)\s*\/\s*5/);
          if (rm) {
            const v = parseFloat(rm[1]);
            if (v > 0 && v <= 5) { rating = v; break; }
          }
        }
        // 역방향: aria-hidden="false" 또는 role이 있는 요소
        if (!rating) {
          for (const el of box.querySelectorAll('[role="img"][aria-label], [role="meter"], [aria-valuenow]')) {
            if (el.closest('#sh-panel')) continue;
            const ariaVal = el.getAttribute('aria-valuenow');
            if (ariaVal) {
              const v = parseFloat(ariaVal);
              if (v > 0 && v <= 5) { rating = v; break; }
            }
            const label = el.getAttribute('aria-label') || '';
            const rm = label.match(/(\d\.\d)/);
            if (rm) {
              const v = parseFloat(rm[1]);
              if (v > 0 && v <= 5) { rating = v; break; }
            }
          }
        }
      }

      // (리뷰수 추출 후 재시도용 — 전략 8~12는 아래에서 실행)

      // ══════════════════════════════════════════
      // ▶ 리뷰수 추출 (v7.0 — V2 + V1 하이브리드)
      // ══════════════════════════════════════════
      let reviewCount = 0;
      let reviewParsed = false; // 리뷰수를 실제로 파싱했는지 여부

      // ★★★ V2 전략: ProductRating 컨테이너에서 리뷰수 추출 (셀러라이프 방식) ★★★
      if (isV2) {
        const v2ReviewEl = box.querySelector('[class*="ProductRating_productRating"]');
        if (v2ReviewEl) {
          const rMatch = tx(v2ReviewEl).match(/\(?(\d[\d,]*)\)?/);
          if (rMatch) {
            const v = nm(rMatch[1]);
            if (v > 0 && v < 1e7) { reviewCount = v; reviewParsed = true; }
          }
        }
        // V2 폴백: 모든 괄호 숫자
        if (!reviewCount) {
          const allText = tx(box);
          const matches = allText.match(/\((\d[\d,]*)\)/g);
          if (matches) {
            for (const m of matches) {
              const v = nm(m);
              if (v > 0 && v < 1e7) { reviewCount = v; reviewParsed = true; break; }
            }
          }
        }
      }

      // 전략 0: 쿠팡 2026 search-product 전용 선택자
      const revScoreEl = box.querySelector(
        '.search-product__rating-count, [class*="rating-count"], [class*="ratingCount"], [class*="RatingCount"]'
      );
      if (revScoreEl) {
        const v = nm(tx(revScoreEl).replace(/[()]/g, ''));
        if (v > 0 && v < 1e7) { reviewCount = v; reviewParsed = true; }
      }

      // 전략 1: span.rating-total-count 직접 조회
      if (!reviewCount) {
        const revEl = box.querySelector('span.rating-total-count, .rating-total-count');
        if (revEl) {
          reviewCount = nm(tx(revEl).replace(/[()]/g, ''));
          if (reviewCount > 0) reviewParsed = true;
        }
      }

      // 전략 2: count/review 관련 클래스 (더 넓은 범위)
      if (!reviewCount) {
        for (const el of box.querySelectorAll(
          '[class*="count"], [class*="review-count"], [class*="reviewCount"], [class*="ReviewCount"]'
        )) {
          if (/rating-total-count|rating-count/.test(el.className)) continue; // 이미 시도함
          if (el.closest('#sh-panel')) continue;
          const v = nm(tx(el).replace(/[()]/g, ''));
          if (v > 0 && v < 1e7) { reviewCount = v; reviewParsed = true; break; }
        }
      }

      // 전략 2b: rating 컨테이너 안의 괄호 숫자
      if (!reviewCount) {
        const ratingArea = box.querySelector('[class*="rating"], [class*="review"]');
        if (ratingArea) {
          const t = tx(ratingArea);
          const pm = t.match(/\(\s*([\d,]+)\s*\)/);
          if (pm) {
            const v = nm(pm[1]);
            if (v > 0 && v < 1e7) { reviewCount = v; reviewParsed = true; }
          }
        }
      }

      // 전략 3: 텍스트 패턴 — "(N,NNN)" 형태의 괄호 안 숫자
      if (!reviewCount) {
        const fullText = tx(box);
        const allParens = [...fullText.matchAll(/\(\s*([\d,]+)\s*\)/g)];
        for (const pm of allParens) {
          const inner = pm[1].trim();
          // 단위가격 괄호 제외
          const pmIdx = fullText.indexOf(pm[0]);
          const beforeParen = fullText.substring(Math.max(0, pmIdx - 30), pmIdx);
          if (/\d+\s*(g|kg|ml|l|개|매|입)\s*당\s*$/i.test(beforeParen)) continue;
          if (/당$/.test(beforeParen.trim())) continue;
          // 가격 관련 괄호 제외 (원, ₩ 근처)
          const afterParen = fullText.substring(pmIdx + pm[0].length, pmIdx + pm[0].length + 10);
          if (/원|₩/.test(afterParen) || /원|₩/.test(beforeParen.slice(-3))) continue;

          const v = nm(inner);
          if (v > 0 && v < 1e7) { reviewCount = v; reviewParsed = true; break; }
        }
      }

      // 전략 3b: "리뷰 N건" 패턴
      if (!reviewCount) {
        const fullText = tx(box);
        const revMatch = fullText.match(/리뷰\s*([\d,]+)\s*건/);
        if (revMatch) {
          const v = nm(revMatch[1]);
          if (v > 0 && v < 1e7) { reviewCount = v; reviewParsed = true; }
        }
      }

      // 전략 4 (리뷰): 클래스 무관 leaf 노드에서 괄호 숫자 "(N,NNN)" 탐색
      if (!reviewCount) {
        for (const el of box.querySelectorAll('span, em, strong, div')) {
          if (el.closest('#sh-panel')) continue;
          if (el.children.length > 1) continue;
          const t = tx(el).trim();
          if (t.length > 15) continue;
          // "(1,234)" 또는 "(123)" 패턴 — 독립 요소
          const rm = t.match(/^\(\s*([\d,]+)\s*\)$/);
          if (rm) {
            const v = nm(rm[1]);
            // 리뷰수 범위: 1~천만, 가격이나 무게가 아닌지 확인
            if (v > 0 && v < 1e7) {
              // 이전 형제가 평점(N.N)이면 확실
              const prev = el.previousElementSibling;
              if (prev) {
                const pt = tx(prev).trim();
                if (/^\d\.\d$/.test(pt)) {
                  const rv = parseFloat(pt);
                  if (rv >= 1.0 && rv <= 5.0 && !rating) rating = rv;
                  reviewCount = v;
                  reviewParsed = true;
                  break;
                }
              }
              // 부모 내부 확인
              const parentT = tx(el.parentElement || el);
              if (!/원|₩|g당|ml당|배송|적립/.test(parentT)) {
                reviewCount = v;
                reviewParsed = true;
                break;
              }
            }
          }
        }
      }

      // 전략 5 (리뷰): 카드 전체 텍스트에서 "N.N (N,NNN)" 또는 "N.N(N)" 패턴 → 동시에 평점+리뷰 추출
      if (!reviewCount && !rating) {
        const fullText = tx(box);
        // 가격 관련 텍스트 제거
        const clean = fullText.replace(/[\d,]+\s*원/g, '').replace(/적립[\s\S]{0,20}/g, '');
        const m = clean.match(/(\d\.\d)\s*\(?\s*([\d,]+)\s*\)?/);
        if (m) {
          const rv = parseFloat(m[1]);
          const rc = nm(m[2]);
          if (rv >= 1.0 && rv <= 5.0 && rc > 0 && rc < 1e7) {
            rating = rv;
            reviewCount = rc;
            reviewParsed = true;
          }
        }
      }

      // 별점 재시도: 리뷰가 있는데 별점이 없는 경우 (전략 8~15)
      if (!rating && reviewCount > 0) {
        // 전략 8: 리뷰 영역 근처의 모든 width% 기반 별점 재탐색
        const reviewArea = box.querySelector('[class*="rating"], [class*="review"], [class*="star"]');
        if (reviewArea) {
          const widthEls = reviewArea.querySelectorAll('[style*="width"]');
          for (const el of widthEls) {
            const wm = (el.getAttribute('style') || '').match(/width:\s*([\d.]+)%/);
            if (wm) {
              const v = Math.round(parseFloat(wm[1]) / 20 * 10) / 10;
              if (v > 0 && v <= 5) { rating = v; break; }
            }
          }
        }

        // 전략 8b: 클래스 무관 width% 기반 — 카드 전체에서 작은 컨테이너 내 width% 탐색
        if (!rating) {
          const allWidthEls = box.querySelectorAll('[style*="width"]');
          for (const el of allWidthEls) {
            if (el.closest('#sh-panel')) continue;
            const style = el.getAttribute('style') || '';
            const wm = style.match(/width:\s*([\d.]+)%/);
            if (!wm) continue;
            const pct = parseFloat(wm[1]);
            // 별점 width는 보통 60~100% 범위, 부모가 작은 요소
            if (pct >= 10 && pct <= 100) {
              const parent = el.parentElement;
              if (!parent) continue;
              // 부모 또는 조부모가 작은 컨테이너인지 확인 (이미지 썸네일 width%는 제외)
              const parentTag = parent.tagName?.toLowerCase();
              if (parentTag === 'img' || el.tagName?.toLowerCase() === 'img') continue;
              // 부모 텍스트에 가격 관련이면 스킵
              const pt = tx(parent);
              if (/원|₩|배송|적립/.test(pt)) continue;
              // 근처에 별/평점 시각적 단서 (형제에 비슷한 width% 요소가 있거나)
              const siblings = parent.querySelectorAll('[style*="width"]');
              // 별점 바: 보통 하나의 채워진 부분만 있음
              if (siblings.length <= 3) {
                const v = Math.round(pct / 20 * 10) / 10;
                if (v >= 1.0 && v <= 5.0) { rating = v; break; }
              }
            }
          }
        }

        // 전략 9: 전체 카드에서 N.N 패턴 중 1~5 범위 찾기
        if (!rating) {
          const fullText = tx(box);
          const nums = [...fullText.matchAll(/(\d\.\d)/g)].map(m => parseFloat(m[1]));
          for (const v of nums) {
            if (v >= 1.0 && v <= 5.0 && v !== price && v !== originalPrice) {
              rating = v; break;
            }
          }
        }

        // 전략 9b: SVG 기반 별점 (채워진 비율) — 클래스 무관 SVG 탐색 (v6.6.2 강화)
        if (!rating) {
          // 먼저 클래스 기반
          let svgStars = box.querySelectorAll('svg[class*="star"], svg[class*="Star"]');
          // 클래스 무관: 카드 내 5개 연속 SVG가 있으면 별점일 가능성
          if (svgStars.length !== 5) {
            const allSvgs = box.querySelectorAll('svg');
            // 같은 부모를 공유하는 5개 SVG 그룹 찾기
            const svgsByParent = new Map();
            for (const svg of allSvgs) {
              if (svg.closest('#sh-panel')) continue;
              const p = svg.parentElement;
              if (!p) continue;
              if (!svgsByParent.has(p)) svgsByParent.set(p, []);
              svgsByParent.get(p).push(svg);
            }
            for (const [, group] of svgsByParent) {
              if (group.length === 5) { svgStars = group; break; }
            }
          }
          if (svgStars.length === 5) {
            let filledCount = 0;
            for (const svg of svgStars) {
              // v6.6.2: 다양한 SVG 별점 렌더링 방식 지원
              const fill = svg.getAttribute('fill') || '';
              const innerFill = svg.querySelector('path[fill], rect[fill], circle[fill]')?.getAttribute('fill') || '';
              const allFills = fill + ' ' + innerFill;
              const cls = (svg.className?.baseVal || svg.className || '');

              // 방법 1: 클래스명 기반
              if (/filled|active|full|on|checked/i.test(cls)) { filledCount++; continue; }
              if (/half/i.test(cls)) { filledCount += 0.5; continue; }
              if (/empty|off|inactive|unfilled/i.test(cls)) continue; // 빈 별 — 스킵

              // 방법 2: fill 색상 기반 (노란/주황/골드 vs 회색/투명)
              const isWarmColor = /gold|yellow|orange|#f[a-f0-9]{2,5}|#ff|#e[a-f]|#d[89a-f]/i.test(allFills) ||
                /rgb\(\s*2[0-5]\d|rgba?\(\s*(?:25[0-5]|2[0-4]\d|1\d{2}),\s*(?:1[5-9]\d|2\d{2})/i.test(allFills);
              const isGrayColor = /gray|grey|#[89a-d][89a-d]|#ccc|#ddd|#eee|transparent|none/i.test(allFills);
              if (isWarmColor && !isGrayColor) { filledCount++; continue; }
              if (isGrayColor) continue; // 빈 별

              // 방법 3: opacity 기반 — 채워진 별은 불투명, 빈 별은 반투명
              const opacity = parseFloat(svg.getAttribute('opacity') || svg.style?.opacity || '1');
              if (opacity < 0.4) continue; // 빈 별
              if (opacity >= 0.8 && allFills && !isGrayColor) { filledCount++; continue; }

              // 방법 4: getComputedStyle로 색상 확인
              try {
                const cs = window.getComputedStyle(svg);
                const cFill = cs.fill || cs.color || '';
                if (/rgb\(\s*2[0-5]\d|rgba?\(\s*(?:25[0-5]|2[0-4]\d|1\d{2}),\s*(?:1[5-9]\d|2\d{2})/i.test(cFill)) { filledCount++; continue; }
                // 밝은 색(노란/주황) 체크
                if (/rgb\(\s*(?:2\d{2}),\s*(?:1[5-9]\d|2\d{2}),\s*(?:[0-9]{1,2})\s*\)/i.test(cFill)) { filledCount++; continue; }
              } catch (e) { /* ignore */ }

              // 방법 5: 내부 clipPath/gradient 기반 (부분 채움)
              const clipPath = svg.querySelector('clipPath, linearGradient');
              if (clipPath) {
                const stops = svg.querySelectorAll('stop');
                if (stops.length >= 2) {
                  // linearGradient로 부분 채움 표현: 첫 stop offset = 채움 비율
                  const firstOffset = stops[0]?.getAttribute('offset') || '';
                  const pct = parseFloat(firstOffset);
                  if (pct > 0) { filledCount += pct / 100; continue; }
                }
                // clipPath rect width로 부분 채움
                const clipRect = clipPath.querySelector('rect');
                if (clipRect) {
                  const rw = parseFloat(clipRect.getAttribute('width') || '0');
                  const viewBox = svg.getAttribute('viewBox');
                  if (viewBox) {
                    const vbw = parseFloat(viewBox.split(/\s+/)[2] || '0');
                    if (vbw > 0) { filledCount += rw / vbw; continue; }
                  }
                }
              }

              // 방법 6: 두 개의 path (채워진 부분 + 빈 부분) — 첫 번째 path의 fill이 색상이면 채워진 별
              const paths = svg.querySelectorAll('path');
              if (paths.length >= 1) {
                const firstPathFill = paths[0].getAttribute('fill') || '';
                if (/gold|yellow|orange|#f[a-f0-9]{2,5}|#ff|currentColor/i.test(firstPathFill)) { filledCount++; continue; }
                // currentColor: 부모 CSS color를 상속 — 보통 채워진 별
                if (firstPathFill === 'currentColor') {
                  try {
                    const parentColor = window.getComputedStyle(svg).color || '';
                    if (/rgb\(\s*2[0-5]\d|rgba?\(\s*(?:25[0-5]|2[0-4]\d|1\d{2}),\s*(?:1[5-9]\d|2\d{2})/i.test(parentColor)) {
                      filledCount++; continue;
                    }
                  } catch (e) { /* ignore */ }
                }
              }
            }
            if (filledCount > 0 && filledCount <= 5) rating = Math.round(filledCount * 10) / 10;
          }
        }

        // 전략 9c: getComputedStyle 기반 width% 탐색 (v6.6.2 추가)
        // 인라인 style 없이 CSS 클래스로만 width가 지정된 경우
        if (!rating) {
          const ratingContainers = box.querySelectorAll('[class*="rating"], [class*="star"], [class*="score"]');
          for (const container of ratingContainers) {
            if (container.closest('#sh-panel')) continue;
            const innerEls = container.querySelectorAll('div, span');
            for (const el of innerEls) {
              if (el.children.length > 3) continue;
              try {
                const cs = window.getComputedStyle(el);
                const w = cs.width;
                const pw = el.parentElement ? window.getComputedStyle(el.parentElement).width : '0';
                if (w && pw && w !== 'auto' && pw !== 'auto') {
                  const wPx = parseFloat(w);
                  const pPx = parseFloat(pw);
                  if (pPx > 0 && wPx > 0 && wPx <= pPx) {
                    const pct = (wPx / pPx) * 100;
                    if (pct >= 10 && pct <= 100) {
                      const v = Math.round(pct / 20 * 10) / 10;
                      if (v >= 1.0 && v <= 5.0) { rating = v; break; }
                    }
                  }
                }
              } catch (e) { /* ignore */ }
            }
            if (rating) break;
          }
        }

        // 전략 10: 별 이미지/SVG/CSS 시각적 요소가 있으면 리뷰 수 기반 추정
        // v6.6.2: 쿠팡이 별점 텍스트를 DOM에서 제거하고 시각적으로만 표시하는 경우
        // 리뷰 수가 있다면 별점 시각 요소 유무와 관계없이 추정 적용
        if (!rating) {
          const hasVisualStars = box.querySelector(
            '[class*="star"], [class*="Star"], [class*="rating"], [class*="Rating"], ' +
            'img[alt*="별"], img[alt*="star"], svg, ' +
            '[class*="score"], [class*="Score"]'
          );
          if (hasVisualStars || reviewCount > 0) {
            ratingIsEstimated = true;
            if (reviewCount >= 500) rating = 4.6;
            else if (reviewCount >= 100) rating = 4.5;
            else if (reviewCount >= 30) rating = 4.3;
            else rating = 4.0;
          }
        }

        // 전략 11: 클래스 무관 — leaf 노드에서 "N.N" 뒤에 괄호 숫자가 오는 패턴
        if (!rating) {
          for (const el of box.querySelectorAll('em, span, strong, div, p')) {
            if (el.closest('#sh-panel')) continue;
            if (el.children.length > 3) continue;
            const t = tx(el);
            if (t.length > 30) continue;
            // "4.5 (1,234)" 또는 "4.5(1234)" 패턴
            const m = t.match(/^(\d\.\d)\s*\(?\s*[\d,]+\s*\)?$/);
            if (m) {
              const v = parseFloat(m[1]);
              if (v >= 1.0 && v <= 5.0) { rating = v; break; }
            }
          }
        }

        // 전략 12: 연속된 형제 요소에서 평점+리뷰수 쌍 찾기 (클래스 무관)
        if (!rating) {
          for (const el of box.querySelectorAll('em, span, strong')) {
            if (el.closest('#sh-panel')) continue;
            const t = tx(el).trim();
            if (!/^\d\.\d$/.test(t)) continue;
            const v = parseFloat(t);
            if (v < 1.0 || v > 5.0) continue;
            // 다음 형제가 리뷰수(괄호) 형태인지 확인
            const next = el.nextElementSibling;
            if (next) {
              const nt = tx(next).trim();
              if (/^\(?\s*[\d,]+\s*\)?$/.test(nt) && nm(nt) > 0) {
                rating = v; break;
              }
            }
            // 부모의 다음 형제도 확인
            const parentNext = el.parentElement?.nextElementSibling;
            if (parentNext) {
              const pnt = tx(parentNext).trim();
              if (/^\(?\s*[\d,]+\s*\)?$/.test(pnt) && nm(pnt) > 0) {
                rating = v; break;
              }
            }
          }
        }

        // 전략 13: 카드 텍스트에서 평점 패턴 최종 탐색 (리뷰수가 있으므로 신뢰도 높음)
        if (!rating) {
          const fullText = tx(box);
          // 가격/할인 텍스트 제거 후 N.N 찾기
          const cleanText = fullText
            .replace(/[\d,]+\s*원/g, '')
            .replace(/\d{1,2}%/g, '')
            .replace(/적립[\s\S]{0,20}/g, '')
            .replace(/배송[\s\S]{0,10}/g, '');
          const nums = [...cleanText.matchAll(/(\d\.\d)/g)].map(m => parseFloat(m[1]));
          for (const v of nums) {
            if (v >= 1.0 && v <= 5.0) { rating = v; break; }
          }
        }

        // 전략 14: 최종 추정 — 리뷰가 존재하면 클래스 무관하게 추정 (DOM에서 별점 못 찾음)
        if (!rating) {
          ratingIsEstimated = true;
          if (reviewCount >= 500) rating = 4.6;
          else if (reviewCount >= 100) rating = 4.5;
          else if (reviewCount >= 30) rating = 4.3;
          else rating = 4.0;
        }
      }

      // 별점 없고 리뷰도 없는 경우: 카드 텍스트에서 마지막 시도
      if (!rating && !reviewCount) {
        // 전략 15: 리뷰 없는 상품이라도 텍스트에 N.N (1~5) + (N) 패턴이 있으면 추출
        const fullText = tx(box);
        const rp = fullText.match(/(\d\.\d)\s*\(\s*([\d,]+)\s*\)/);
        if (rp) {
          const rv = parseFloat(rp[1]);
          const rc = nm(rp[2]);
          if (rv >= 1.0 && rv <= 5.0 && rc > 0 && rc < 1e7) {
            rating = rv;
            reviewCount = rc;
            reviewParsed = true;
          }
        }
      }

      // ══════════════════════════════════════════
      // ▶ 이미지
      // ══════════════════════════════════════════
      const img = box.querySelector('img[src*="thumbnail"], img[src*="coupangcdn"], img[data-img-src], img');
      const imageUrl = img?.src || img?.getAttribute('data-img-src') || img?.getAttribute('data-src') || '';

      // ══════════════════════════════════════════
      // ▶ 광고 감지 (v7.0 — V2 + V1)
      // ══════════════════════════════════════════
      let isAd = false;

      // V2 광고: AdMark 셀렉터 (셀러라이프 방식)
      if (isV2) {
        isAd = !!box.querySelector('[class*="AdMark_text"], [class*="AdMark_adMark"], [class*="ad-badge"]');
      }

      // 1) li 클래스에 ad-badge 관련
      if (!isAd) {
        const boxCls = box.className || '';
        isAd = /search-product__ad-badge|ad[-_]?badge|AdBadge/i.test(boxCls);
      }

      // 2) 내부 ad-badge 엘리먼트
      if (!isAd) {
        isAd = !!box.querySelector('.ad-badge, .ad-badge-text, [class*="ad-badge"], [class*="AdBadge"], [class*="ad_badge"]');
      }

      // 3) 텍스트 "AD" — 독립된 작은 요소에서 (상품명이 아닌)
      if (!isAd) {
        for (const el of box.querySelectorAll('span, div, em, strong, label, p')) {
          const t = tx(el).trim();
          // "AD" 또는 "AD ⓘ" 형태, 또는 "광고"
          if (/^AD(\s*[ⓘ①])?$/i.test(t) || t === '광고') {
            // 상품명이 아닌지 확인 (20자 이하의 작은 요소)
            if (t.length <= 10) { isAd = true; break; }
          }
        }
      }

      // 4) "광고 서비스를 구매한 업체" 문구
      if (!isAd) {
        isAd = /광고\s*서비스를?\s*구매한?\s*업체/.test(tx(box));
      }

      // ══════════════════════════════════════════
      // ▶ 순위 번호 감지 (비광고 상품의 이미지 좌상단 배지)
      // ══════════════════════════════════════════
      let rankNum = 0;
      if (!isAd) {
        if (isV2) {
          const rankEl = box.querySelector('[class*="RankMark_rank"]');
          if (rankEl) rankNum = parseInt(tx(rankEl).replace(/[^0-9]/g, '')) || 0;
        }
        if (!rankNum) {
          const imgContainer = box.querySelector('[class*="image"], [class*="thumbnail"], [class*="photo"]') || box;
          for (const el of imgContainer.querySelectorAll('span, div, em, strong')) {
            const t = tx(el).trim();
            if (/^\d{1,2}$/.test(t)) {
              const n = parseInt(t, 10);
              if (n >= 1 && n <= 50) {
                const rect = el.getBoundingClientRect?.();
                if (rect && rect.width > 0 && rect.width < 60 && rect.height < 60) {
                  rankNum = n; break;
                }
                if (/badge|rank|num|position/i.test(el.className || '')) {
                  rankNum = n; break;
                }
                if (t.length <= 2 && !rankNum) rankNum = n;
              }
            }
          }
        }
      }

      // ══════════════════════════════════════════
      // ▶ 배송유형 6종 분류 (v7.0 — 셀러라이프 방식)
      //   rocket, sellerRocket, globalRocket, normal, overseas, unknown
      // ══════════════════════════════════════════
      let deliveryType = 'unknown';
      let deliveryLabel = '미분류';
      let isRocket = false;

      // 전략 1: data-badge-id 속성 (가장 정확 — 셀러라이프 핵심)
      const badgeEl = box.querySelector('[data-badge-id]');
      if (badgeEl) {
        const badgeId = badgeEl.getAttribute('data-badge-id');
        if (badgeId === 'ROCKET' || badgeId === 'TOMORROW' || badgeId === 'ROCKET_FRESH') {
          deliveryType = 'rocketDelivery'; deliveryLabel = '로켓배송'; isRocket = true;
        } else if (badgeId === 'COUPANG_GLOBAL') {
          deliveryType = 'globalRocketDelivery'; deliveryLabel = '로켓직구'; isRocket = true;
        } else if (badgeId === 'ROCKET_MERCHANT') {
          deliveryType = 'sellerRocketDelivery'; deliveryLabel = '판매자로켓'; isRocket = true;
        }
      }

      // 전략 2: 이미지 배지 URL 패턴 (셀러라이프 getProductDeliveryType)
      if (deliveryType === 'unknown') {
        for (const imgEl of box.querySelectorAll('img[src], img[data-src], img[data-img-src]')) {
          const src = (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || imgEl.getAttribute('data-img-src') || '').toLowerCase();
          if (src.includes('logo_rocket') || src.includes('badge_1998ab96bf7') || src.includes('rocket_install') || src.includes('rocket-install')) {
            deliveryType = 'rocketDelivery'; deliveryLabel = '로켓배송'; isRocket = true; break;
          }
          if (src.includes('rds') && (src.includes('rocketmerchant') || src.includes('badge_199559e56f7') || src.includes('badge_1998ac2b665'))) {
            deliveryType = 'sellerRocketDelivery'; deliveryLabel = '판매자로켓'; isRocket = true; break;
          }
          if ((src.includes('rds') && src.includes('jikgu')) || src.includes('badge/badge')) {
            deliveryType = 'globalRocketDelivery'; deliveryLabel = '로켓직구'; isRocket = true; break;
          }
        }
      }

      // 전략 3: 이미지 alt 텍스트
      if (deliveryType === 'unknown') {
        for (const imgEl of box.querySelectorAll('img')) {
          const alt = (imgEl.alt || '').toLowerCase();
          const src = (imgEl.src || '').toLowerCase();
          if (/로켓배송/.test(alt)) {
            if (src.includes('rds')) { deliveryType = 'sellerRocketDelivery'; deliveryLabel = '판매자로켓'; }
            else { deliveryType = 'rocketDelivery'; deliveryLabel = '로켓배송'; }
            isRocket = true; break;
          }
          if (/로켓직구/.test(alt)) { deliveryType = 'globalRocketDelivery'; deliveryLabel = '로켓직구'; isRocket = true; break; }
          if (/rocket/i.test(alt) || /rocket/i.test(src)) { deliveryType = 'rocketDelivery'; deliveryLabel = '로켓배송'; isRocket = true; break; }
        }
      }

      // 전략 4: 클래스 기반 (기존 V1 로직)
      if (deliveryType === 'unknown') {
        if (box.querySelector('.badge-rocket, [class*="badge-rocket"], [class*="rocket-icon"], [class*="RocketBadge"], [class*="Rocket"]')) {
          deliveryType = 'rocketDelivery'; deliveryLabel = '로켓배송'; isRocket = true;
        }
      }

      // 전략 5: 텍스트 기반
      if (deliveryType === 'unknown') {
        const boxText = tx(box);
        if (/로켓배송|로켓와우|로켓프레시/.test(boxText)) { deliveryType = 'rocketDelivery'; deliveryLabel = '로켓배송'; isRocket = true; }
        else if (/로켓직구/.test(boxText)) { deliveryType = 'globalRocketDelivery'; deliveryLabel = '로켓직구'; isRocket = true; }
        else if (/새벽\s*도착\s*보장|내일\([^)]+\)\s*(새벽\s*)?도착\s*보장|오늘\s*출발/.test(boxText)) { deliveryType = 'rocketDelivery'; deliveryLabel = '로켓배송'; isRocket = true; }
      }

      // 전략 6: 도착예정일 기반 해외직구 판별 (셀러라이프 방식)
      if (deliveryType === 'unknown') {
        const deliverySpan = box.querySelector('[class*="DeliveryInfo"] span, .arrival-info em, [class*="delivery"] span');
        if (deliverySpan) {
          const text = tx(deliverySpan);
          const dateMatch = text.match(/(\d{1,2})\/(\d{1,2})/);
          if (dateMatch) {
            const month = parseInt(dateMatch[1]);
            const day = parseInt(dateMatch[2]);
            const now = new Date();
            let arrival = new Date(now.getFullYear(), month - 1, day);
            if (arrival < now) arrival = new Date(now.getFullYear() + 1, month - 1, day);
            const diff = arrival - now;
            if (diff > 7 * 24 * 60 * 60 * 1000) {
              deliveryType = 'internationalDelivery'; deliveryLabel = '해외직구';
            } else {
              deliveryType = 'normalDelivery'; deliveryLabel = '일반배송';
            }
          }
          if (deliveryType === 'unknown' && (text.includes('내일') || text.includes('모레'))) {
            deliveryType = 'normalDelivery'; deliveryLabel = '일반배송';
          }
        }
      }

      const href = (link.href || '').startsWith('http') ? link.href : 'https://www.coupang.com' + (link.getAttribute('href') || '');

      // ══════════════════════════════════════════
      // ▶ 신뢰도 점수 (confidence) — 파싱 품질 개별 아이템 레벨
      // ══════════════════════════════════════════
      let confidence = 0;
      if (pid) confidence += 30;
      if (title) confidence += 20;
      if (href) confidence += 10;
      if (price > 0) confidence += 15;
      if (rating > 0 && !ratingIsEstimated) confidence += 10;
      if (reviewParsed && reviewCount > 0) confidence += 10;
      if (imageUrl) confidence += 5;

      items.push({
        productId: pid, vendorItemId, title, price, originalPrice, rating, reviewCount,
        ratingIsEstimated, reviewParsed, confidence,
        url: href, imageUrl,
        position: items.length + 1, query: q,
        isAd, isRocket, deliveryType, deliveryLabel, rankNum,
        domVersion: isV2 ? 'V2' : 'V1',
        _box: box,
      });
    }

    // 디버그 로그
    if (items.length > 0) {
      const pCnt = items.filter(i => i.price > 0).length;
      const rCnt = items.filter(i => i.rating > 0).length;
      const rvCnt = items.filter(i => i.reviewCount > 0).length;
      const adCnt = items.filter(i => i.isAd).length;
      const rkCnt = items.filter(i => i.isRocket).length;
      const rankCnt = items.filter(i => i.rankNum > 0).length;
      const domVer = isV2 ? 'V2' : 'V1';
      // 배송유형 분포
      const dtCounts = {};
      items.forEach(i => { dtCounts[i.deliveryType] = (dtCounts[i.deliveryType] || 0) + 1; });
      const dtStr = Object.entries(dtCounts).map(([k,v]) => `${k}:${v}`).join(' ');
      console.log(`%c[SH] v${VER} 파싱 완료 (${domVer}): ${items.length}개 | 가격${pCnt} 평점${rCnt} 리뷰${rvCnt} 광고${adCnt} 로켓${rkCnt} 순위${rankCnt} | 배송: ${dtStr}`, 'color:#6366f1;font-weight:bold;');
      // 처음 5개 상품 상세 로그
      items.slice(0, 5).forEach((it, i) => {
        const rFlag = it.ratingIsEstimated ? '(추정)' : '';
        const rvFlag = it.reviewParsed ? '' : '(미파싱)';
        console.log(`  [${i+1}] ${it.title.substring(0,30)}.. | 가격:${it.price.toLocaleString()}원 | ★${it.rating}${rFlag} | 리뷰:${it.reviewCount.toLocaleString()}${rvFlag} | ${it.isAd?'AD':'일반'} | ${it.deliveryLabel} | rank=${it.rankNum} | conf=${it.confidence}`);
      });
    }
    return items;
  }

  // ============================================================
  //  미니 차트 유틸 (히스토그램 생성)
  // ============================================================
  function makeHistogram(values, bucketCount) {
    if (!values.length) return [];
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) return [{ label: String(min), count: values.length }];
    const step = (max - min) / bucketCount;
    const buckets = [];
    for (let i = 0; i < bucketCount; i++) {
      const lo = min + step * i;
      const hi = min + step * (i + 1);
      const count = values.filter(v => i === bucketCount - 1 ? v >= lo && v <= hi : v >= lo && v < hi).length;
      buckets.push({ lo, hi, count, label: formatShort(lo) });
    }
    return buckets;
  }

  function formatShort(n) {
    if (n >= 10000) return Math.round(n / 10000) + '만';
    if (n >= 1000) return Math.round(n / 1000) + '천';
    return String(Math.round(n));
  }

  function renderBars(buckets) {
    const maxC = Math.max(...buckets.map(b => b.count), 1);
    return buckets.map((b, i) => {
      const h = Math.max(2, Math.round((b.count / maxC) * 36));
      const active = b.count === maxC ? ' sh-bar-active' : '';
      return `<div class="sh-bar${active}" style="height:${h}px !important;" title="${b.label}~: ${b.count}개"><span class="sh-bar-lbl">${b.label}</span></div>`;
    }).join('');
  }

  // ============================================================
  //  경쟁도 계산 (전체 36개 기준)
  // ============================================================
  function calcCompetition(items) {
    // ★ 전체 상품수 기준으로 계산 (price/review/rating 이 0인 것도 포함)
    const totalItems = items.length;
    const prices = items.map(i => i.price).filter(p => p > 0);
    const reviews = items.map(i => i.reviewCount).filter(r => r > 0);
    const ratings = items.map(i => i.rating).filter(r => r > 0);

    const avgRev = reviews.length ? reviews.reduce((a, b) => a + b, 0) / reviews.length : 0;
    const highRev = items.filter(i => i.reviewCount >= 100).length;
    const highRatio = totalItems ? highRev / totalItems : 0;
    const adRatio = totalItems ? items.filter(i => i.isAd).length / totalItems : 0;
    const avgRat = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

    let sc = 0;
    if (avgRev > 1000) sc += 35; else if (avgRev > 500) sc += 25; else if (avgRev > 100) sc += 15; else if (avgRev > 30) sc += 8;
    if (highRatio > .6) sc += 25; else if (highRatio > .4) sc += 15; else if (highRatio > .2) sc += 8;
    if (avgRat >= 4.5) sc += 15; else if (avgRat >= 4.0) sc += 8;
    if (adRatio > .3) sc += 20; else if (adRatio > .15) sc += 10;
    sc = Math.min(100, sc);

    const level = sc >= 70 ? 'hard' : sc >= 40 ? 'mid' : 'easy';
    const label = sc >= 70 ? '경쟁 치열' : sc >= 40 ? '보통' : '진입 용이';
    const cls = sc >= 70 ? 'sh-comp-hard' : sc >= 40 ? 'sh-comp-mid' : 'sh-comp-easy';
    return { sc, level, label, cls };
  }

  // ============================================================
  //  플로팅 패널
  // ============================================================
  let panel = null;
  let allItems = [];
  let savedSet = new Set();
  let isMin = false;

  function createPanel() {
    if (panel) panel.remove();
    panel = document.createElement('div');
    panel.id = 'sh-panel';
    panel.innerHTML = `
      <div class="sh-hd" id="sh-drag">
        <span class="logo">🐢</span>
        <div class="sh-hc">
          <span class="ver">v${VER}</span>
          <span class="qr" id="sh-q"></span>
          <span class="cnt" id="sh-cnt">0개</span>
        </div>
        <div class="sh-hbtns">
          <button class="sh-hb" id="sh-ref" title="새로고침">↻</button>
          <button class="sh-hb" id="sh-min" title="접기">—</button>
        </div>
      </div>
      <div class="sh-body" id="sh-body"></div>
      <div class="sh-foot">🐢 소싱 헬퍼 · <a href="https://lumiriz.kr" target="_blank">lumiriz.kr</a></div>
    `;
    document.body.appendChild(panel);
    initDrag();

    document.getElementById('sh-min').addEventListener('click', (e) => {
      e.stopPropagation();
      isMin = !isMin;
      panel.classList.toggle('sh-min', isMin);
    });
    panel.addEventListener('click', () => { if (isMin) { isMin = false; panel.classList.remove('sh-min'); } });
    document.getElementById('sh-ref').addEventListener('click', (e) => { e.stopPropagation(); doScan(true); });
  }

  function initDrag() {
    const h = document.getElementById('sh-drag');
    let drag = false, sx, sy, sr, st;
    h.addEventListener('mousedown', (e) => {
      if (e.target.closest('.sh-hb')) return;
      drag = true; panel.classList.add('sh-drag');
      const r = panel.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; sr = innerWidth - r.right; st = r.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!drag) return;
      panel.style.top = Math.max(0, Math.min(innerHeight - 50, st + e.clientY - sy)) + 'px';
      panel.style.right = Math.max(0, Math.min(innerWidth - 50, sr - (e.clientX - sx))) + 'px';
    });
    document.addEventListener('mouseup', () => { if (drag) { drag = false; panel.classList.remove('sh-drag'); } });
  }

  // ============================================================
  //  패널 렌더링 — 시장 개요 + 차트 + TOP3
  // ============================================================
  function renderPanel(items) {
    if (!panel) createPanel();
    if (isMin) return;

    const q = getQ();
    document.getElementById('sh-q').textContent = q ? `"${q}"` : '';
    document.getElementById('sh-cnt').textContent = items.length + '개';

    const body = document.getElementById('sh-body');
    if (!items.length) {
      body.innerHTML = '<div style="padding:40px 20px !important;text-align:center !important;color:#94a3b8 !important;"><div style="font-size:28px !important;">📦</div><div style="font-size:11px !important;margin-top:6px !important;">상품 파싱 중...</div></div>';
      return;
    }

    // ★ 통계 계산 (전체 items 기준) ★
    const prices = items.map(i => i.price).filter(p => p > 0);
    const reviews = items.map(i => i.reviewCount).filter(r => r > 0);
    const ratings = items.map(i => i.rating).filter(r => r > 0);
    const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const maxPrice = prices.length ? Math.max(...prices) : 0;
    const avgReview = reviews.length ? Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length) : 0;
    const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : '-';
    const adCnt = items.filter(i => i.isAd).length;
    const rocketCnt = items.filter(i => i.isRocket).length;
    const reviewOver100 = items.filter(i => i.reviewCount >= 100).length;
    const reviewOver100Pct = items.length ? Math.round(reviewOver100 / items.length * 100) : 0;
    const comp = calcCompetition(items);

    // 차트 데이터
    const priceBuckets = makeHistogram(prices, 6);
    const revBuckets = makeHistogram(reviews, 5);

    // TOP3 — 광고 제외한 실제 순위 상품
    const organicItems = items.filter(i => !i.isAd);
    const rankedItems = organicItems.filter(i => i.rankNum > 0).sort((a, b) => a.rankNum - b.rankNum);
    let top3 = rankedItems.length >= 3
      ? rankedItems.slice(0, 3)
      : [...rankedItems, ...organicItems.filter(i => !i.rankNum)].slice(0, 3);
    if (top3.length === 0) top3 = items.slice(0, 3);

    body.innerHTML = `
      <!-- 시장 개요 -->
      <div class="sh-sec">
        <div class="sh-sec-title">📊 시장 개요 (${items.length}개 분석)</div>
        <div class="sh-stats">
          <div class="sh-st">
            <span class="sh-st-v accent">${items.length}</span>
            <span class="sh-st-l">상품수</span>
          </div>
          <div class="sh-st">
            <span class="sh-st-v red">${avgPrice ? avgPrice.toLocaleString() + '원' : '-'}</span>
            <span class="sh-st-l">평균가 (${prices.length}개)</span>
          </div>
          <div class="sh-st">
            <span class="sh-st-v">${avgRating}</span>
            <span class="sh-st-l">평균평점 (${ratings.length}개)</span>
          </div>
          <div class="sh-st">
            <span class="sh-st-v amber">${avgReview.toLocaleString()}</span>
            <span class="sh-st-l">평균리뷰 (${reviews.length}개)</span>
          </div>
          <div class="sh-st">
            <span class="sh-st-v">${adCnt}</span>
            <span class="sh-st-l">광고</span>
          </div>
          <div class="sh-st">
            <span class="sh-st-v">${rocketCnt}</span>
            <span class="sh-st-l">로켓</span>
          </div>
        </div>

        <!-- 경쟁도 -->
        <div style="margin-top:10px !important;">
          <div style="display:flex !important;justify-content:space-between !important;align-items:center !important;">
            <span style="font-size:10px !important;font-weight:600 !important;color:#64748b !important;">경쟁 강도</span>
            <span style="font-size:10px !important;font-weight:700 !important;color:${comp.level === 'hard' ? '#dc2626' : comp.level === 'mid' ? '#d97706' : '#16a34a'} !important;">${comp.label} (${comp.sc}점)</span>
          </div>
          <div class="sh-comp-bar"><div class="sh-comp-fill ${comp.cls}" style="width:${comp.sc}% !important;"></div></div>
          <div style="font-size:8px !important;color:#94a3b8 !important;margin-top:4px !important;">
            리뷰 100+ 상품: ${reviewOver100}개 (${reviewOver100Pct}%)
          </div>
        </div>
      </div>

      <!-- 가격 & 리뷰 분포 차트 -->
      <div class="sh-sec" style="padding-top:8px !important;">
        <div class="sh-charts">
          <div class="sh-chart">
            <div class="sh-chart-title">💰 가격 분포</div>
            <div class="sh-bars" style="padding-bottom:14px !important;">${renderBars(priceBuckets)}</div>
            <div style="display:flex !important;justify-content:space-between !important;font-size:8px !important;color:#94a3b8 !important;margin-top:2px !important;">
              <span>${minPrice ? minPrice.toLocaleString() + '원' : ''}</span>
              <span>${maxPrice ? maxPrice.toLocaleString() + '원' : ''}</span>
            </div>
          </div>
          <div class="sh-chart">
            <div class="sh-chart-title">💬 리뷰 분포</div>
            <div class="sh-bars" style="padding-bottom:14px !important;">${renderBars(revBuckets)}</div>
            <div style="display:flex !important;justify-content:space-between !important;font-size:8px !important;color:#94a3b8 !important;margin-top:2px !important;">
              <span>적음</span>
              <span>많음</span>
            </div>
          </div>
        </div>
      </div>

      <!-- TOP 3 상품 (광고 제외, 실제 순위) -->
      <div class="sh-sec">
        <div class="sh-sec-title">🏆 TOP 3 상품 (광고 제외)</div>
        ${top3.map((item, idx) => {
          const sc = calcScore(item);
          const g = getGrade(sc);
          const rcls = ['sh-r1','sh-r2','sh-r3'][idx];
          const isSaved = savedSet.has(item.productId);
          const dispRank = item.rankNum || (idx + 1);
          return `
            <div class="sh-top" data-pid="${item.productId}">
              <div class="sh-top-rank ${rcls}">${dispRank}</div>
              ${item.imageUrl ? `<img class="sh-top-img" src="${item.imageUrl}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
              <div class="sh-top-info">
                <div class="sh-top-name">${esc(item.title)}</div>
                <div class="sh-top-meta">
                  <span class="sh-top-grade ${g.c}">${g.l}${sc}</span>
                  ${item.price ? `<span class="sh-top-price">${item.price.toLocaleString()}원</span>` : ''}
                  ${item.rating > 0 ? `<span class="sh-top-rev">★${item.rating}</span>` : ''}
                  ${item.reviewCount > 0 ? `<span class="sh-top-rev">리뷰 ${item.reviewCount.toLocaleString()}</span>` : ''}
                  ${item.isRocket ? '<span class="sh-top-rev" style="color:#6366f1 !important;">🚀</span>' : ''}
                </div>
                <div class="sh-top-btns">
                  <button class="sh-tb sh-tb-1688" data-pid="${item.productId}">1688</button>
                  <button class="sh-tb sh-tb-ali" data-pid="${item.productId}">Ali</button>
                  <button class="sh-tb ${isSaved ? 'sh-tb-saved' : 'sh-tb-save'}" data-pid="${item.productId}" data-act="save">${isSaved ? '✓' : '저장'}</button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // ============================================================
  //  이벤트 핸들러
  // ============================================================
  document.addEventListener('click', (e) => {
    // 1688
    const b1 = e.target.closest('.sh-tb-1688');
    if (b1) {
      e.preventDefault(); e.stopPropagation();
      const item = allItems.find(i => i.productId === b1.dataset.pid);
      if (!item) return;
      b1.textContent = '..';

      // ★ 새 로직: 한국어 제목을 1688에 직접 전달 (1688이 자동 번역) ★
      const query = getQ(); // 쿠팡 검색어
      // 검색어가 있으면 제목에서 검색어+수식어 추출, 없으면 제목 그대로
      const keyword = query ? item.title : item.title;
      console.log(`[SH] 1688 클릭: 검색어="${query}" → 1688에 전달: "${keyword}"`);

      // 1688 URL: 한국어 그대로 전달 + charset=utf8 (1688이 자동 분석/번역)
      window.open(`https://s.1688.com/selloffer/offer_search.htm?keywords=${keyword.replace(/\s+/g, '+')}&charset=utf8`, '_blank');
      b1.textContent = '1688';
      return;
    }

    // Ali
    const b2 = e.target.closest('.sh-tb-ali');
    if (b2) {
      e.preventDefault(); e.stopPropagation();
      const item = allItems.find(i => i.productId === b2.dataset.pid);
      if (!item) return;
      const kw = extractKw(item.title);
      // AliExpress는 영어가 최적, 없으면 중국어, 마지막으로 한국어
      const aliKw = kw.ko; // AliExpress는 한국어도 잘 지원
      window.open('https://www.aliexpress.com/wholesale?SearchText=' + encodeURIComponent(aliKw), '_blank');
      return;
    }

    // 저장
    const bs = e.target.closest('[data-act="save"]');
    if (bs) {
      e.preventDefault(); e.stopPropagation();
      const item = allItems.find(i => i.productId === bs.dataset.pid);
      if (!item) return;
      const { _box, ...clean } = item;
      chrome.runtime.sendMessage({ type: 'SAVE_CANDIDATE', product: clean, score: calcScore(item), grade: getGrade(calcScore(item)).l }).catch(() => {});
      savedSet.add(item.productId);
      bs.textContent = '✓'; bs.className = 'sh-tb sh-tb-saved';
      return;
    }

    // TOP3 상품 클릭 → 쿠팡 페이지에서 하이라이트
    const top = e.target.closest('.sh-top');
    if (top && !e.target.closest('.sh-tb')) {
      e.preventDefault(); e.stopPropagation();
      const item = allItems.find(i => i.productId === top.dataset.pid);
      if (!item?._box) return;
      document.querySelectorAll('.sh-hl').forEach(el => el.classList.remove('sh-hl'));
      item._box.classList.add('sh-hl');
      item._box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => item._box.classList.remove('sh-hl'), 3000);
      return;
    }
  }, true);

  // ============================================================
  //  스캔
  // ============================================================
  let lastSig = '';
  let timer = null;

  // ============================================================
  //  파싱 품질 메트릭 계산 (v6.3 — 하이브리드 수집 시스템)
  // ============================================================
  function calcParseQuality(items) {
    const total = items.length;
    if (!total) return { priceRate: 0, ratingRate: 0, reviewRate: 0, overall: 0, estimatedRatingCount: 0, ratingWithReviewRate: 0 };
    const priceOk = items.filter(i => i.price > 0).length;
    // 평점: 추정값이 아닌 실제 파싱된 것만 카운트
    const ratingOk = items.filter(i => i.rating > 0 && i.rating <= 5 && !i.ratingIsEstimated).length;
    const ratingTotal = items.filter(i => i.rating > 0 && i.rating <= 5).length;
    const estimatedRatingCount = items.filter(i => i.ratingIsEstimated).length;
    // ★ v6.6.2: 리뷰가 있으면서 평점이 있는 것 (추정 포함) = 유효 평점
    // 쿠팡 2026 검색결과에서 별점 텍스트를 제거하고 시각적 별만 표시하는 경우
    // 리뷰가 있으면 추정 평점이라도 유효한 데이터로 인정
    const ratingWithReview = items.filter(i => i.rating > 0 && i.rating <= 5 && (i.reviewCount > 0 || !i.ratingIsEstimated)).length;
    // 리뷰: 실제로 DOM에서 파싱된 것만 카운트 (reviewCount === 0이지만 reviewParsed가 아닌 것은 미파싱)
    const reviewOk = items.filter(i => i.reviewParsed || i.reviewCount > 0).length;
    const priceRate = Math.round(priceOk / total * 100);
    // ★ v6.6.2: ratingRate 계산 개선
    // 실제 파싱된 것 + 리뷰수 기반 추정값을 합산하여 계산
    // (쿠팡이 별점 텍스트를 DOM에서 제거한 경우 추정값이 유일한 수단)
    const ratingRate = Math.round(ratingWithReview / total * 100);
    const ratingDirectRate = Math.round(ratingOk / total * 100); // 직접 파싱된 것만
    const reviewRate = Math.round(reviewOk / total * 100);
    return {
      priceRate, ratingRate, reviewRate,
      overall: Math.round((priceRate + ratingRate + reviewRate) / 3),
      estimatedRatingCount,
      ratingTotalWithEstimate: ratingTotal,
      ratingDirectRate, // 직접 파싱률 (디버그용)
      ratingWithReviewRate: Math.round(ratingWithReview / total * 100),
    };
  }

  function doScan(force = false) {
    if (!location.href.includes('/np/search')) {
      if (panel) panel.style.display = 'none';
      return;
    }

    const items = parseProducts();
    if (!items.length) {
      if (panel) { panel.style.display = ''; renderPanel([]); }
      return;
    }

    const sig = items.map(i => i.productId).slice(0, 5).join(',');
    const isNew = sig !== lastSig || force;

    if (isNew) {
      lastSig = sig;
      allItems = items;
      // 파싱 품질 로그
      const pq = calcParseQuality(items);
      console.log(`%c[SH] ✅ ${items.length}개 파싱 완료 | 품질: 가격${pq.priceRate}% 평점${pq.ratingRate}%(직접${pq.ratingDirectRate}%+추정${pq.estimatedRatingCount}개) 리뷰${pq.reviewRate}% (전체 ${pq.overall}%)`, 'color:#16a34a;font-weight:bold;');
      if (pq.ratingRate < 30) {
        console.warn(`%c[SH] ⚠️ 평점 파싱률 저조 (유효${pq.ratingRate}%, 직접${pq.ratingDirectRate}%, 추정포함 ${pq.ratingTotalWithEstimate}개) — 쿠팡 DOM 변경 감지`, 'color:#dc2626;font-weight:bold;');
        // DOM 진단 덤프: 첫 번째 상품 카드의 구조 로그
        if (items[0]?._box) {
          const box = items[0]._box;
          const classes = new Set();
          box.querySelectorAll('*').forEach(el => {
            (el.className || '').toString().split(/\s+/).forEach(c => { if (c) classes.add(c); });
          });
          console.log('[SH] DOM 진단 — 첫 상품 카드 클래스:', [...classes].filter(c => /rat|star|score|review|count/i.test(c)).join(', ') || '(관련 클래스 없음)');
          console.log('[SH] DOM 진단 — 전체 클래스 목록:', [...classes].slice(0, 50).join(', '));
          // 카드 내 작은 텍스트 요소들 (평점 후보)
          const smallTexts = [];
          box.querySelectorAll('em, span, strong').forEach(el => {
            if (el.closest('#sh-panel')) return;
            const t = tx(el).trim();
            if (t.length <= 10 && t.length > 0) smallTexts.push(`<${el.tagName} class="${el.className}"> "${t}"`);
          });
          console.log('[SH] DOM 진단 — 작은 텍스트:', smallTexts.slice(0, 30).join(' | '));
        }
      }
    }

    if (!panel) createPanel();
    panel.style.display = '';

    if (isNew) {
      renderPanel(items);
      const clean = items.map(({ _box, ...c }) => c);
      const q = getQ();

      // 기존 SEARCH_RESULTS_PARSED 유지 (하위호환)
      chrome.runtime.sendMessage({ type: 'SEARCH_RESULTS_PARSED', query: q, items: clean }).catch(() => {});

      // ★ 새 하이브리드 수집: SAVE_SEARCH_EVENT ★
      // 개별 상품 데이터 + 파싱 품질 메트릭을 포함하여 서버에 전송
      const prices = clean.map(i => i.price).filter(p => p > 0);
      const ratings = clean.map(i => i.rating).filter(r => r > 0);
      const reviews = clean.map(i => i.reviewCount).filter(r => r > 0);
      const pq = calcParseQuality(clean);

      chrome.runtime.sendMessage({
        type: 'SAVE_SEARCH_EVENT',
        keyword: q,
        pageUrl: location.href,
        totalItems: clean.length,
        items: clean,
        avgPrice: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0,
        avgRating: ratings.length ? +(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : 0,
        avgReview: reviews.length ? Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length) : 0,
        totalReviewSum: reviews.reduce((a, b) => a + b, 0),
        adCount: clean.filter(i => i.isAd).length,
        rocketCount: clean.filter(i => i.isRocket).length,
        highReviewCount: clean.filter(i => i.reviewCount >= 100).length,
        priceParseRate: pq.priceRate,
        ratingParseRate: pq.ratingRate,
        reviewParseRate: pq.reviewRate,
      }).catch(() => {});
    }
  }

  // URL 변경 감지
  let lastUrl = location.href;
  function urlCheck() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastSig = ''; allItems = [];
      document.querySelectorAll('.sh-hl').forEach(el => el.classList.remove('sh-hl'));
      setTimeout(() => doScan(true), 300);
      setTimeout(() => doScan(true), 800);
      setTimeout(() => doScan(true), 1500);
    }
  }

  window.addEventListener('popstate', () => setTimeout(urlCheck, 100));
  setInterval(urlCheck, 800);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(() => doScan(true), 300); });
  document.addEventListener('force-reparse', () => setTimeout(() => doScan(true), 300));

  const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(() => doScan(), 600); });
  obs.observe(document.body || document.documentElement, { childList: true, subtree: true });

  // 초기 실행
  doScan();
  setTimeout(doScan, 500);
  setTimeout(doScan, 1200);
  setTimeout(doScan, 2500);

  chrome.runtime.sendMessage({ type: 'PAGE_DETECTED', pageType: 'search', url: location.href }).catch(() => {});

  // ============================================================
  //  v6.4: 자동 순회 수집기 — requestId 기반 파싱 핸들러
  //  background.js가 탭을 이동시킨 후 START_PARSE_SEARCH를 보냄
  //  → content.js가 DOM 파싱 후 SEARCH_PARSE_SUCCESS/FAILED 응답
  // ============================================================
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== 'START_PARSE_SEARCH') return false;

    const requestId = message.requestId;
    const keyword = message.keyword || getQ();
    const isAutoCollect = !!message.isAutoCollect;

    console.log(`%c[SH-AC] 파싱 요청 수신: "${keyword}" (requestId=${requestId})`, 'color:#8b5cf6;font-weight:bold;');

    // DOM이 준비될 때까지 대기하고 파싱 실행
    (async function autoCollectParse() {
      try {
        // 상품 리스트 엘리먼트가 나타날 때까지 대기 (최대 15초)
        const maxWait = 15000;
        const start = Date.now();
        let listFound = false;

        while (Date.now() - start < maxWait) {
          const list = document.querySelector(
            'li[class*="search-product"], .search-product, ' +
            '#product-list > li[class^="ProductUnit_productUnit"]'
          );
          if (list) { listFound = true; break; }
          await new Promise(r => setTimeout(r, 500));
        }

        if (!listFound) {
          // 차단/비정상 페이지 감지
          const bodyText = document.body?.textContent || '';
          const isBlocked = /봇|robot|captcha|차단|접근.*불가/i.test(bodyText);
          chrome.runtime.sendMessage({
            type: 'SEARCH_PARSE_FAILED',
            requestId,
            keyword,
            pageUrl: location.href,
            error: {
              code: isBlocked ? 'ACCESS_BLOCKED' : 'NO_PRODUCT_LIST',
              message: isBlocked ? '쿠팡 접근이 차단되었습니다.' : '상품 리스트를 찾지 못했습니다.',
            },
          });
          sendResponse({ ok: false });
          return;
        }

        // lazy render 안정화 대기
        await new Promise(r => setTimeout(r, 2000));

        // DOM 파싱 실행 (기존 parseProducts 재사용)
        const items = parseProducts();

        if (!items.length) {
          chrome.runtime.sendMessage({
            type: 'SEARCH_PARSE_FAILED',
            requestId,
            keyword,
            pageUrl: location.href,
            error: {
              code: 'EMPTY_RESULT',
              message: '파싱된 상품이 없습니다.',
            },
          });
          sendResponse({ ok: false });
          return;
        }

        // 파싱 품질 계산
        const clean = items.map(({ _box, ...c }) => c);
        const pq = calcParseQuality(clean);
        const prices = clean.map(i => i.price).filter(p => p > 0);
        const ratings = clean.map(i => i.rating).filter(r => r > 0);
        const reviews = clean.map(i => i.reviewCount).filter(r => r > 0);

        console.log(`%c[SH-AC] ✅ "${keyword}" 파싱 완료: ${clean.length}개 | 품질: 가격${pq.priceRate}% 평점${pq.ratingRate}% 리뷰${pq.reviewRate}%`, 'color:#16a34a;font-weight:bold;');

        // background에 성공 메시지 전송
        chrome.runtime.sendMessage({
          type: 'SEARCH_PARSE_SUCCESS',
          requestId,
          keyword,
          pageUrl: location.href,
          itemCount: clean.length,
          isAutoCollect: true,
          result: {
            keyword,
            page: 1,
            productCount: clean.length,
            collectedAt: new Date().toISOString(),
            items: clean,
          },
          // 기존 하이브리드 수집 통합용 — 검색 이벤트 데이터
          searchEventData: {
            keyword,
            pageUrl: location.href,
            totalItems: clean.length,
            items: clean.slice(0, 36),
            avgPrice: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0,
            avgRating: ratings.length ? +(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : 0,
            avgReview: reviews.length ? Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length) : 0,
            totalReviewSum: reviews.reduce((a, b) => a + b, 0),
            adCount: clean.filter(i => i.isAd).length,
            rocketCount: clean.filter(i => i.isRocket).length,
            highReviewCount: clean.filter(i => i.reviewCount >= 100).length,
            priceParseRate: pq.priceRate,
            ratingParseRate: pq.ratingRate,
            reviewParseRate: pq.reviewRate,
          },
        });

        // UI 패널도 업데이트
        if (isAutoCollect) {
          allItems = items;
          if (!panel) createPanel();
          panel.style.display = '';
          renderPanel(items);
        }

        sendResponse({ ok: true });
      } catch (err) {
        console.error('[SH-AC] 파싱 중 오류:', err);
        chrome.runtime.sendMessage({
          type: 'SEARCH_PARSE_FAILED',
          requestId,
          keyword,
          pageUrl: location.href,
          error: {
            code: 'UNKNOWN',
            message: err?.message || 'Unknown error',
          },
        });
        sendResponse({ ok: false });
      }
    })();

    return true; // async response
  });
})();
