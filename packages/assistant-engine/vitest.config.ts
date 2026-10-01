import { createMurphPackageVitestConfig } from "../../config/vitest-package.js";

export default createMurphPackageVitestConfig({
  configUrl: import.meta.url,
  name: "assistant-engine",
  coverageExclude: ["src/assistant/system-prompt.ts"],
  test: {
    // Parameterized live titles must stay intact for exact list/run selection.
    ...(process.env.MURPH_RUN_REAL_CODEX_E2E === "1"
      ? { chaiConfig: { truncateThreshold: 0 } }
      : {}),
    tags: [{
      name: "real-codex-live",
      description: "Opt-in tests that call a real Codex model",
    }],
  },
});
