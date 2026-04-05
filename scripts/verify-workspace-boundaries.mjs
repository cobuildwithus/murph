import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function main() {
  const failures = [];

  await verifyTypecheckScripts(failures);
  await verifyTypecheckTsconfigs(failures);
  await verifyTsconfigPathMappings(failures);
  await verifyWorkspaceImports(failures);

  if (failures.length > 0) {
    console.error("Workspace boundary verification failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Workspace boundary verification passed.");
}

async function verifyTypecheckScripts(failures) {
  const packageJsonPaths = await findFiles(["packages", "apps"], (filePath) =>
    path.basename(filePath) === "package.json",
  );

  for (const packageJsonPath of packageJsonPaths) {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    const typecheckScript = packageJson.scripts?.typecheck;

    if (
      typeof typecheckScript === "string" &&
      /pnpm\s+--dir\s+\.\.\/[^\s;&|]+(?:\/[^\s;&|]+)*\s+build\b/u.test(typecheckScript)
    ) {
      failures.push(
        `${path.relative(repoRoot, packageJsonPath)} typecheck script still prebuilds sibling workspace packages; keep package-local typecheck source-based and no-emit.`,
      );
    }
  }
}

async function verifyTypecheckTsconfigs(failures) {
  const tsconfigPaths = await findFiles(["packages", "apps"], (filePath) =>
    path.basename(filePath) === "tsconfig.typecheck.json",
  );

  for (const tsconfigPath of tsconfigPaths) {
    const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf8"));

    if (tsconfig.compilerOptions?.disableSourceOfProjectReferenceRedirect === true) {
      failures.push(
        `${path.relative(repoRoot, tsconfigPath)} sets disableSourceOfProjectReferenceRedirect; package-local typecheck should resolve referenced workspace packages from source.`,
      );
    }
  }
}

async function verifyTsconfigPathMappings(failures) {
  const tsconfigPaths = await findFiles([".", "packages", "apps"], (filePath) =>
    /^tsconfig(\.[^.]+)?\.json$/u.test(path.basename(filePath)),
  );

  for (const tsconfigPath of tsconfigPaths) {
    const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf8"));
    const configMember = findWorkspaceMember(tsconfigPath);
    const pathMappings = tsconfig.compilerOptions?.paths ?? {};

    for (const [specifier, targets] of Object.entries(pathMappings)) {
      const candidates = Array.isArray(targets) ? targets : [targets];

      for (const target of candidates) {
        if (typeof target !== "string") {
          continue;
        }

        const resolvedTarget = path.resolve(path.dirname(tsconfigPath), target);
        const targetMember = findWorkspaceMember(resolvedTarget);
        const pointsAtSiblingBuildArtifact = isSiblingBuildArtifactPath(
          configMember,
          targetMember,
          resolvedTarget,
        );

        if (pointsAtSiblingBuildArtifact) {
          failures.push(
            `${path.relative(repoRoot, tsconfigPath)} maps ${specifier} to sibling build output ${path.relative(repoRoot, resolvedTarget)}; internal workspace consumers must resolve other packages from source.`,
          );
        }
      }
    }
  }
}

async function verifyWorkspaceImports(failures) {
  const exportedSpecifiersByPackage = await buildExportedSpecifiersByPackage();
  const workspacePackageNames = [...exportedSpecifiersByPackage.keys()].sort(
    (left, right) => right.length - left.length,
  );
  const sourceLikeFiles = await findFiles(["packages", "apps", "e2e", "config"], (filePath) =>
    /\.[cm]?[jt]sx?$/u.test(filePath),
  );

  for (const filePath of sourceLikeFiles) {
    const source = await readFile(filePath, "utf8");
    const sourceMember = findWorkspaceMember(filePath);

    for (const specifier of extractModuleSpecifiers(source)) {
      const importPolicyFailure = verifyWorkspaceImportPolicy({
        filePath,
        sourceMember,
        specifier,
      });

      if (importPolicyFailure) {
        failures.push(importPolicyFailure);
      }

      if (specifier.startsWith(".")) {
        const resolvedTarget = path.resolve(path.dirname(filePath), specifier);
        const targetMember = findWorkspaceMember(resolvedTarget);

        if (targetMember !== null && targetMember !== sourceMember) {
          failures.push(
            `${path.relative(repoRoot, filePath)} reaches into ${targetMember} through relative import ${JSON.stringify(specifier)}; import sibling workspace code by package name instead.`,
          );
        }
        continue;
      }

      const packageName = workspacePackageNames.find(
        (name) => specifier === name || specifier.startsWith(`${name}/`),
      );
      if (!packageName) {
        continue;
      }

      const allowedPatterns = exportedSpecifiersByPackage.get(packageName);

      if (!allowedPatterns) {
        failures.push(
          `${path.relative(repoRoot, filePath)} imports unknown workspace package specifier ${JSON.stringify(specifier)}.`,
        );
        continue;
      }

      if (!allowedPatterns.some((pattern) => pattern.test(specifier))) {
        failures.push(
          `${path.relative(repoRoot, filePath)} imports ${JSON.stringify(specifier)}, which is not a declared public workspace entrypoint for ${packageName}.`,
        );
      }
    }
  }
}

async function buildExportedSpecifiersByPackage() {
  const packageJsonPaths = await findFiles(["packages", "apps"], (filePath) =>
    path.basename(filePath) === "package.json",
  );
  const exportedSpecifiersByPackage = new Map();

  for (const packageJsonPath of packageJsonPaths) {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

    if (typeof packageJson.name !== "string") {
      continue;
    }

    const patterns = [new RegExp(`^${escapeRegExp(packageJson.name)}$`, "u")];
    for (const exportKey of Object.keys(packageJson.exports ?? {})) {
      if (exportKey === "." || !exportKey.startsWith("./")) {
        continue;
      }

      const exportedSpecifier = `${packageJson.name}/${exportKey.slice(2)}`;
      patterns.push(
        new RegExp(`^${escapeRegExp(exportedSpecifier).replace(/\\\*/gu, ".+")}$`, "u"),
      );
    }

    exportedSpecifiersByPackage.set(packageJson.name, patterns);
  }

  return exportedSpecifiersByPackage;
}

function verifyWorkspaceImportPolicy({
  filePath,
  sourceMember,
  specifier,
}) {
  if (specifier === "@murphai/device-syncd" && sourceMember !== "packages/device-syncd") {
    return `${path.relative(repoRoot, filePath)} imports ${JSON.stringify(specifier)} from the device-sync daemon root; internal workspace consumers must use @murphai/device-syncd/public-ingress, @murphai/device-syncd/client, or another explicit subpath so they do not depend on the daemon root convenience surface.`;
  }

  if (
    sourceMember === "apps/cloudflare"
    && (specifier === "@murphai/assistant-core"
      || specifier.startsWith("@murphai/assistant-core/"))
    && filePath.includes(`${path.sep}apps${path.sep}cloudflare${path.sep}src${path.sep}`)
  ) {
    return `${path.relative(repoRoot, filePath)} imports ${JSON.stringify(specifier)} directly; apps/cloudflare must depend on @murphai/assistant-runtime or another hosted-runtime owner surface instead of the lower assistant-core boundary.`;
  }

  return null;
}

function extractModuleSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'"`]*?\s+from\s+)?["']([^"'`]+)["']/gu,
    /\bimport\s*\(\s*["']([^"'`]+)["']\s*\)/gu,
    /\brequire\s*\(\s*["']([^"'`]+)["']\s*\)/gu,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(source);
    while (match !== null) {
      specifiers.push(match[1]);
      match = pattern.exec(source);
    }
  }

  return specifiers;
}

