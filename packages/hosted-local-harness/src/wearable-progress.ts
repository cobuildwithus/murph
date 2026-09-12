import { availableParallelism, freemem, loadavg, totalmem } from "node:os";

const WEARABLE_STAGES = [
  "configuration",
  "browser_launch",
  "kernel_tunnel_ready",
  "murph_connect_intent",
  "murph_vital_disclosure",
  "murph_connect_start",
  "junction_garmin_authorization",
  "junction_oura_authorization",
  "junction_whoop_authorization",
  "murph_connected_completion",
  "murph_persisted_connect_navigation",
  "murph_persisted_connect_reload",
  "garmin_canonical_data",
  "junction_cleanup",
  "browser_cleanup",
  "browser_cookie_cleanup",
  "browser_tunnel_cleanup",
  "browser_remote_cleanup",
] as const;

export type WearableStage = typeof WEARABLE_STAGES[number];
const STAGE_PREFIX = "MURPH_E2E_WEARABLE_STAGE=";
const stageMessages = new Set<string>(WEARABLE_STAGES.map((stage) => STAGE_PREFIX + stage));

export function writeWearableStage(stage: WearableStage): void {
  process.stdout.write(STAGE_PREFIX + stage + "\n");
}

// The browser pipe may contain arbitrary private text. Only an entire exact
// stage message is eligible for incremental forwarding, never a substring.
export function forwardWearableStage(line: string): void {
  if (stageMessages.has(line)) process.stdout.write(line + "\n");
}

export function startWearableHostProgress(): () => void {
  const report = () => {
    process.stdout.write("MURPH_E2E_WEARABLE_HOST=" + JSON.stringify({
      availableParallelism: availableParallelism(),
      availableMiB: Math.floor(process.availableMemory() / 1_048_576),
      freeMiB: Math.floor(freemem() / 1_048_576),
      totalMiB: Math.floor(totalmem() / 1_048_576),
      load1: loadavg()[0],
    }) + "\n");
  };
  report();
  const timer = setInterval(report, 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
