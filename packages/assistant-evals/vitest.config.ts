import { createMurphPackageVitestConfig } from "../../config/vitest-package.js";

export default createMurphPackageVitestConfig({
  configUrl: import.meta.url,
  coverageExclude: ["src/onboarding.ts"],
  name: "assistant-evals",
});
