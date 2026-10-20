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
import { gameMediaRoutes } from "./route-handlers/game-media.ts";
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
  ...gameMediaRoutes,
  ...browserVaultRoutes,
  ...userStatusRoutes,
] as const;
