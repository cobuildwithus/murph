import { chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export async function pruneRunnerBundle(bundleDir: string): Promise<void> {
  await Promise.all([
    removeBundlePathIfPresent(path.join(bundleDir, "README.md")),
    removeBundlePathIfPresent(path.join(bundleDir, "DEPLOY.md")),
    removeBundlePathIfPresent(path.join(bundleDir, "LICENSE")),
  ]);
  await pruneNonRuntimeFiles(bundleDir);
}

async function pruneNonRuntimeFiles(rootDir: string): Promise<void> {
  try {
    await walkBundleFiles(rootDir, async (entryPath) => {
      const entryName = path.basename(entryPath);

      if (
        entryName === ".pnpm-workspace-state-v1.json" ||
        entryName === ".modules.yaml" ||
        entryName === "pnpm-lock.yaml" ||
        entryPath.endsWith(".d.ts") ||
        entryPath.endsWith(".d.ts.map") ||
        entryPath.endsWith(".d.mts") ||
        entryPath.endsWith(".d.cts") ||
        entryPath.endsWith(".map") ||
        entryPath.endsWith(".tsbuildinfo")
      ) {
        await rm(entryPath, { force: true });
      }
    });
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }

    throw error;
  }
}

async function walkBundleFiles(
  rootDir: string,
  visit: (entryPath: string) => Promise<void>,
): Promise<void> {
  const directoryEntries = await readdir(rootDir, { withFileTypes: true });

  for (const entry of directoryEntries) {
    const entryPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      await walkBundleFiles(entryPath, visit);
      continue;
    }

    await visit(entryPath);
  }
}

export async function rewriteRuntimePackageManifest(
  bundleDir: string,
): Promise<void> {
  const packageJsonPath = path.join(bundleDir, "package.json");
  const raw = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(raw) as Record<string, unknown> & {
    dependencies?: Record<string, string>;
    exports?: Record<string, unknown> | string;
    optionalDependencies?: Record<string, string>;
  };
  const optionalDependencies = await resolveInstalledBundleDependencyVersions(
    bundleDir,
    packageJson.optionalDependencies,
    { allowMissing: true },
  );

  const runtimePackageJson = {
    dependencies: await resolveInstalledBundleDependencyVersions(
      bundleDir,
      packageJson.dependencies,
    ),
    engines: packageJson.engines,
    exports: stripTypeOnlyExportMetadata(packageJson.exports),
    license: packageJson.license,
    main: packageJson.main,
    name: packageJson.name,
    ...(Object.keys(optionalDependencies).length > 0
      ? { optionalDependencies }
      : {}),
    private: packageJson.private,
    type: packageJson.type,
    version: packageJson.version,
  };

  await writeFile(
    packageJsonPath,
    `${JSON.stringify(runtimePackageJson, null, 2)}\n`,
    "utf8",
  );
}

function stripTypeOnlyExportMetadata(
  exportsField: Record<string, unknown> | string | undefined,
): Record<string, unknown> | string | undefined {
  if (!exportsField || typeof exportsField === "string") {
    return exportsField;
  }

  return Object.fromEntries(
    Object.entries(exportsField).map(([subpath, value]) => {
      if (!value || typeof value === "string") {
        return [subpath, value];
      }

      if (Array.isArray(value)) {
        return [subpath, value];
      }

      const runtimeConditions = Object.fromEntries(
        Object.entries(value).filter(([condition]) => condition !== "types"),
      );

      return [subpath, runtimeConditions];
    }),
  );
}

async function resolveInstalledBundleDependencyVersions(
  bundleDir: string,
  dependencyGroup: Record<string, string> | undefined,
  options: {
    allowMissing?: boolean;
  } = {},
): Promise<Record<string, string>> {
  if (!dependencyGroup) {
    return {};
  }

  const resolvedEntries = await Promise.all(
    Object.keys(dependencyGroup).map(async (dependencyName) => {
      const packageJsonPath = path.join(
        bundleDir,
        "node_modules",
        ...dependencyName.split("/"),
        "package.json",
      );
      let dependencyPackageJsonRaw: string;

      try {
        dependencyPackageJsonRaw = await readFile(packageJsonPath, "utf8");
      } catch (error) {
        if (options.allowMissing && isMissingFileError(error)) {
          return null;
        }

        throw error;
      }

      const dependencyPackageJson = JSON.parse(
        dependencyPackageJsonRaw,
      ) as {
        version?: string;
      };

      if (
        typeof dependencyPackageJson.version !== "string" ||
        dependencyPackageJson.version.length === 0
      ) {
        throw new Error(
          `Runner bundle is missing an installed version for ${dependencyName}.`,
        );
      }

      return [dependencyName, dependencyPackageJson.version] as const;
    }),
  );

  return Object.fromEntries(
    resolvedEntries.filter(
      (entry): entry is readonly [string, string] => Array.isArray(entry),
    ),
  );
}

