import { readFile } from "node:fs/promises";
import path from "node:path";

import { findFiles, pathExists, repoRoot } from "./scanner.mjs";

const ALLOWED_ASSISTANT_ENGINE_IMPLEMENTATION_SHAPED_EXPORTS = new Set([
]);

export async function verifyWorkspacePackageExports(failures) {
  const packageJsonPaths = await findFiles(["packages", "apps"], (filePath) =>
    path.basename(filePath) === "package.json",
  );

  for (const packageJsonPath of packageJsonPaths) {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

    for (const exportKey of Object.keys(packageJson.exports ?? {})) {
      const failure = getWorkspacePackageExportFailure({
        exportKey,
        packageJson,
        packageJsonPath,
      });
      if (failure) {
        failures.push(failure);
      }
    }

    if (
      typeof packageJson.name === "string"
      && !workspacePackageAllowsRootSpecifier(packageJson)
      && ("main" in packageJson || "types" in packageJson)
    ) {
      failures.push(
        `${path.relative(repoRoot, packageJsonPath)} declares main/types even though the package does not export "."; subpath-only workspace packages must not keep a root fallback entrypoint.`,
      );
    }
  }
}

export function getWorkspacePackageExportFailure({
  exportKey,
  packageJson,
  packageJsonPath,
}) {
  if (exportKey === "./assistant/*") {
    return `${path.relative(repoRoot, packageJsonPath)} declares ${JSON.stringify(exportKey)} as a public entrypoint; assistant/* is an internal namespace and must be surfaced through dedicated top-level package exports instead.`;
  }

  if (
    packageJson.name === "@murphai/assistant-engine"
    && isAssistantEngineImplementationShapedExport(exportKey)
    && !ALLOWED_ASSISTANT_ENGINE_IMPLEMENTATION_SHAPED_EXPORTS.has(exportKey)
  ) {
    return `${path.relative(repoRoot, packageJsonPath)} declares ${JSON.stringify(exportKey)} as a public entrypoint; assistant-engine assistant/* file-shaped exports are implementation detail and must stay behind semantic top-level seams unless the exact subpath is explicitly allowlisted here.`;
  }

  if (
    packageJson.name === "@murphai/assistant-engine"
    && isAssistantEngineWildcardHelperNamespace(exportKey)
  ) {
    return `${path.relative(repoRoot, packageJsonPath)} declares ${JSON.stringify(exportKey)} as a public entrypoint; assistant-engine helper namespaces must stay on explicit named exports so inbox and usecase internals do not become ambient package surface.`;
  }

  if (
    packageJson.name === "@murphai/assistant-engine"
    && isAssistantEngineInternalHelperExport(exportKey)
  ) {
    return `${path.relative(repoRoot, packageJsonPath)} declares ${JSON.stringify(exportKey)} as a public entrypoint; assistant-engine must keep CLI/inbox/usecase helper modules behind its canonical owner surfaces instead of exporting the internal helper directly.`;
  }

  if (
    packageJson.name === "@murphai/operator-config"
    && exportKey === "./runtime-errors"
  ) {
    return `${path.relative(repoRoot, packageJsonPath)} declares ${JSON.stringify(exportKey)} as a public entrypoint; runtime-unavailable helpers belong with @murphai/vault-usecases/runtime instead of the operator-config contract surface.`;
  }

  if (
    packageJson.name === "@murphai/operator-config"
    && exportKey === "./knowledge-contracts"
  ) {
    return `${path.relative(repoRoot, packageJsonPath)} declares ${JSON.stringify(exportKey)} as a public entrypoint; knowledge result contracts are owned by @murphai/query and must not leak back through the operator-config boundary.`;
  }

  if (
    packageJson.name === "@murphai/messaging-ingress"
    && exportKey === "."
  ) {
    return `${path.relative(repoRoot, packageJsonPath)} declares ${JSON.stringify(exportKey)} as a public entrypoint; messaging-ingress should expose provider-specific seams only instead of a root convenience barrel.`;
  }

  if (
    packageJson.name === "@murphai/cloudflare-hosted-control"
    && exportKey === "."
  ) {
    return `${path.relative(repoRoot, packageJsonPath)} declares ${JSON.stringify(exportKey)} as a public entrypoint; cloudflare-hosted-control should expose only its dedicated client/contracts/parsers/routes seams instead of a root umbrella barrel.`;
  }

  if (
    packageJson.name === "@murphai/murph"
    && exportKey === "./knowledge-cli-contracts"
  ) {
    return `${path.relative(repoRoot, packageJsonPath)} declares ${JSON.stringify(exportKey)} as a public entrypoint; shared knowledge result contracts belong on @murphai/query, so the published CLI package must not grow a second public knowledge-contract surface.`;
  }

  if (
    packageJson.name === "@murphai/importers"
    && exportKey === "./device-providers"
  ) {
    return `${path.relative(repoRoot, packageJsonPath)} declares ${JSON.stringify(exportKey)} as a public entrypoint; cross-package wearable metadata must stay on @murphai/importers/device-providers/provider-descriptors instead of leaking the full device-provider implementation barrel.`;
  }

  if (
    packageJson.name === "@murphai/query"
    && exportKey === "./knowledge-contracts"
  ) {
    return `${path.relative(repoRoot, packageJsonPath)} declares ${JSON.stringify(exportKey)} as a public entrypoint; derived-knowledge result contracts already live on the @murphai/query root surface and should not leak as a duplicate subpath boundary.`;
  }

  if (
    packageJson.name === "@murphai/query"
    && exportKey === "./knowledge-search"
  ) {
    return `${path.relative(repoRoot, packageJsonPath)} declares ${JSON.stringify(exportKey)} as a public entrypoint; derived-knowledge search helpers already live on the @murphai/query root surface and should not leak as a duplicate subpath boundary.`;
  }

  if (
    packageJson.name === "@murphai/query"
    && exportKey === "./search"
  ) {
    return `${path.relative(repoRoot, packageJsonPath)} declares ${JSON.stringify(exportKey)} as a public entrypoint; lexical vault search already lives on the @murphai/query root surface, so the internal search module should not leak as a second boundary.`;
  }

  if (exportKey === "./testing") {
    return `${path.relative(repoRoot, packageJsonPath)} declares ${JSON.stringify(exportKey)} as a public entrypoint; test helpers must stay package-local or use package-local Vitest aliases instead of leaking through the workspace package surface.`;
  }

  return null;
}

