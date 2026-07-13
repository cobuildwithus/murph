import {
  browserVaultRoutes,
} from "./route-handlers/browser-vault-session.ts";
import {
  conversationUsageNoticeRoutes,
} from "./route-handlers/conversation-usage-notice.ts";
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

export const workerInternalRoutes = [
  ...deploySmokeRoutes,
  ...runtimeProcessingRoutes,
  ...userDataDeleteRoutes,
  ...conversationUsageNoticeRoutes,
  ...telegramUsageLimitNoticeRoutes,
  ...browserVaultRoutes,
  ...userStatusRoutes,
] as const;
