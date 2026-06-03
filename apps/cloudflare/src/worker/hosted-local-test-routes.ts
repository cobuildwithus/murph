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
  workerInternalRoutes,
} from "./internal-routes.ts";

export const hostedLocalTestInternalRoutes = [
  ...testArtifactRoutes,
  ...testRunnerRoutes,
  ...testDirectR2Routes,
  ...workerInternalRoutes,
] as const;
