/* ============================================================
   Coupang Sourcing Helper — Content Script v5.5.4
   "마켓 대시보드 패널" — 시장 분석 + TOP3 + 미니 차트

   원칙:
   1) 검색 시 자동 플로팅 패널 (오른쪽)
   2) 시장 개요: 상품수·평균가·리뷰·경쟁도·그래프
   3) TOP 3 상품만 간결 표시
   4) 쿠팡 DOM 최소 건드림

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
  const VER = '5.5.4';

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
  function nm(s) { return parseInt((s || '').replace(/[^0-9]/g, ''), 10) || 0; }
  function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

  // ============================================================
  //  ★★★ 상품 파싱 v5.5.3 ★★★
  //
  //  핵심 전략:
  //  1. 각 상품 카드의 개별 DOM 요소를 하나씩 순회
  //  2. 각 요소의 텍스트를 분석하여 역할 파악
  //  3. "적립", "당", "배송비" 등이 포함된 가격 텍스트는 확실히 제외
  //  4. 별점은 star 관련 요소의 width 비율 또는 aria-label에서 추출
  //  5. 리뷰수는 "(\d+)" 패턴에서 추출, 단위가격 괄호 제외
  // ============================================================
  function parseProducts() {
    const items = [], seen = new Set(), q = getQ();

    // ── 상품 카드 수집 ──────────────────────
    // 방법 A: <li class*="search-product"> 기반
    let productBoxes = [...document.querySelectorAll('li[class*="search-product"]')];

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

      // 상품 링크 찾기
      const link = box.querySelector('a[href*="/vp/products/"]');
      if (!link) continue;

      const m = (link.href || link.getAttribute('href') || '').match(/\/vp\/products\/(\d+)/);
      if (!m) continue;
      const pid = m[1];
      if (seen.has(pid)) continue;
      seen.add(pid);

      // ── 상품명 ──────────────────────────────
      const nameEl = box.querySelector('div.name, [class*="name"], [class*="title"]');
      const title = (nameEl ? tx(nameEl) : '') || tx(link) || (box.querySelector('img')?.alt || '');
      if (!title || title.length < 3) continue;

      // ══════════════════════════════════════════
      // ▶ 가격 추출 (v5.5.3 — 엘리먼트 레벨 분석)
      // ══════════════════════════════════════════
      let price = 0;
      let originalPrice = 0;

      // 전략 1: 클래스 기반 직접 추출
      const priceValueEl = box.querySelector('strong.price-value, .price-value, [class*="price-value"]');
      if (priceValueEl) {
        const pv = nm(tx(priceValueEl));
        if (pv >= 1000) price = pv;
      }
      const basePriceEl = box.querySelector('del.base-price, .base-price, del[class*="price"]');
      if (basePriceEl) originalPrice = nm(tx(basePriceEl));

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

      // ══════════════════════════════════════════
      // ▶ 평점 추출 (v5.5.3 — 다중 전략)
      // ══════════════════════════════════════════
      let rating = 0;

      // 전략 1: em.rating 텍스트
      const ratEl = box.querySelector('em.rating');
      if (ratEl) {
        const rm = tx(ratEl).match(/(\d+\.?\d*)/);
        if (rm) { const v = parseFloat(rm[1]); if (v > 0 && v <= 5) rating = v; }
      }

      // 전략 2: rating 관련 클래스의 텍스트
      if (!rating) {
        for (const el of box.querySelectorAll('[class*="rating"]:not([class*="count"]):not([class*="total"])')) {
          const rm = tx(el).match(/^(\d+\.?\d*)$/);
          if (rm) { const v = parseFloat(rm[1]); if (v > 0 && v <= 5) { rating = v; break; } }
        }
      }

      // 전략 3: aria-label 또는 title에서 "N점" 또는 "N out of 5"
      if (!rating) {
        for (const el of box.querySelectorAll('[aria-label], [title]')) {
          const label = (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '');
          let rm = label.match(/만점에\s*(\d+\.?\d*)/);
          if (!rm) rm = label.match(/(\d+\.?\d*)\s*점/);
          if (!rm) rm = label.match(/(\d+\.?\d*)\s*out\s*of\s*5/i);
          if (rm) {
            const v = parseFloat(rm[1]);
            if (v > 0 && v <= 5) { rating = v; break; }
          }
        }
      }

      // 전략 4: 별(star) 요소의 width 비율로 추정
      if (!rating) {
        const starContainer = box.querySelector('[class*="star"], [class*="rating-star"], [class*="Star"]');
        if (starContainer) {
          // filled star의 width 비율
          const filled = starContainer.querySelector('[class*="fill"], [class*="active"], [class*="on"], [style*="width"]');
          if (filled) {
            const style = filled.getAttribute('style') || '';
            const wm = style.match(/width:\s*([\d.]+)%/);
            if (wm) {
              rating = Math.round(parseFloat(wm[1]) / 20 * 10) / 10; // 100% = 5.0
              if (rating > 5) rating = 5;
            }
          }
          // filled star img/svg 개수로 추정
          if (!rating) {
            const allStars = starContainer.querySelectorAll('img, svg, [class*="star"]');
            const filledStars = starContainer.querySelectorAll('[class*="fill"], [class*="active"], [class*="on"], [class*="full"]');
            if (filledStars.length > 0 && filledStars.length <= 5) {
              rating = filledStars.length;
            } else if (allStars.length === 5) {
              // 5개 별이 있으면 이미지의 색상/opacity로 판별 불가 → 보수적 4.5
              rating = 4.5;
            }
          }
        }
      }

      // 전략 5: 리뷰가 있는데 별점을 못 찾은 경우 — 별 이미지가 있으면 추정
      // (아래에서 reviewCount 추출 후 재시도)

      // ══════════════════════════════════════════
      // ▶ 리뷰수 추출 (v5.5.3)
      // ══════════════════════════════════════════
      let reviewCount = 0;

      // 전략 1: span.rating-total-count 직접 조회
      const revEl = box.querySelector('span.rating-total-count, .rating-total-count');
      if (revEl) {
        reviewCount = nm(tx(revEl).replace(/[()]/g, ''));
      }

      // 전략 2: count/review 관련 클래스
      if (!reviewCount) {
        for (const el of box.querySelectorAll('[class*="count"], [class*="review-count"]')) {
          if (/rating-total-count/.test(el.className)) continue; // 이미 시도함
          const v = nm(tx(el).replace(/[()]/g, ''));
          if (v > 0 && v < 1e7) { reviewCount = v; break; }
        }
      }

      // 전략 3: 텍스트 패턴 — "(N,NNN)" 형태의 괄호 안 숫자
      if (!reviewCount) {
        const fullText = tx(box);
        const allParens = [...fullText.matchAll(/\(\s*([\d,]+)\s*\)/g)];
        for (const pm of allParens) {
          const inner = pm[1].trim();
          // 단위가격 괄호 제외
          const beforeParen = fullText.substring(0, fullText.indexOf(pm[0]));
          if (/\d+\s*(g|kg|ml|l|개|매|입)\s*당\s*$/i.test(beforeParen)) continue;
          if (/당$/.test(beforeParen.trim())) continue;

          const v = nm(inner);
          if (v > 0 && v < 1e7) { reviewCount = v; break; }
        }
      }

      // 별점 재시도: 리뷰가 있는데 별점이 없으면 별 이미지 존재로 추정
      if (!rating && reviewCount > 0) {
        const hasStars = box.querySelector('[class*="star"], [class*="rating"], img[alt*="별"], img[alt*="star"], svg[class*="star"]');
        if (hasStars) rating = 4.5; // 보수적 추정
      }

      // ══════════════════════════════════════════
      // ▶ 이미지
      // ══════════════════════════════════════════
      const img = box.querySelector('img[src*="thumbnail"], img[src*="coupangcdn"], img[data-img-src], img');
      const imageUrl = img?.src || img?.getAttribute('data-img-src') || img?.getAttribute('data-src') || '';

      // ══════════════════════════════════════════
      // ▶ 광고 감지 (v5.5.3 — 강화)
      // ══════════════════════════════════════════
      let isAd = false;

      // 1) li 클래스에 ad-badge 관련
      const boxCls = box.className || '';
      isAd = /search-product__ad-badge|ad[-_]?badge|AdBadge/i.test(boxCls);

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
        // 이미지 컨테이너 근처의 작은 숫자 배지
        const imgContainer = box.querySelector('[class*="image"], [class*="thumbnail"], [class*="photo"]') || box;
        for (const el of imgContainer.querySelectorAll('span, div, em, strong')) {
          const t = tx(el).trim();
          if (/^\d{1,2}$/.test(t)) {
            const n = parseInt(t, 10);
            if (n >= 1 && n <= 50) {
              // 크기 확인 — 배지는 작은 요소
              const rect = el.getBoundingClientRect?.();
              if (rect && rect.width > 0 && rect.width < 60 && rect.height < 60) {
                rankNum = n;
                break;
              }
              // getBoundingClientRect 없으면 클래스명 힌트
              if (/badge|rank|num|position/i.test(el.className || '')) {
                rankNum = n;
                break;
              }
              // 마지막 수단: 짧은 텍스트(2자 이하)면서 부모도 작은 경우
              if (t.length <= 2 && !rankNum) {
                rankNum = n;
              }
            }
          }
        }
      }

      // ══════════════════════════════════════════
      // ▶ 로켓배송 감지
      // ══════════════════════════════════════════
      let isRocket = false;

      // 1) 클래스 기반
      isRocket = !!box.querySelector('.badge-rocket, [class*="badge-rocket"], [class*="rocket-icon"], [class*="RocketBadge"], [class*="rocket_icon"], [class*="Rocket"]');

      // 2) 이미지 alt/src에 rocket
      if (!isRocket) {
        for (const imgEl of box.querySelectorAll('img')) {
          const alt = (imgEl.alt || '').toLowerCase();
          const src = (imgEl.src || imgEl.getAttribute('data-img-src') || '').toLowerCase();
          if (/rocket|로켓/i.test(alt) || /rocket/i.test(src)) { isRocket = true; break; }
        }
      }

      // 3) 텍스트 기반
      if (!isRocket) {
        const boxText = tx(box);
        isRocket = /로켓배송|로켓와우|로켓프레시|로켓직구/.test(boxText);
      }

      // 4) "새벽 도착 보장" 또는 "내일(X) 도착 보장"
      if (!isRocket) {
        const boxText = tx(box);
        isRocket = /새벽\s*도착\s*보장/.test(boxText) || /내일\([^)]+\)\s*(새벽\s*)?도착\s*보장/.test(boxText);
      }

      // 5) "오늘출발" — 로켓배송 표시일 가능성 높음
      if (!isRocket) {
        isRocket = /오늘\s*출발/.test(tx(box));
      }

      const href = (link.href || '').startsWith('http') ? link.href : 'https://www.coupang.com' + (link.getAttribute('href') || '');

      items.push({
        productId: pid, title, price, originalPrice, rating, reviewCount,
        url: href, imageUrl,
        position: items.length + 1, query: q,
        isAd, isRocket, rankNum,
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
      console.log(`%c[SH] v${VER} 파싱 완료: ${items.length}개 | 가격${pCnt} 평점${rCnt} 리뷰${rvCnt} 광고${adCnt} 로켓${rkCnt} 순위${rankCnt}`, 'color:#6366f1;font-weight:bold;');
      // 처음 5개 상품 상세 로그
      items.slice(0, 5).forEach((it, i) => {
        console.log(`  [${i+1}] ${it.title.substring(0,30)}.. | 가격:${it.price.toLocaleString()}원 | ★${it.rating} | 리뷰:${it.reviewCount.toLocaleString()} | ${it.isAd?'AD':'일반'} | ${it.isRocket?'🚀':'-'} | rank=${it.rankNum}`);
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

      // 1단계: 로컬 사전으로 즉시 중국어 키워드 추출
      const kw = extractKw(item.title);
      console.log(`[SH] 1688 클릭: "${item.title}" → cn:"${kw.cn}" ko:"${kw.ko}"`);

      // 2단계: 서버 AI 매칭 시도 (타임아웃 3초)
      const timeout = new Promise(resolve => setTimeout(() => resolve(null), 3000));
      const serverCall = chrome.runtime.sendMessage({
        type: 'PRE_MATCH', productName: item.title, price: item.price, imageUrl: item.imageUrl
      }).catch(() => null);

      Promise.race([serverCall, timeout]).then(async r => {
        let keyword = '';

        // 서버 AI 결과 우선
        if (r?.success && r.keywords1688?.length) {
          keyword = r.keywords1688[0].keyword;
          console.log(`[SH] 1688 서버 AI 키워드: "${keyword}"`);
        }

        // 서버 실패 시 로컬 사전
        if (!keyword && kw.cn) {
          keyword = kw.cn;
          console.log(`[SH] 1688 로컬 사전 키워드: "${keyword}"`);
        }

        // 사전에도 없으면 Google Translate 폴백
        if (!keyword && kw.ko) {
          try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=zh-CN&dt=t&q=${encodeURIComponent(kw.ko)}`;
            const resp = await fetch(url);
            const data = await resp.json();
            if (data?.[0]?.[0]?.[0]) {
              keyword = data[0][0][0];
              console.log(`[SH] 1688 Google Translate 키워드: "${keyword}"`);
            }
          } catch (e) {
            console.warn('[SH] Google Translate 실패:', e);
          }
        }

        // 최종 폴백: 한국어 그대로 (1688이 자체 번역 지원)
        if (!keyword) {
          keyword = kw.ko;
          console.log(`[SH] 1688 한국어 폴백: "${keyword}"`);
        }

        window.open('https://s.1688.com/selloffer/offer_search.htm?keywords=' + encodeURIComponent(keyword), '_blank');
        b1.textContent = '1688';
      });
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
      console.log(`%c[SH] ✅ ${items.length}개 파싱 완료`, 'color:#16a34a;font-weight:bold;');
    }

    if (!panel) createPanel();
    panel.style.display = '';

    if (isNew) {
      renderPanel(items);
      const clean = items.map(({ _box, ...c }) => c);
      chrome.runtime.sendMessage({ type: 'SEARCH_RESULTS_PARSED', query: getQ(), items: clean }).catch(() => {});
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
})();
