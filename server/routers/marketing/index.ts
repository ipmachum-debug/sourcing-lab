import { router } from "../../_core/trpc";
import { brandsRouter } from "./brands.router";
import { mktProductsRouter } from "./products.router";
import { campaignsRouter } from "./campaigns.router";
import { contentRouter } from "./content.router";
import { channelsRouter } from "./channels.router";
import { analyticsRouter } from "./analytics.router";
import { briefingRouter } from "./briefing.router";
import { schedulerRouter } from "./scheduler.router";
import { calendarRouter } from "./calendar.router";
import { clientsRouter } from "./clients.router";
import { abTestRouter } from "./abtest.router";
import { reportsRouter } from "./reports.router";
import { libraryRouter } from "./library.router";
import { viralRouter } from "./viral.router";
import { videoRouter } from "./video.router";

export const marketingRouter = router({
  brands: brandsRouter,
  products: mktProductsRouter,
  campaigns: campaignsRouter,
  content: contentRouter,
  channels: channelsRouter,
  analytics: analyticsRouter,
  briefing: briefingRouter,
  scheduler: schedulerRouter,
  calendar: calendarRouter,
  clients: clientsRouter,
  abTest: abTestRouter,
  reports: reportsRouter,
  library: libraryRouter,
  viral: viralRouter,
  video: videoRouter,
});
