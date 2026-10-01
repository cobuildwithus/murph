import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createMurphPackageVitestConfig } from "../config/vitest-package.js";

describe("package Vitest roots", () => {
  const packageConfigUrl = new URL(
    "../packages/core/vitest.config.ts",
    import.meta.url,
  ).href;
  const packageDir = path.dirname(fileURLToPath(packageConfigUrl));

  it("defaults the root to the package that owns the config", () => {
    expect(
      createMurphPackageVitestConfig({
        configUrl: packageConfigUrl,
        name: "package-root-default",
      }),
    ).toMatchObject({ root: packageDir });
  });

  it("resolves an explicit root relative to the package config", () => {
    expect(
      createMurphPackageVitestConfig({
        configUrl: packageConfigUrl,
        name: "package-root-override",
        rootRelativePath: "../..",
      }),
    ).toMatchObject({ root: path.resolve(packageDir, "../..") });
  });
});
