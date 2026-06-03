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
  testArtifactRoutes,
} from "./route-handlers/test-artifacts.ts";
import {
  testDirectR2Routes,
} from "./route-handlers/test-direct-r2.ts";
import {
  testRunnerRoutes,
} from "./route-handlers/test-runner.ts";
import {
  userDataDeleteRoutes,
} from "./route-handlers/user-data-delete.ts";

export const workerInternalRoutes = [
  ...testArtifactRoutes,
  ...testRunnerRoutes,
  ...testDirectR2Routes,
  ...deploySmokeRoutes,
  ...runtimeProcessingRoutes,
  ...userDataDeleteRoutes,
  ...browserVaultRoutes,
  ...userStatusRoutes,
] as const;
