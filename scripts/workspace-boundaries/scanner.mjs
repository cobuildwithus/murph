import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const workspaceMemberPackageJsonCache = new Map();

export async function findFiles(searchRoots, predicate) {
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

export function extractModuleSpecifiers(source) {
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

export function findWorkspaceMember(filePath) {
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
  return String(filePath)
    .replace(/\\/g, "/")
    .split("/")
    .some((segment) =>
      segment === "dist" ||
      segment === ".test-dist" ||
      segment === ".next" ||
      segment === ".next-dev" ||
      isNextSmokeArtifactDirectoryName(segment),
    );
}

export function isSiblingBuildArtifactPath(configMember, targetMember, resolvedTarget) {
  return (
    targetMember !== null &&
    targetMember !== configMember &&
    isWorkspaceBuildArtifactPath(resolvedTarget)
  );
}

export function shouldSkipDirectory(name) {
  return (
    name === "node_modules" ||
    name === "dist" ||
    name === ".deploy" ||
    name === ".next" ||
    name === ".next-dev" ||
    isNextSmokeArtifactDirectoryName(name) ||
    name === ".test-dist" ||
    name === ".git" ||
    name === "coverage"
  );
}

export function sourceReexportsSpecifier(source, specifier) {
  return new RegExp(
    `^\\s*export\\s+(?:\\*|\\{[^}]+\\})\\s+from\\s+["']${escapeRegExp(specifier)}["']`,
    "mu",
  ).test(source);
}

export function sourceMentionsSpecifier(source, specifier) {
  return extractModuleSpecifiers(source).includes(specifier);
}

export function sourceMentionsText(source, snippet) {
  return source.includes(snippet);
}

export async function readWorkspaceMemberPackageJson(workspaceMember) {
  if (workspaceMemberPackageJsonCache.has(workspaceMember)) {
    return workspaceMemberPackageJsonCache.get(workspaceMember);
  }

  const packageJsonPath = path.join(repoRoot, workspaceMember, "package.json");
  const packageJson = await pathExists(packageJsonPath)
    ? JSON.parse(await readFile(packageJsonPath, "utf8"))
    : null;

  workspaceMemberPackageJsonCache.set(workspaceMember, packageJson);
  return packageJson;
}

export function workspacePackageDeclaresDependency(packageJson, dependencyName) {
  return [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.peerDependencies,
    packageJson.optionalDependencies,
  ].some((dependencies) =>
    Boolean(dependencies && typeof dependencies === "object" && dependencyName in dependencies)
  );
}

export async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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

function isNextSmokeArtifactDirectoryName(name) {
  return /^\.next-smoke(?:-|$)/u.test(name);
}
