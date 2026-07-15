import { createMurphPackageVitestConfig } from "../../config/vitest-package.js";

export default createMurphPackageVitestConfig({
  configUrl: import.meta.url,
  name: "setup-cli",
  useDefaultConcurrency: false,
  useDefaultTimeouts: false,
  test: {
    // Ink/TTY setup flows mutate process-global state, so package tests must stay serial.
    fileParallelism: false,
    maxWorkers: 1,
  },
});
