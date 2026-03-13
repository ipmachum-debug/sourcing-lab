/**
 * Extension Router — 조립 전용 파일
 *
 * 각 도메인별 서브 라우터를 mergeRouters로 합쳐서
 * 클라이언트 호출 경로(trpc.extension.xxx)를 그대로 유지합니다.
 *
 * 서브 라우터 목록:
 *   snapshots   — 검색 스냅샷
 *   candidates  — 소싱 후보
 *   rankings    — 순위 추적
 *   products    — 상품 상세
 *   trends      — 트렌드 & 분석
 *   reviews     — AI 리뷰 분석
 *   notifications — 알림 센터
 *   wing        — WING 인기상품
 *   demand      — 검색 수요 추정 & AI 인사이트
 *   trackings   — 내 상품 자동 추적
 *   sales       — 판매 추정 시스템
 *   watch       — 감시 키워드 & 배치 수집
 */
import { mergeRouters } from "../_core/trpc";

import { snapshotsRouter } from "./extension/snapshots.router";
import { candidatesRouter } from "./extension/candidates.router";
import { rankingsRouter } from "./extension/rankings.router";
import { productsRouter } from "./extension/products.router";
import { trendsRouter } from "./extension/trends.router";
import { reviewsRouter } from "./extension/reviews.router";
import { notificationsRouter } from "./extension/notifications.router";
import { wingRouter } from "./extension/wing.router";
import { demandRouter } from "./extension/demand.router";
import { trackingsRouter } from "./extension/trackings.router";
import { salesRouter } from "./extension/sales.router";
import { watchRouter } from "./extension/watch.router";

export const extensionRouter = mergeRouters(
  snapshotsRouter,
  candidatesRouter,
  rankingsRouter,
  productsRouter,
  trendsRouter,
  reviewsRouter,
  notificationsRouter,
  wingRouter,
  demandRouter,
  trackingsRouter,
  salesRouter,
  watchRouter,
);
