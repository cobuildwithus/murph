import { fileURLToPath } from "node:url";

const MAX_NODE_TIMER_MS = 2_147_483_647;
const DEFAULT_VITEST_TIMEOUT_MS = 60_000;
const vitestRuntimeSetupFile = fileURLToPath(new URL("./vitest-runtime-setup.ts", import.meta.url));
const murphVitestSetupFiles = [vitestRuntimeSetupFile] as string[];

export const murphVitestStandardTimeouts = {
  testTimeout: DEFAULT_VITEST_TIMEOUT_MS,
  hookTimeout: DEFAULT_VITEST_TIMEOUT_MS,
  teardownTimeout: DEFAULT_VITEST_TIMEOUT_MS,
  setupFiles: murphVitestSetupFiles,
} as const;

export const murphVitestLongRunningTimeouts = {
  testTimeout: 0,
  hookTimeout: 0,
  // Vitest supports `0` for test and hook timeouts, but teardown uses the
  // value directly in `setTimeout`, so `0` forces immediate worker shutdown.
  teardownTimeout: MAX_NODE_TIMER_MS,
  setupFiles: murphVitestSetupFiles,
} as const;

// Keep the historical helper name wired to the bounded shared policy so the
// repo-wide default changes without a noisy config-only rename sweep.
export const murphVitestNoTimeouts = murphVitestStandardTimeouts;
