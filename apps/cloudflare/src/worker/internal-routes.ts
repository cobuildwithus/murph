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
import { mealPhotoRoutes } from "./route-handlers/meal-photo-stage.ts";
import {
  environmentVoiceRoutes,
} from "./route-handlers/environment-voice-stage.ts";

export const workerInternalRoutes = [
  ...deploySmokeRoutes,
  ...runtimeProcessingRoutes,
  ...userDataDeleteRoutes,
  ...telegramUsageLimitNoticeRoutes,
  ...environmentVoiceRoutes,
  ...mealPhotoRoutes,
  ...browserVaultRoutes,
  ...userStatusRoutes,
] as const;
