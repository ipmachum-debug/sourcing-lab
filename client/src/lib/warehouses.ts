// POIZON 한국(입고) 창고 — 발송 시 주소·연락처 참고용.
export interface Warehouse {
  name: string;
  phone: string; // 국내 표기
  intlPhone: string; // 국제 표기(POIZON 등록용)
  address: string;
  zip: string;
  note?: string;
}

export const POIZON_WAREHOUSES: Warehouse[] = [
  {
    name: "원창동 창고",
    phone: "010-5826-9666",
    intlPhone: "82 1058269666",
    address: "인천광역시 서구 원창동 488 로지스허브 9층 910호 SSTCMD",
    zip: "22769",
    note: "우리 동네 🙂",
  },
  {
    name: "가좌동 창고",
    phone: "010-4991-8666",
    intlPhone: "82 1049918666",
    address: "인천광역시 서구 가좌동 556-26 SSTCMD",
    zip: "22827",
  },
];
