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
const stageMessages = new Map<string, WearableStage>(
  WEARABLE_STAGES.map((stage) => [STAGE_PREFIX + stage, stage]),
);

export function writeWearableStage(stage: WearableStage): void {
  process.stdout.write(STAGE_PREFIX + stage + "\n");
}

// The browser pipe may contain arbitrary private text. Only an entire exact
// stage message is eligible for incremental forwarding, never a substring.
export function forwardWearableStage(line: string): WearableStage | undefined {
  const stage = stageMessages.get(line);
  if (stage) process.stdout.write(line + "\n");
  return stage;
}

export function startWearableHostProgress(
  readStage: () => WearableStage | undefined = () => undefined,
): () => void {
  const startedAt = Date.now();
  let noticeCount = 0;
  let lastNoticeAt = startedAt;
  let lastNoticeAvailableMiB = 0;
  const report = () => {
    const measurements = {
      availableParallelism: availableParallelism(),
      availableMiB: Math.floor(process.availableMemory() / 1_048_576),
      freeMiB: Math.floor(freemem() / 1_048_576),
      totalMiB: Math.floor(totalmem() / 1_048_576),
      load1: loadavg()[0],
    };
    process.stdout.write("MURPH_E2E_WEARABLE_HOST=" + JSON.stringify(measurements) + "\n");
    // Actions stores timeline annotations separately from the final log archive.
    // Keep within its ten-notice-per-step cap, sampling sooner as memory halves.
    const now = Date.now();
    if (process.env.GITHUB_ACTIONS === "true" && noticeCount < 10 && (
      noticeCount === 0 || now - lastNoticeAt >= 240_000 ||
      measurements.availableMiB < lastNoticeAvailableMiB / 2
    )) {
      process.stdout.write("::notice::MURPH_E2E_WEARABLE_PROGRESS=" + JSON.stringify({
        elapsedSeconds: Math.floor((now - startedAt) / 1_000),
        stage: readStage(),
        ...measurements,
      }) + "\n");
      noticeCount += 1;
      lastNoticeAt = now;
      lastNoticeAvailableMiB = measurements.availableMiB;
    }
  };
  report();
  const timer = setInterval(report, 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
