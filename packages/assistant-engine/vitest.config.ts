import { createMurphPackageVitestConfig } from "../../config/vitest-package.js";

export default createMurphPackageVitestConfig({
  configUrl: import.meta.url,
  name: "assistant-engine",
  coverageExclude: ["src/assistant/system-prompt.ts"],
});
