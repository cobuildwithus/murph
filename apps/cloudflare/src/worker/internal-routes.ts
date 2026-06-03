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

export const workerInternalRoutes = [
  ...deploySmokeRoutes,
  ...runtimeProcessingRoutes,
  ...userDataDeleteRoutes,
  ...browserVaultRoutes,
  ...userStatusRoutes,
] as const;
