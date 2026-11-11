import { runtimeResourcePurgeRoutes } from "./route-handlers/runtime-resource-purge.ts";
import {
  browserVaultRoutes,
} from "./route-handlers/browser-vault-session.ts";
import {
  deploySmokeRoutes,
} from "./route-handlers/deploy-smoke.ts";
import {
  runtimeProcessingRoutes,
  userStatusRoutes,
} from "./route-handlers/runtime-control.ts";
import {
  userDataDeleteRoutes,
} from "./route-handlers/user-data-delete.ts";
import {
  telegramUsageLimitNoticeRoutes,
} from "./route-handlers/telegram-send.ts";
import { gameImageRoutes } from "./route-handlers/game-images.ts";
import { gameMediaRoutes } from "./route-handlers/game-media.ts";
import { recapMediaRoutes } from "./route-handlers/recap-media.ts";
import { mealThumbnailRoutes } from "./route-handlers/meal-thumbnail.ts";
import { mealPhotoRoutes } from "./route-handlers/meal-photo-stage.ts";
import {
  deviceWebhookEnqueueRoutes,
} from "./route-handlers/device-webhook-enqueue.ts";

export const workerInternalRoutes = [
  ...deviceWebhookEnqueueRoutes,
  ...deploySmokeRoutes,
  ...runtimeProcessingRoutes,
  ...userDataDeleteRoutes,
  ...runtimeResourcePurgeRoutes,
  ...telegramUsageLimitNoticeRoutes,
  ...mealPhotoRoutes,
  ...mealThumbnailRoutes,
  ...gameMediaRoutes,
  ...recapMediaRoutes,
  ...gameImageRoutes,
  ...browserVaultRoutes,
  ...userStatusRoutes,
] as const;
