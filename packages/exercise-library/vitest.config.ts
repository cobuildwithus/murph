import { createMurphPackageVitestConfig } from "../../config/vitest-package.js";

export default createMurphPackageVitestConfig({
  configUrl: import.meta.url,
  name: "exercise-library",
  rootRelativePath: ".",
});
