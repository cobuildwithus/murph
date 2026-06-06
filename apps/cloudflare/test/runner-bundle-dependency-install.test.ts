import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertInstalledRunnerHealthCommonsRuntimeImport,
  assertRunnerBundleLockfileUsesCommittedResolutions,
  installPackedRunnerDependencies,
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
      "Could not resolve an installed version for direct dependency jose from the runner runtime package.",
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
  it("installs packed runner dependencies with the repo package manager and local tarball release-age exclusions", async () => {
    const repoRoot = await createRuntimePackageRoot();
    const bundleDir = await createRuntimePackageRoot();
    const runtimePackageRoot = await createRuntimePackageRoot();
    const binDir = path.join(repoRoot, "bin");
    const pnpmLogPath = path.join(repoRoot, "pnpm.log");
    const tarballsDir = path.join(repoRoot, "tarballs");

    await Promise.all([
      mkdir(path.join(repoRoot, "apps"), { recursive: true }),
      mkdir(path.join(repoRoot, "packages", "assistant-runtime"), {
        recursive: true,
      }),
      mkdir(path.join(repoRoot, "packages", "runtime-state"), { recursive: true }),
      mkdir(binDir, { recursive: true }),
      mkdir(tarballsDir, { recursive: true }),
    ]);
    await writeFile(
      path.join(repoRoot, "package.json"),
      `${JSON.stringify({
        packageManager: "pnpm@10.22.0",
      })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(repoRoot, "pnpm-workspace.yaml"),
      [
        "packages:",
        "  - apps/*",
        "  - packages/*",
        "minimumReleaseAge: 1440",
        "minimumReleaseAgeExclude:",
        "  - incur@0.4.4",
        "overrides:",
        "  jose: 6.2.2",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(repoRoot, "pnpm-lock.yaml"),
      [
        "lockfileVersion: '9.0'",
        "",
        "packages:",
        "",
        "  'jose@6.2.2':",
        "    resolution: {integrity: sha512-root}",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(repoRoot, "packages", "assistant-runtime", "package.json"),
      `${JSON.stringify({
        name: "@murphai/assistant-runtime",
        version: "1.2.3",
      })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(repoRoot, "packages", "runtime-state", "package.json"),
      `${JSON.stringify({
        name: "@murphai/runtime-state",
        version: "2.3.4",
      })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(bundleDir, "package.json"),
      `${JSON.stringify(
        {
          dependencies: {
            "@murphai/assistant-runtime": "workspace:*",
            jose: "^6.0.0",
          },
          optionalDependencies: {
            "@murphai/runtime-state": "workspace:*",
            "optional-external": "^1.0.0",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeInstalledPackage(runtimePackageRoot, "jose", "6.2.2");
    await writeFile(
      path.join(binDir, "pnpm"),
      [
        "#!/usr/bin/env node",
        "import { appendFileSync } from 'node:fs';",
        `const logPath = ${JSON.stringify(pnpmLogPath)};`,
        "appendFileSync(logPath, `${process.argv.slice(2).join(' ')} SHARP_IGNORE_GLOBAL_LIBVIPS=${process.env.SHARP_IGNORE_GLOBAL_LIBVIPS ?? ''}\\n`, 'utf8');",
      ].join("\n"),
      "utf8",
    );
    await chmod(path.join(binDir, "pnpm"), 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
    try {
      await installPackedRunnerDependencies(
        bundleDir,
        new Map([
          [
            "@murphai/assistant-runtime",
            path.join(tarballsDir, "assistant-runtime.tgz"),
          ],
          ["@murphai/runtime-state", path.join(tarballsDir, "runtime-state.tgz")],
        ]),
        ["@murphai/runtime-state", "@murphai/assistant-runtime"],
        {
          repoRoot,
          runtimePackageRoot,
        },
      );
    } finally {
      process.env.PATH = previousPath;
    }

    await expect(readFile(pnpmLogPath, "utf8")).resolves.toBe(
      [
        "install --prod --lockfile-only SHARP_IGNORE_GLOBAL_LIBVIPS=1",
        "install --prod --frozen-lockfile SHARP_IGNORE_GLOBAL_LIBVIPS=1",
        "",
      ].join("\n"),
    );
    await expect(readFile(path.join(bundleDir, ".npmrc"), "utf8")).resolves.toBe(
      [
        "minimum-release-age=1440",
        "minimum-release-age-exclude[]=incur@0.4.4",
        "node-linker=hoisted",
        "minimum-release-age-exclude[]=@murphai/assistant-runtime@1.2.3",
        "minimum-release-age-exclude[]=@murphai/runtime-state@2.3.4",
        "",
      ].join("\n"),
    );

    const packageJson = JSON.parse(
      await readFile(path.join(bundleDir, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      packageManager?: string;
      pnpm?: {
        overrides?: Record<string, string>;
        supportedArchitectures?: {
          cpu?: string[];
          libc?: string[];
          os?: string[];
        };
      };
    };
    const assistantRuntimeSpecifier = `file:${path.relative(
      bundleDir,
      path.join(tarballsDir, "assistant-runtime.tgz"),
    ).replaceAll(path.sep, "/")}`;
    const runtimeStateSpecifier = `file:${path.relative(
      bundleDir,
      path.join(tarballsDir, "runtime-state.tgz"),
    ).replaceAll(path.sep, "/")}`;

    expect(packageJson.packageManager).toBe("pnpm@10.22.0");
    expect(packageJson.dependencies).toEqual({
      "@murphai/assistant-runtime": assistantRuntimeSpecifier,
      jose: "6.2.2",
    });
    expect(packageJson.optionalDependencies).toEqual({
      "@murphai/runtime-state": runtimeStateSpecifier,
    });
    expect(packageJson.pnpm?.overrides).toEqual({
      "@murphai/assistant-runtime": assistantRuntimeSpecifier,
      "@murphai/runtime-state": runtimeStateSpecifier,
      jose: "6.2.2",
    });
    expect(packageJson.pnpm?.supportedArchitectures).toEqual({
      cpu: ["current", "x64"],
      libc: ["current", "glibc"],
      os: ["current", "linux"],
    });
  });

  it("mirrors root dependency policy into the isolated bundle install", async () => {
    const repoRoot = await createRuntimePackageRoot();
    const installRoot = await createRuntimePackageRoot();

    await writeFile(
      path.join(repoRoot, "pnpm-workspace.yaml"),
      [
        "packages:",
        "  - packages/*",
        "allowBuilds:",
        "  '@prisma/client': true",
        "  esbuild: true",
        "  sharp: true",
        "blockExoticSubdeps: true",
        "engineStrict: true",
        "managePackageManagerVersions: true",
        "minimumReleaseAge: 1440",
        "minimumReleaseAgeExclude:",
        "  - incur@0.4.4",
        "  - '@next/env@16.2.2'",
        "nodeVersion: 24.14.1",
        "packageManagerStrictVersion: true",
        "savePrefix: ''",
        "trustPolicy: no-downgrade",
        "trustPolicyIgnoreAfter: 259200",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeRunnerBundlePnpmInstallConfig(installRoot, repoRoot);

    await expect(
      readFile(path.join(installRoot, ".npmrc"), "utf8"),
    ).resolves.toBe(
      [
        "block-exotic-subdeps=true",
        "engine-strict=true",
        "manage-package-manager-versions=true",
        "minimum-release-age=1440",
        "minimum-release-age-exclude[]=incur@0.4.4",
        "minimum-release-age-exclude[]=@next/env@16.2.2",
        "node-version=24.14.1",
        "only-built-dependencies[]=@prisma/client",
        "only-built-dependencies[]=esbuild",
        "only-built-dependencies[]=sharp",
        "package-manager-strict-version=true",
        "save-prefix=",
        "trust-policy=no-downgrade",
        "trust-policy-ignore-after=259200",
        "node-linker=hoisted",
        "",
      ].join("\n"),
    );
  });

  it("adds local workspace tarballs to minimum release age exclusions", async () => {
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
        "",
      ].join("\n"),
      "utf8",
    );

    await writeRunnerBundlePnpmInstallConfig(installRoot, repoRoot, {
      minimumReleaseAgeExclusions: [
        "incur@0.4.4",
        "@murphai/assistant-runtime@1.0.0",
        "@murphai/runtime-state@1.0.0",
      ],
    });

    await expect(
      readFile(path.join(installRoot, ".npmrc"), "utf8"),
    ).resolves.toBe(
      [
        "minimum-release-age=1440",
        "minimum-release-age-exclude[]=incur@0.4.4",
        "node-linker=hoisted",
        "minimum-release-age-exclude[]=@murphai/assistant-runtime@1.0.0",
        "minimum-release-age-exclude[]=@murphai/runtime-state@1.0.0",
        "",
      ].join("\n"),
    );
  });
});

describe("runner bundle lockfile policy", () => {
  it("accepts generated bundle lockfiles whose external packages are in the root lockfile", async () => {
    const tempDir = await createRuntimePackageRoot();
    const bundleLockfilePath = path.join(tempDir, "bundle-pnpm-lock.yaml");
    const rootLockfilePath = path.join(tempDir, "root-pnpm-lock.yaml");

    await writeFile(
      rootLockfilePath,
      [
        "lockfileVersion: '9.0'",
        "",
        "packages:",
        "",
        "  'jose@6.2.2':",
        "    resolution: {integrity: sha512-root}",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      bundleLockfilePath,
      [
        "lockfileVersion: '9.0'",
        "",
        "packages:",
        "",
        "  'jose@6.2.2':",
        "    resolution: {integrity: sha512-root}",
        "",
        "  file:packages/assistant-runtime.tgz:",
        "    resolution: {integrity: sha512-local}",
        "",
      ].join("\n"),
      "utf8",
    );

    await expect(
      assertRunnerBundleLockfileUsesCommittedResolutions({
        bundleLockfilePath,
        rootLockfilePath,
      }),
    ).resolves.toBeUndefined();
  });

  it("ignores named local tarball package keys in generated bundle lockfiles", async () => {
    const tempDir = await createRuntimePackageRoot();
    const bundleLockfilePath = path.join(tempDir, "bundle-pnpm-lock.yaml");
    const rootLockfilePath = path.join(tempDir, "root-pnpm-lock.yaml");

    await writeFile(
      rootLockfilePath,
      [
        "lockfileVersion: '9.0'",
        "",
        "packages:",
        "",
        "  'jose@6.2.2':",
        "    resolution: {integrity: sha512-root}",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      bundleLockfilePath,
      [
        "lockfileVersion: '9.0'",
        "",
        "packages:",
        "",
        "  'jose@6.2.2':",
        "    resolution: {integrity: sha512-root}",
        "",
        "  '@murphai/assistant-runtime@file:../tarballs/03-_murphai_assistant-runtime/murphai-assistant-runtime-1.0.0.tgz':",
        "    resolution: {integrity: sha512-local-runtime}",
        "",
        "  'runner-helper@link:../local-helper':",
        "    resolution: {integrity: sha512-local-helper}",
        "",
      ].join("\n"),
      "utf8",
    );

    await expect(
      assertRunnerBundleLockfileUsesCommittedResolutions({
        bundleLockfilePath,
        rootLockfilePath,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects generated bundle lockfiles with external package resolutions absent from the root lockfile", async () => {
    const tempDir = await createRuntimePackageRoot();
    const bundleLockfilePath = path.join(tempDir, "bundle-pnpm-lock.yaml");
    const rootLockfilePath = path.join(tempDir, "root-pnpm-lock.yaml");

    await writeFile(
      rootLockfilePath,
      [
        "lockfileVersion: '9.0'",
        "",
        "packages:",
        "",
        "  'jose@6.2.2':",
        "    resolution: {integrity: sha512-root}",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      bundleLockfilePath,
      [
        "lockfileVersion: '9.0'",
        "",
        "packages:",
        "",
        "  'jose@6.2.2':",
        "    resolution: {integrity: sha512-root}",
        "",
        "  'zod@4.2.1':",
        "    resolution: {integrity: sha512-new}",
        "",
      ].join("\n"),
      "utf8",
    );

    await expect(
      assertRunnerBundleLockfileUsesCommittedResolutions({
        bundleLockfilePath,
        rootLockfilePath,
      }),
    ).rejects.toThrow(/zod@4\.2\.1/u);
  });

  it("rejects generated bundle lockfiles when an external package resolves differently than the committed root lockfile", async () => {
    const tempDir = await createRuntimePackageRoot();
    const bundleLockfilePath = path.join(tempDir, "bundle-pnpm-lock.yaml");
    const rootLockfilePath = path.join(tempDir, "root-pnpm-lock.yaml");

    await writeFile(
      rootLockfilePath,
      [
        "lockfileVersion: '9.0'",
        "",
        "packages:",
        "",
        "  'jose@6.2.2':",
        "    resolution: {integrity: sha512-root}",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      bundleLockfilePath,
      [
        "lockfileVersion: '9.0'",
        "",
        "packages:",
        "",
        "  'jose@6.2.2':",
        "    resolution: {integrity: sha512-drifted}",
        "",
        "  file:packages/assistant-runtime.tgz:",
        "    resolution: {integrity: sha512-local}",
        "",
      ].join("\n"),
      "utf8",
    );

    await expect(
      assertRunnerBundleLockfileUsesCommittedResolutions({
        bundleLockfilePath,
        rootLockfilePath,
      }),
    ).rejects.toThrow(/jose@6\.2\.2/u);
  });

  it("rejects external package keys that only include local peers in their suffix", async () => {
    const tempDir = await createRuntimePackageRoot();
    const bundleLockfilePath = path.join(tempDir, "bundle-pnpm-lock.yaml");
    const rootLockfilePath = path.join(tempDir, "root-pnpm-lock.yaml");

    await writeFile(
      rootLockfilePath,
      [
        "lockfileVersion: '9.0'",
        "",
        "packages:",
        "",
        "  'react-helper@1.0.0(file:../tarballs/local-peer.tgz)':",
        "    resolution: {integrity: sha512-root}",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      bundleLockfilePath,
      [
        "lockfileVersion: '9.0'",
        "",
        "packages:",
        "",
        "  'react-helper@1.0.0(file:../tarballs/local-peer.tgz)':",
        "    resolution: {integrity: sha512-drifted}",
        "",
      ].join("\n"),
      "utf8",
    );

    await expect(
      assertRunnerBundleLockfileUsesCommittedResolutions({
        bundleLockfilePath,
        rootLockfilePath,
      }),
    ).rejects.toThrow(/react-helper@1\.0\.0/u);
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
