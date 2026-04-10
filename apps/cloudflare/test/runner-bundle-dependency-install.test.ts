import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { pinInstalledDependencyVersions } from "../scripts/runner-bundle/dependency-install.js";

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