export async function rewriteRuntimeBinWrappers(
  bundleDir: string,
): Promise<void> {
  const nodeModulesDir = path.join(bundleDir, "node_modules");
  const binDir = path.join(nodeModulesDir, ".bin");

  await mkdir(binDir, { recursive: true });

  for (const packageDir of await listTopLevelInstalledPackages(nodeModulesDir)) {
    const packageJsonPath = path.join(packageDir, "package.json");
    let packageJsonRaw: string;

    try {
      packageJsonRaw = await readFile(packageJsonPath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        continue;
      }

      throw error;
    }

    const packageJson = JSON.parse(packageJsonRaw) as {
      bin?: Record<string, string> | string;
      name?: string;
    };
    const binMap = normalizeBinMap(packageJson);

    if (!binMap) {
      continue;
    }

    for (const [binName, targetPath] of Object.entries(binMap)) {
      const wrapperPath = path.join(binDir, binName);
      const relativeTargetPath = toPosixPath(
        path.relative(binDir, path.join(packageDir, targetPath)),
      );

      await writeFile(
        wrapperPath,
        buildPortableNodeBinWrapper(relativeTargetPath),
        "utf8",
      );
      await chmod(wrapperPath, 0o755);
    }
  }
}

async function listTopLevelInstalledPackages(
  nodeModulesDir: string,
): Promise<string[]> {
  let entries;

  try {
    entries = await readdir(nodeModulesDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }

  const packages: string[] = [];

  for (const entry of entries) {
    if (entry.name === ".bin" || entry.name === ".pnpm") {
      continue;
    }

    const entryPath = path.join(nodeModulesDir, entry.name);

    if (entry.name.startsWith("@")) {
      const scopedEntries = await readdir(entryPath, { withFileTypes: true });

      for (const scopedEntry of scopedEntries) {
        if (scopedEntry.isDirectory() || scopedEntry.isSymbolicLink()) {
          packages.push(path.join(entryPath, scopedEntry.name));
        }
      }

      continue;
    }

    if (entry.isDirectory() || entry.isSymbolicLink()) {
      packages.push(entryPath);
    }
  }

  return packages;
}

function normalizeBinMap(packageJson: {
  bin?: Record<string, string> | string;
  name?: string;
}): Record<string, string> | null {
  if (!packageJson.bin) {
    return null;
  }

  if (typeof packageJson.bin === "string") {
    if (!packageJson.name) {
      return null;
    }

    const inferredBinName = packageJson.name.startsWith("@")
      ? packageJson.name.slice(packageJson.name.indexOf("/") + 1)
      : packageJson.name;

    return {
      [inferredBinName]: packageJson.bin,
    };
  }

  return Object.fromEntries(
    Object.entries(packageJson.bin).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1].length > 0,
    ),
  );
}

function buildPortableNodeBinWrapper(relativeTargetPath: string): string {
  return [
    "#!/bin/sh",
    "basedir=$(dirname \"$(echo \"$0\" | sed -e 's,\\\\,/,g')\")",
    "",
    "case `uname` in",
    "    *CYGWIN*|*MINGW*|*MSYS*)",
    "        if command -v cygpath > /dev/null 2>&1; then",
    "            basedir=`cygpath -w \"$basedir\"`",
    "        fi",
    "    ;;",
    "esac",
    "",
    "if [ -x \"$basedir/node\" ]; then",
    `  exec \"$basedir/node\" \"$basedir/${relativeTargetPath}\" \"$@\"`,
    "else",
    `  exec node \"$basedir/${relativeTargetPath}\" \"$@\"`,
    "fi",
    "",
  ].join("\n");
}

function toPosixPath(value: string): string {
  return value.replaceAll(path.sep, "/");
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT",
  );
}

async function removeBundlePathIfPresent(targetPath: string): Promise<void> {
  await rm(targetPath, { force: true, recursive: true });
}
