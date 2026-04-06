import { fileURLToPath } from "node:url";

const MAX_NODE_TIMER_MS = 2_147_483_647;
const vitestRuntimeSetupFile = fileURLToPath(new URL("./vitest-runtime-setup.ts", import.meta.url));

export const murphVitestNoTimeouts = {
  testTimeout: 0,
  hookTimeout: 0,
  // Vitest supports `0` for test and hook timeouts, but teardown uses the
  // value directly in `setTimeout`, so `0` forces immediate worker shutdown.
  teardownTimeout: MAX_NODE_TIMER_MS,
  setupFiles: [vitestRuntimeSetupFile] as string[],
} as const;
