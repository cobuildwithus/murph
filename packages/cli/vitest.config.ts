import { createMurphPackageVitestConfig } from "../../config/vitest-package.js";
import { cliVitestCoverage } from "./vitest.workspace.ts";

export default createMurphPackageVitestConfig({
  configUrl: import.meta.url,
  name: "cli",
  coverage: cliVitestCoverage,
});
