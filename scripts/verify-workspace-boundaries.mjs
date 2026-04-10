import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceMemberPackageJsonCache = new Map();

export async function main() {
  const failures = [];

  await verifyTypecheckScripts(failures);
  await verifyTypecheckTsconfigs(failures);
  await verifyWorkspacePackageExports(failures);
  await verifyAssistantEnginePublicSourceSurface(failures);
  await verifyFocusedOwnerSourceSurfaces(failures);
  await verifyWorkspacePackageExportTargets(failures);
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

async function verifyWorkspacePackageExports(failures) {
  const packageJsonPaths = await findFiles(["packages", "apps"], (filePath) =>
    path.basename(filePath) === "package.json",
  );

  for (const packageJsonPath of packageJsonPaths) {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

    for (const exportKey of Object.keys(packageJson.exports ?? {})) {
      if (exportKey === "./assistant/*") {
        failures.push(
          `${path.relative(repoRoot, packageJsonPath)} declares ${JSON.stringify(exportKey)} as a public entrypoint; assistant/* is an internal namespace and must be surfaced through dedicated top-level package exports instead.`,
        );
      }

      if (
        packageJson.name === "@murphai/assistant-engine"
        && isAssistantEngineWildcardHelperNamespace(exportKey)
      ) {
        failures.push(
          `${path.relative(repoRoot, packageJsonPath)} declares ${JSON.stringify(exportKey)} as a public entrypoint; assistant-engine helper namespaces must stay on explicit named exports so inbox and usecase internals do not become ambient package surface.`,
        );
      }

      if (
        packageJson.name === "@murphai/assistant-engine"
        && isAssistantEngineInternalHelperExport(exportKey)
      ) {
        failures.push(
          `${path.relative(repoRoot, packageJsonPath)} declares ${JSON.stringify(exportKey)} as a public entrypoint; assistant-engine must keep CLI/inbox/usecase helper modules behind its canonical owner surfaces instead of exporting the internal helper directly.`,
        );
      }

      if (
        packageJson.name === "@murphai/operator-config"
        && exportKey === "./runtime-errors"
      ) {
        failures.push(
          `${path.relative(repoRoot, packageJsonPath)} declares ${JSON.stringify(exportKey)} as a public entrypoint; runtime-unavailable helpers belong with @murphai/vault-usecases/runtime instead of the operator-config contract surface.`,
        );
      }

      if (
        packageJson.name === "@murphai/importers"
        && exportKey === "./device-providers"
      ) {
        failures.push(
          `${path.relative(repoRoot, packageJsonPath)} declares ${JSON.stringify(exportKey)} as a public entrypoint; cross-package wearable metadata must stay on @murphai/importers/device-providers/provider-descriptors instead of leaking the full device-provider implementation barrel.`,
        );
      }

      if (
        packageJson.name === "@murphai/query"
        && exportKey === "./search"
      ) {
        failures.push(
          `${path.relative(repoRoot, packageJsonPath)} declares ${JSON.stringify(exportKey)} as a public entrypoint; lexical vault search already lives on the @murphai/query root surface, so the internal search module should not leak as a second boundary.`,
        );
      }

      if (exportKey === "./testing") {
        failures.push(
          `${path.relative(repoRoot, packageJsonPath)} declares ${JSON.stringify(exportKey)} as a public entrypoint; test helpers must stay package-local or use package-local Vitest aliases instead of leaking through the workspace package surface.`,
        );
      }
    }
  }
}

async function verifyAssistantEnginePublicSourceSurface(failures) {
  const assistantEngineIndexPath = path.join(repoRoot, "packages", "assistant-engine", "src", "index.ts");
  const assistantEngineProviderPath = path.join(
    repoRoot,
    "packages",
    "assistant-engine",
    "src",
    "assistant-provider.ts",
  );

  const indexSource = await readFile(assistantEngineIndexPath, "utf8");
  const providerSource = await readFile(assistantEngineProviderPath, "utf8");

  for (const specifier of [
    "./assistant-cli-access.js",
    "./assistant-cli-tools.js",
    "./assistant-vault-paths.js",
    "./process-kill.js",
  ]) {
    if (sourceReexportsSpecifier(indexSource, specifier)) {
      failures.push(
        `packages/assistant-engine/src/index.ts re-exports ${JSON.stringify(specifier)}; assistant-engine's public root must stay on canonical runtime surfaces instead of leaking internal CLI/config helpers.`,
      );
    }
  }

  if (sourceReexportsSpecifier(providerSource, "./assistant/provider-config.js")) {
    failures.push(
      "packages/assistant-engine/src/assistant-provider.ts re-exports ./assistant/provider-config.js; assistant provider config remains owned by @murphai/operator-config and should not leak through the assistant-provider surface.",
    );
  }

  for (const specifier of [
    "./assistant-cli-access.js",
    "./assistant-cli-tools.js",
  ]) {
    if (sourceReexportsSpecifier(providerSource, specifier)) {
      failures.push(
        `packages/assistant-engine/src/assistant-provider.ts re-exports ${JSON.stringify(specifier)}; assistant-provider must stay on provider runtime state and recovery instead of leaking CLI access or tool-catalog helpers.`,
      );
    }
  }
}

async function verifyFocusedOwnerSourceSurfaces(failures) {
  const sourceChecks = [
    {
      path: path.join(repoRoot, "packages", "device-syncd", "src", "public-ingress.ts"),
      failures: [
        {
          specifier: "./config.ts",
          message:
            "packages/device-syncd/src/public-ingress.ts re-exports ./config.ts; the shared public-ingress seam must stay on provider-agnostic callback and webhook behavior instead of leaking daemon config readers through a second boundary.",
        },
        {
          specifier: "./http.ts",
          message:
            "packages/device-syncd/src/public-ingress.ts re-exports ./http.ts; the shared public-ingress seam must not bundle daemon HTTP helpers when @murphai/device-syncd/http already owns that surface.",
        },
      ],
      predicate: sourceReexportsSpecifier,
    },
    {
      path: path.join(repoRoot, "packages", "messaging-ingress", "src", "telegram-webhook.ts"),
      failures: [
        {
          specifier: "./telegram-webhook-payload.ts",
          message:
            "packages/messaging-ingress/src/telegram-webhook.ts re-exports ./telegram-webhook-payload.ts; raw Telegram payload parsing must stay on its dedicated owner surface instead of hiding behind the thread-target and summary entrypoint.",
        },
      ],
      predicate: sourceReexportsSpecifier,
    },
    {
      path: path.join(repoRoot, "packages", "query", "src", "knowledge-graph.ts"),
      failures: [
        {
          specifier: "./knowledge-search.ts",
          message:
            "packages/query/src/knowledge-graph.ts imports or re-exports ./knowledge-search.ts; derived-knowledge graph loading must stay readable without routing back through the search owner surface.",
        },
      ],
      predicate: sourceMentionsSpecifier,
    },
  ];

  for (const check of sourceChecks) {
    const source = await readFile(check.path, "utf8");

    for (const failure of check.failures) {
      if (check.predicate(source, failure.specifier)) {
        failures.push(failure.message);
      }
    }
  }
}

async function verifyWorkspacePackageExportTargets(failures) {
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
    const isTestFile = isTestSourceFile(filePath);

    for (const specifier of extractModuleSpecifiers(source)) {
      const importPolicyFailure = verifyWorkspaceImportPolicy({
        filePath,
        source,
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

      if (
        isTestOnlyInternalAssistantSpecifier({
          isTestFile,
          packageName,
          specifier,
        })
      ) {
        continue;
      }

      const importsDeclaredPublicEntrypoint = allowedPatterns.some((pattern) => pattern.test(specifier));

      if (!importsDeclaredPublicEntrypoint) {
        failures.push(
          `${path.relative(repoRoot, filePath)} imports ${JSON.stringify(specifier)}, which is not a declared public workspace entrypoint for ${packageName}.`,
        );
        continue;
      }

      const dependencyDeclarationFailure = await verifyWorkspaceDependencyDeclaration({
        filePath,
        isTestFile,
        packageName,
        sourceMember,
        specifier,
      });

      if (dependencyDeclarationFailure) {
        failures.push(dependencyDeclarationFailure);
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

    const patterns = [];

    if (workspacePackageAllowsRootSpecifier(packageJson)) {
      patterns.push(new RegExp(`^${escapeRegExp(packageJson.name)}$`, "u"));
    }

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

async function verifyWorkspaceDependencyDeclaration({
  filePath,
  isTestFile,
  packageName,
  sourceMember,
  specifier,
}) {
  if (
    isTestFile
    || sourceMember === null
    || sourceMember.startsWith("e2e/")
  ) {
    return null;
  }

  const sourcePackageJson = await readWorkspaceMemberPackageJson(sourceMember);

  if (!sourcePackageJson || sourcePackageJson.name === packageName) {
    return null;
  }

  if (workspacePackageDeclaresDependency(sourcePackageJson, packageName)) {
    return null;
  }

  return `${path.relative(repoRoot, filePath)} imports ${JSON.stringify(specifier)}, but ${sourceMember}/package.json does not declare ${packageName} as a direct dependency. Add the direct workspace dependency so the package graph reflects the real owner boundary instead of relying on a transitive install.`;
}

async function readWorkspaceMemberPackageJson(workspaceMember) {
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

function workspacePackageDeclaresDependency(packageJson, dependencyName) {
  return [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.peerDependencies,
    packageJson.optionalDependencies,
  ].some((dependencies) =>
    Boolean(dependencies && typeof dependencies === "object" && dependencyName in dependencies)
  );
}

function verifyWorkspaceImportPolicy({
  filePath,
  source,
  sourceMember,
  specifier,
}) {
  const isTestFile = isTestSourceFile(filePath);

  if (specifier === "@murphai/device-syncd" && sourceMember !== "packages/device-syncd") {
    return `${path.relative(repoRoot, filePath)} imports ${JSON.stringify(specifier)} from the device-sync daemon root; internal workspace consumers must use @murphai/device-syncd/public-ingress, @murphai/device-syncd/client, or another explicit subpath so they do not depend on the daemon root convenience surface.`;
  }

  if (
    sourceMember === "packages/operator-config"
    && specifier === "@murphai/inboxd"
    && filePath.includes(`${path.sep}packages${path.sep}operator-config${path.sep}src${path.sep}`)
  ) {
    return `${path.relative(repoRoot, filePath)} imports ${JSON.stringify(specifier)} from the inboxd root; packages/operator-config/src must depend on @murphai/messaging-ingress or another focused inbox owner surface instead of the inbox daemon convenience barrel.`;
  }

  if (
    specifier.startsWith("@murphai/assistant-engine/assistant/")
    && !isTestFile
    && sourceMember !== "packages/assistant-engine"
  ) {
    return `${path.relative(repoRoot, filePath)} imports ${JSON.stringify(specifier)} from an assistant-engine internal assistant/* subpath; workspace consumers must use a dedicated top-level assistant-engine entrypoint instead of reaching through the package's internal assistant namespace.`;
  }

  if (
    sourceMember === "packages/assistant-runtime"
    && specifier === "@murphai/operator-config"
    && filePath.includes(
      `${path.sep}packages${path.sep}assistant-runtime${path.sep}src${path.sep}`,
    )
  ) {
    return `${path.relative(repoRoot, filePath)} imports ${JSON.stringify(specifier)} from the operator-config root; packages/assistant-runtime/src must stay on explicit @murphai/operator-config/* owner subpaths so hosted runtime seams cannot drift back to the umbrella config root.`;
  }

  if (
    (sourceMember === "packages/assistant-runtime" || sourceMember === "packages/assistantd")
    && specifier === "@murphai/vault-usecases"
    && filePath.includes(`${path.sep}src${path.sep}`)
  ) {
    return `${path.relative(repoRoot, filePath)} imports ${JSON.stringify(specifier)} from the vault-usecases root; headless assistant runtimes must depend on @murphai/vault-usecases/vault-services or @murphai/vault-usecases/runtime so they do not couple to CLI descriptor exports.`;
  }

  if (
    sourceMember === "apps/cloudflare"
    && (
      specifier === "@murphai/assistant-engine"
      || specifier.startsWith("@murphai/assistant-engine/")
      || specifier === "@murphai/operator-config"
      || specifier.startsWith("@murphai/operator-config/")
    )
    && filePath.includes(`${path.sep}apps${path.sep}cloudflare${path.sep}src${path.sep}`)
  ) {
    return `${path.relative(repoRoot, filePath)} imports ${JSON.stringify(specifier)} directly; apps/cloudflare must depend on @murphai/assistant-runtime or another hosted-runtime owner surface instead of lower local assistant owner packages.`;
  }

  if (
    specifier === "@murphai/importers"
    && sourceMember !== "packages/importers"
    && importsNamedBindingsFromSpecifier(source, specifier, [
      "GARMIN_DEVICE_PROVIDER_DESCRIPTOR",
      "OURA_DEVICE_PROVIDER_DESCRIPTOR",
      "WHOOP_DEVICE_PROVIDER_DESCRIPTOR",
      "defaultDeviceProviderDescriptors",
      "createNamedDeviceProviderRegistry",
      "resolveDeviceProviderDescriptor",
      "resolveDeviceProviderSourcePriority",
      "requireDeviceProviderOAuthDescriptor",
      "requireDeviceProviderSyncDescriptor",
      "requireDeviceProviderWebhookDescriptor",
      "DeviceProviderDescriptor",
      "DeviceProviderMetricFamily",
      "NamedDeviceProviderRegistry",
    ])
  ) {
    return `${path.relative(repoRoot, filePath)} imports provider-descriptor metadata from ${JSON.stringify(specifier)}; workspace consumers must use @murphai/importers/device-providers/provider-descriptors so they do not depend on the full device-provider barrel.`;
  }

  return null;
}

function isTestOnlyInternalAssistantSpecifier({
  isTestFile,
  packageName,
  specifier,
}) {
  if (!isTestFile) {
    return false;
  }

  return (
    (packageName === "@murphai/assistant-cli"
      && specifier.startsWith("@murphai/assistant-cli/assistant/"))
    || (
      packageName === "@murphai/assistant-engine"
      && (
        specifier.startsWith("@murphai/assistant-engine/assistant/")
        || specifier === "@murphai/assistant-engine/assistant-cli-access"
        || specifier === "@murphai/assistant-engine/assistant-cli-tools"
      )
    )
    || (
      packageName === "@murphai/inbox-services"
      && specifier === "@murphai/inbox-services/testing"
    )
    || (
      packageName === "@murphai/vault-usecases"
      && specifier === "@murphai/vault-usecases/testing"
    )
  );
}

function isTestSourceFile(filePath) {
  return /(?:^|[\\/])(test|tests)[\\/].*\.[cm]?[jt]sx?$|\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(
    path.relative(repoRoot, filePath),
  );
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

function sourceReexportsSpecifier(source, specifier) {
  return new RegExp(
    `^\\s*export\\s+(?:\\*|\\{[^}]+\\})\\s+from\\s+["']${escapeRegExp(specifier)}["']`,
    "mu",
  ).test(source);
}

function sourceMentionsSpecifier(source, specifier) {
  return extractModuleSpecifiers(source).includes(specifier);
}

function importsNamedBindingsFromSpecifier(source, specifier, bindingNames) {
  const bindingPattern = bindingNames
    .map((name) => escapeRegExp(name))
    .join("|");

  return new RegExp(
    String.raw`^\s*import\s+type\s*\{[^}]*\b(?:${bindingPattern})\b[^}]*\}\s+from\s+["']${escapeRegExp(specifier)}["']|^\s*import\s*\{[^}]*\b(?:${bindingPattern})\b[^}]*\}\s+from\s+["']${escapeRegExp(specifier)}["']`,
    "mu",
  ).test(source);
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
    name === ".deploy" ||
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
