import { createMurphPackageVitestConfig } from "../../config/vitest-package.js";

export default createMurphPackageVitestConfig({
  configUrl: import.meta.url,
  name: "assistant-engine",
  coverageExclude: ["src/assistant/system-prompt.ts"],
  test: {
    tags: [{
      name: "real-codex-live",
      description: "Opt-in tests that call a real Codex model",
    }],
  },
});
