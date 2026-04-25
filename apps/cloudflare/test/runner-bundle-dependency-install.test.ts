import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertInstalledRunnerHealthCommonsRuntimeImport,
  pinInstalledDependencyVersions,
  writeRunnerBundlePnpmInstallConfig,
} from "../scripts/runner-bundle/dependency-install.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("runner bundle dependency pinning", () => {
  it("pins required direct dependencies from the runtime package root", async () => {
    const runtimePackageRoot = await createRuntimePackageRoot();
    const dependencies = {
      jose: "^6.0.0",
    };

    await writeInstalledPackage(runtimePackageRoot, "jose", "6.2.2");
    pinInstalledDependencyVersions(dependencies, {}, runtimePackageRoot);

    expect(dependencies).toEqual({
      jose: "6.2.2",
    });
  });

  it("throws when a required direct dependency is not installed for the runtime package", async () => {
    const runtimePackageRoot = await createRuntimePackageRoot();

    expect(() =>
      pinInstalledDependencyVersions(
        {
          jose: "^6.0.0",
        },
        {},
        runtimePackageRoot,
      ),
    ).toThrow(
      `Could not resolve an installed version for direct dependency jose from ${runtimePackageRoot}.`,
    );
  });

  it("drops unresolved optional direct dependencies before install", async () => {
    const runtimePackageRoot = await createRuntimePackageRoot();
    const optionalDependencies = {
      jose: "^6.0.0",
    };

    pinInstalledDependencyVersions(optionalDependencies, {}, runtimePackageRoot, {
      allowMissing: true,
      dropMissing: true,
    });

    expect(optionalDependencies).toEqual({});
  });
});

describe("runner bundle pnpm install config", () => {
  it("mirrors root minimum-release-age policy into the isolated bundle install", async () => {
    const repoRoot = await createRuntimePackageRoot();
    const installRoot = await createRuntimePackageRoot();

    await writeFile(
      path.join(repoRoot, "pnpm-workspace.yaml"),
      [
        "packages:",
        "  - packages/*",
        "minimumReleaseAge: 1440",
        "minimumReleaseAgeExclude:",
        "  - incur@0.4.4",
        "  - '@cobuild/review-gpt@0.5.81'",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeRunnerBundlePnpmInstallConfig(installRoot, repoRoot);

    await expect(
      readFile(path.join(installRoot, ".npmrc"), "utf8"),
    ).resolves.toBe(
      [
        "minimum-release-age=1440",
        "minimum-release-age-exclude[]=incur@0.4.4",
        "minimum-release-age-exclude[]=@cobuild/review-gpt@0.5.81",
        "",
      ].join("\n"),
    );
  });
});

describe("runner bundle runtime import probes", () => {
  it("accepts an installed Health Commons runtime subpath", async () => {
    const runtimePackageRoot = await createRuntimePackageRoot();

    await writeInstalledHealthCommonsRuntimePackage(runtimePackageRoot);

    await expect(
      assertInstalledRunnerHealthCommonsRuntimeImport(runtimePackageRoot),
    ).resolves.toBeUndefined();
  });

  it("rejects a runner bundle without an importable Health Commons runtime", async () => {
    const runtimePackageRoot = await createRuntimePackageRoot();

    await expect(
      assertInstalledRunnerHealthCommonsRuntimeImport(runtimePackageRoot),
    ).rejects.toThrow(
      "Runner bundle cannot import @murphai/health-commons/runtime from installed production dependencies.",
    );
  });
});

async function createRuntimePackageRoot(): Promise<string> {
  const runtimePackageRoot = await mkdtemp(
    path.join(tmpdir(), "murph-runner-bundle-dependency-install-"),
  );

  temporaryDirectories.push(runtimePackageRoot);
  await mkdir(path.join(runtimePackageRoot, "node_modules"), {
    recursive: true,
  });

  return runtimePackageRoot;
}

async function writeInstalledPackage(
  runtimePackageRoot: string,
  packageName: string,
  version: string,
): Promise<void> {
  const packageRoot = path.join(
    runtimePackageRoot,
    "node_modules",
    ...packageName.split("/"),
  );

  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      name: packageName,
      version,
    }),
    "utf8",
  );
}

async function writeInstalledHealthCommonsRuntimePackage(
  runtimePackageRoot: string,
): Promise<void> {
  const packageRoot = path.join(
    runtimePackageRoot,
    "node_modules",
    "@murphai",
    "health-commons",
  );

  await mkdir(path.join(packageRoot, "dist"), { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      name: "@murphai/health-commons",
      type: "module",
      version: "1.0.0",
      exports: {
        "./runtime": {
          default: "./dist/runtime.js",
          import: "./dist/runtime.js",
        },
      },
    }),
    "utf8",
  );
  await writeFile(
    path.join(packageRoot, "dist", "runtime.js"),
    "export const ok = true;\n",
    "utf8",
  );
}
