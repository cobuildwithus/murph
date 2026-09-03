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
  testStandbyRoutes,
} from "./route-handlers/test-standby.ts";
import {
  testTemporalMailboxSignalFaultRoutes,
} from "./route-handlers/test-temporal-mailbox-signal-fault.ts";
import {
  workerInternalRoutes,
} from "./internal-routes.ts";

export const hostedLocalTestInternalRoutes = [
  ...testArtifactRoutes,
  ...testRunnerRoutes,
  ...testStandbyRoutes,
  ...testTemporalMailboxSignalFaultRoutes,
  ...testDirectR2Routes,
  ...workerInternalRoutes,
] as const;