function findWorkspaceMember(filePath) {
  const relativePath = path.relative(repoRoot, filePath);
  if (relativePath.startsWith("..")) {
    return null;
  }

  const segments = relativePath.split(path.sep);
  if (segments.length < 2) {
    return null;
  }

  if (segments[0] === "packages" || segments[0] === "apps" || segments[0] === "e2e") {
    return `${segments[0]}/${segments[1]}`;
  }

  return null;
}

export function isWorkspaceBuildArtifactPath(filePath) {
  return /[\\/](dist|\.test-dist|\.next|\.next-dev|\.next-smoke)[\\/]/u.test(filePath);
}

export function isSiblingBuildArtifactPath(configMember, targetMember, resolvedTarget) {
  return (
    targetMember !== null &&
    targetMember !== configMember &&
    isWorkspaceBuildArtifactPath(resolvedTarget)
  );
}

async function findFiles(searchRoots, predicate) {
  const files = [];
  const seenDirectories = new Set();

  for (const searchRoot of searchRoots) {
    const absoluteRoot = path.resolve(repoRoot, searchRoot);
    if (seenDirectories.has(absoluteRoot)) {
      continue;
    }
    seenDirectories.add(absoluteRoot);

    if (!(await pathExists(absoluteRoot))) {
      continue;
    }

    files.push(...(await findFilesRecursive(absoluteRoot, predicate)));
  }

  return files;
}

async function findFilesRecursive(directoryPath, predicate) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) {
        continue;
      }

      files.push(...(await findFilesRecursive(entryPath, predicate)));
      continue;
    }

    if (entry.isFile() && predicate(entryPath)) {
      files.push(entryPath);
    }
  }

  return files;
}

export function shouldSkipDirectory(name) {
  return (
    name === "node_modules" ||
    name === "dist" ||
    name === ".next" ||
    name === ".next-dev" ||
    name === ".next-smoke" ||
    name === ".test-dist" ||
    name === ".git" ||
    name === "coverage"
  );
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
