/**
 * @deprecated Legacy replay/deploy-skew exports. Normal orchestration uses
 * `ensureRuntimeProcessing`. Target removal: 2026-06-04 after old hosted user
 * runtime histories drain.
 */
export {
  ensureCloudflareExecution,
  type EnsureCloudflareExecutionInput,
} from "./ensure-cloudflare-execution.js";
export {
  ensureRuntimeProcessing,
  type EnsureRuntimeProcessingInput,
} from "./ensure-runtime-processing.js";
export {
  runHostedDeviceSyncRecoverySweep,
  type HostedDeviceSyncRecoverySweepResult,
} from "./run-device-sync-recovery-sweep.js";
export { readRuntimeDemand } from "./read-runtime-demand.js";
