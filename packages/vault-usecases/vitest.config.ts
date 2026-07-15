import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createMurphVitestCoverage,
  resolveMurphVitestCoverageProviderModule,
} from "../../config/vitest-coverage.js";
import { createMurphPackageVitestConfig } from "../../config/vitest-package.js";

const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url));

export default createMurphPackageVitestConfig({
  configUrl: import.meta.url,
  name: "vault-usecases",
  coverage: createMurphVitestCoverage({
    customProviderModule: resolveMurphVitestCoverageProviderModule(PACKAGE_DIR),
    include: ["src/**/*.ts"],
    thresholds: {
      perFile: false,
      lines: 54,
      functions: 59,
      branches: 47,
      statements: 54,
    },
  }),
});
