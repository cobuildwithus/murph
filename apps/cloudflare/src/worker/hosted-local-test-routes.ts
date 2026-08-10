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
  testTemporalMailboxSignalFaultRoutes,
} from "./route-handlers/test-temporal-mailbox-signal-fault.ts";
import {
  workerInternalRoutes,
} from "./internal-routes.ts";

export const hostedLocalTestInternalRoutes = [
  ...testArtifactRoutes,
  ...testRunnerRoutes,
  ...testTemporalMailboxSignalFaultRoutes,
  ...testDirectR2Routes,
  ...workerInternalRoutes,
] as const;