export async function verifyWorkspacePackageExportTargets(failures) {
  const packageJsonPaths = await findFiles(["packages", "apps"], (filePath) =>
    path.basename(filePath) === "package.json",
  );

  for (const packageJsonPath of packageJsonPaths) {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    const packageDir = path.dirname(packageJsonPath);

    for (const [exportKey, exportTarget] of listWorkspaceExportTargets(packageJson.exports ?? {})) {
      if (
        typeof exportTarget !== "string"
        || exportTarget.includes("*")
        || !exportTarget.startsWith("./dist/")
      ) {
        continue;
      }

      if (await workspaceExportTargetHasSourceModule(packageDir, exportTarget)) {
        continue;
      }

      failures.push(
        `${path.relative(repoRoot, packageJsonPath)} declares ${JSON.stringify(exportKey)} -> ${JSON.stringify(exportTarget)}, but no matching owner source module exists. Remove the stale public entrypoint or restore its source file.`,
      );
    }
  }
}

function workspacePackageAllowsRootSpecifier(packageJson) {
  if (!("exports" in packageJson)) {
    return true;
  }

  const exportsField = packageJson.exports;
  if (typeof exportsField === "string" || Array.isArray(exportsField)) {
    return true;
  }

  if (!exportsField || typeof exportsField !== "object") {
    return false;
  }

  const exportKeys = Object.keys(exportsField);
  if (exportKeys.some((key) => !key.startsWith("."))) {
    return true;
  }

  return Object.hasOwn(exportsField, ".");
}

function listWorkspaceExportTargets(exportsField) {
  if (!exportsField || typeof exportsField !== "object" || Array.isArray(exportsField)) {
    return [];
  }

  return Object.entries(exportsField).flatMap(([exportKey, exportValue]) =>
    collectWorkspaceExportTargets(exportValue).map((exportTarget) => [exportKey, exportTarget]),
  );
}

function isAssistantEngineWildcardHelperNamespace(exportKey) {
  return (
    /^\.\/inbox-services(?:\/.+)?\/\*$/u.test(exportKey)
    || /^\.\/usecases(?:\/.+)?\/\*$/u.test(exportKey)
  );
}

function isAssistantEngineImplementationShapedExport(exportKey) {
  return /^\.\/assistant\//u.test(exportKey);
}

function isAssistantEngineInternalHelperExport(exportKey) {
  return (
    exportKey === "./assistant-cli-access"
    || exportKey === "./assistant-cli-tools"
    || exportKey === "./process-kill"
    || exportKey === "./health-registry-command-metadata"
    || exportKey === "./inbox-app/types"
    || exportKey === "./inbox-services/connectors"
    || exportKey === "./inbox-services/daemon"
    || exportKey === "./inbox-services/promotions"
    || exportKey === "./usecases/experiment-journal-vault"
    || exportKey === "./usecases/explicit-health-family-services"
    || exportKey === "./usecases/record-mutations"
  );
}

function collectWorkspaceExportTargets(exportValue) {
  if (typeof exportValue === "string") {
    return [exportValue];
  }

  if (Array.isArray(exportValue)) {
    return exportValue.flatMap((entry) => collectWorkspaceExportTargets(entry));
  }

  if (exportValue && typeof exportValue === "object") {
    return Object.values(exportValue).flatMap((entry) => collectWorkspaceExportTargets(entry));
  }

  return [];
}

async function workspaceExportTargetHasSourceModule(packageDir, exportTarget) {
  for (const candidatePath of resolveWorkspaceExportSourceCandidates(packageDir, exportTarget)) {
    if (await pathExists(candidatePath)) {
      return true;
    }
  }

  return false;
}

function resolveWorkspaceExportSourceCandidates(packageDir, exportTarget) {
  const sourceStem = stripWorkspaceBuildOutputExtension(exportTarget.slice("./dist/".length));
  const baseCandidates = [
    path.join(packageDir, "src", sourceStem),
    path.join(packageDir, sourceStem),
  ];
  const fileExtensions = [
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
  ];
  const indexFiles = [
    "index.ts",
    "index.tsx",
    "index.mts",
    "index.cts",
    "index.js",
    "index.jsx",
    "index.mjs",
    "index.cjs",
  ];

  return baseCandidates.flatMap((basePath) => [
    ...fileExtensions.map((extension) => `${basePath}${extension}`),
    ...indexFiles.map((indexFile) => path.join(basePath, indexFile)),
  ]);
}

function stripWorkspaceBuildOutputExtension(value) {
  return value
    .replace(/\.d\.ts$/u, "")
    .replace(/\.[cm]?jsx?$/u, "");
}
