import { router } from "../../_core/trpc";
import { brandsRouter } from "./brands.router";
import { mktProductsRouter } from "./products.router";
import { campaignsRouter } from "./campaigns.router";
import { contentRouter } from "./content.router";
import { channelsRouter } from "./channels.router";
import { analyticsRouter } from "./analytics.router";
import { briefingRouter } from "./briefing.router";

export const marketingRouter = router({
  brands: brandsRouter,
  products: mktProductsRouter,
  campaigns: campaignsRouter,
  content: contentRouter,
  channels: channelsRouter,
  analytics: analyticsRouter,
  briefing: briefingRouter,
});
