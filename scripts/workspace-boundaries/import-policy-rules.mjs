import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  escapeRegExp,
  extractModuleSpecifiers,
  findFiles,
  findWorkspaceMember,
  isSiblingBuildArtifactPath,
  readWorkspaceMemberPackageJson,
  repoRoot,
  workspacePackageDeclaresDependency,
} from "./scanner.mjs";

export async function verifyTsconfigPathMappings(failures) {
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

        if (
          targetMember !== null
          && await specifierUsesUndeclaredRootAlias({
            specifier,
            targetMember,
          })
        ) {
          failures.push(
            `${path.relative(repoRoot, tsconfigPath)} maps ${specifier} to ${path.relative(repoRoot, resolvedTarget)}, but ${targetMember} does not export "."; keep source path mappings on its declared public subpaths instead of a root alias.`,
          );
        }

        const mapsSiblingSourceWildcard = specifierMapsSiblingSourceWildcard({
          configMember,
          resolvedTarget,
          specifier,
          target,
          targetMember,
        });

        if (tsconfigIsHostedWeb(tsconfigPath) && mapsSiblingSourceWildcard) {
          failures.push(
            `${path.relative(repoRoot, tsconfigPath)} maps ${specifier} to sibling source wildcard ${path.relative(repoRoot, resolvedTarget)}; hosted web must resolve workspace packages through package names or declared public subpath exports instead of broad src/* aliases.`,
          );
        }

        if (
          specifierMapsProtectedPublicSourceWildcard({
            specifier,
            mapsSiblingSourceWildcard,
            handledByHostedWeb: tsconfigIsHostedWeb(tsconfigPath) && mapsSiblingSourceWildcard,
          })
        ) {
          failures.push(
            `${path.relative(repoRoot, tsconfigPath)} maps ${specifier} to sibling source wildcard ${path.relative(repoRoot, resolvedTarget)}; contracts and runtime-state must resolve through declared public subpath exports instead of broad src/* aliases.`,
          );
        }
      }
    }
  }
}

export async function verifyWorkspaceImports(failures) {
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

async function specifierUsesUndeclaredRootAlias({
  specifier,
  targetMember,
}) {
  if (targetMember === null || specifier.includes("*")) {
    return false;
  }

  const packageJson = await readWorkspaceMemberPackageJson(targetMember);

  if (!packageJson || typeof packageJson.name !== "string") {
    return false;
  }

  return (
    specifier === packageJson.name
    && !workspacePackageAllowsRootSpecifier(packageJson)
  );
}

function tsconfigIsHostedWeb(tsconfigPath) {
  return path.relative(repoRoot, tsconfigPath).replace(/\\/g, "/") === "apps/web/tsconfig.json";
}

function specifierMapsSiblingSourceWildcard({
  configMember,
  resolvedTarget,
  specifier,
  target,
  targetMember,
}) {
  if (
    !specifier.includes("*")
    || !target.includes("*")
    || targetMember === null
    || targetMember === configMember
  ) {
    return false;
  }

  const relativeTarget = path.relative(repoRoot, resolvedTarget).replace(/\\/g, "/");
  return relativeTarget.startsWith(`${targetMember}/src/`);
}

function specifierMapsProtectedPublicSourceWildcard({
  handledByHostedWeb,
  mapsSiblingSourceWildcard,
  specifier,
}) {
  if (handledByHostedWeb || !mapsSiblingSourceWildcard) {
    return false;
  }

  return (
    specifier === "@murphai/contracts/*"
    || specifier === "@murphai/runtime-state/*"
  );
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

export function verifyWorkspaceImportPolicy({
  filePath,
  source,
  sourceMember,
  specifier,
}) {
  const isTestFile = isTestSourceFile(filePath);

  if (
    isWorkspacePackageSpecifier(specifier)
    && importsEmptyBindingsFromSpecifier(source, specifier)
  ) {
    return `${path.relative(repoRoot, filePath)} uses empty import ${JSON.stringify(specifier)}; remove the workspace package import or replace it with explicit bindings so package boundaries do not accumulate hidden side-effect edges.`;
  }

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
    sourceMember === "apps/cloudflare"
    && specifier === "@murphai/assistant-runtime"
    && importsNamedBindingsFromSpecifier(source, specifier, [
      "HostedEmailSendRequest",
      "HostedEmailSendTargetKind",
      "hostedEmailSendTargetKindValues",
      "parseHostedEmailSendRequest",
    ])
  ) {
    return `${path.relative(repoRoot, filePath)} imports hosted email transport codecs from ${JSON.stringify(specifier)}; Cloudflare transport code must use @murphai/assistant-runtime/hosted-email so the assistant-runtime root stays on the canonical hosted runtime surface.`;
  }

  if (
    (
      sourceMember === "packages/assistant-runtime"
      || sourceMember === "apps/cloudflare"
    )
    && specifier === "@murphai/hosted-execution"
    && importsNamedBindingsFromSpecifier(source, specifier, [
      "readHostedEmailCapabilities",
      "resolveHostedEmailSenderIdentity",
    ])
  ) {
    return `${path.relative(repoRoot, filePath)} imports hosted email helpers from ${JSON.stringify(specifier)}; use @murphai/hosted-execution/hosted-email so hosted email policy and sender identity stay on their focused owner surface.`;
  }

  if (
    (
      sourceMember === "packages/assistant-runtime"
      || sourceMember === "packages/cloudflare-hosted-control"
      || sourceMember === "apps/cloudflare"
      || sourceMember === "apps/web"
    )
    && specifier === "@murphai/hosted-execution"
    && importsNamedBindingsFromSpecifier(source, specifier, [
      "parseHostedExecutionCursorState",
      "parseHostedExecutionEvent",
      "parseHostedExecutionUserStatus",
      "parseHostedExecutionBundlePayload",
      "parseHostedExecutionBundleRef",
      "parseHostedExecutionRunnerRequest",
      "parseHostedExecutionRunnerResult",
      "parseHostedWakeAppendRequest",
      "parseHostedWakeAppendResponse",
      "parseHostedWakeExecutionPayload",
      "parseHostedWakeRecord",
    ])
  ) {
    return `${path.relative(repoRoot, filePath)} imports hosted execution parsers from ${JSON.stringify(specifier)}; use @murphai/hosted-execution/parsers so parse helpers stay on the dedicated parser surface instead of the hosted-execution root barrel.`;
  }

  if (
    (
      sourceMember === "packages/assistant-runtime"
      || sourceMember === "apps/cloudflare"
    )
    && specifier === "@murphai/hosted-execution"
    && importsNamedBindingsFromSpecifier(source, specifier, [
      "HostedAssistantDeliveryEffect",
      "HostedAssistantDeliveryRecord",
      "HostedAssistantDeliverySideEffect",
      "buildHostedAssistantDeliveryEffect",
      "buildHostedAssistantDeliveryFailedRecord",
      "buildHostedAssistantDeliveryPendingRecord",
      "buildHostedAssistantDeliverySendingRecord",
      "buildHostedAssistantDeliverySentRecord",
      "parseHostedAssistantDeliverySideEffect",
      "parseHostedAssistantDeliverySideEffects",
      "parseHostedAssistantDeliveryRecord",
      "sameHostedAssistantDeliveryAttempt",
      "sameHostedAssistantDeliveryFailure",
      "sameHostedAssistantDeliveryReceipt",
      "sameHostedAssistantDeliverySideEffectIdentity",
    ])
  ) {
    return `${path.relative(repoRoot, filePath)} imports hosted assistant delivery helpers from ${JSON.stringify(specifier)}; use @murphai/hosted-execution/side-effects so assistant delivery records stay on their dedicated owner surface.`;
  }

  if (
    (
      sourceMember === "apps/cloudflare"
      || sourceMember === "apps/web"
    )
    && specifier === "@murphai/hosted-execution"
    && importsNamedBindingsFromSpecifier(source, specifier, [
      "encodeHostedExecutionSignedRequestPayload",
      "readHostedExecutionSignatureHeaders",
    ])
  ) {
    return `${path.relative(repoRoot, filePath)} imports hosted execution callback-auth helpers from ${JSON.stringify(specifier)}; use @murphai/hosted-execution/auth so signed-request codecs stay on their dedicated auth surface.`;
  }

  if (
    (
      sourceMember === "apps/cloudflare"
      || sourceMember === "apps/web"
    )
    && specifier === "@murphai/hosted-execution"
    && importsNamedBindingsFromSpecifier(source, specifier, [
      "HOSTED_EXECUTION_NONCE_HEADER",
      "HOSTED_EXECUTION_SIGNATURE_HEADER",
      "HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER",
      "HOSTED_EXECUTION_TIMESTAMP_HEADER",
      "HOSTED_EXECUTION_USER_ID_HEADER",
    ])
  ) {
    return `${path.relative(repoRoot, filePath)} imports hosted execution callback-auth headers from ${JSON.stringify(specifier)}; use @murphai/hosted-execution/contracts so signed-request header names stay on the dedicated contract surface.`;
  }

  if (
    sourceMember === "packages/assistant-runtime"
    && filePath.includes(
      `${path.sep}packages${path.sep}assistant-runtime${path.sep}src${path.sep}`,
    )
    && isGenericInboxConnectorNormalizerSpecifier(specifier)
  ) {
    return `${path.relative(repoRoot, filePath)} imports ${JSON.stringify(specifier)} directly; packages/assistant-runtime must use @murphai/inboxd/connectors/hosted-conversation so hosted wake ingestion stays behind a hosted-specific inbox adapter instead of generic provider connector internals.`;
  }

  if (
    sourceMember === "packages/inbox-services"
    && specifier === "@murphai/inboxd"
    && filePath.includes(`${path.sep}src${path.sep}`)
    && importsNamedBindingsFromSpecifier(source, specifier, [
      "ConnectorRestartPolicy",
    ])
  ) {
    return `${path.relative(repoRoot, filePath)} imports ConnectorRestartPolicy from ${JSON.stringify(specifier)}; use @murphai/inboxd/runtime so inbox-services runtime composition stays off the inboxd root barrel for daemon restart-policy typing.`;
  }

  if (
    (
      sourceMember === "packages/cloudflare-hosted-control"
      || sourceMember === "apps/cloudflare"
      || sourceMember === "apps/web"
    )
    && specifier === "@murphai/hosted-execution"
    && importsNamedBindingsFromSpecifier(source, specifier, [
      "normalizeHostedExecutionBaseUrl",
    ])
  ) {
    return `${path.relative(repoRoot, filePath)} imports hosted execution base-url normalization from ${JSON.stringify(specifier)}; use @murphai/hosted-execution/env so env normalization stays on the dedicated env surface.`;
  }

  if (
    (
      sourceMember === "apps/cloudflare"
      || sourceMember === "apps/web"
    )
    && specifier === "@murphai/cloudflare-hosted-control"
    && importsNamedBindingsFromSpecifier(source, specifier, [
      "buildCloudflareHostedControlPendingUsageUsersPath",
      "buildCloudflareHostedControlUserPendingUsagePath",
      "buildCloudflareHostedControlUserRunPath",
      "buildCloudflareHostedControlUserStatusPath",
    ])
  ) {
    return `${path.relative(repoRoot, filePath)} imports Cloudflare hosted-control route helpers from ${JSON.stringify(specifier)}; use @murphai/cloudflare-hosted-control/routes so route ownership stays on the dedicated control-route surface.`;
  }

  if (
    (
      sourceMember === "apps/cloudflare"
      || sourceMember === "apps/web"
    )
    && specifier === "@murphai/cloudflare-hosted-control"
    && importsNamedBindingsFromSpecifier(source, specifier, [
      "CloudflareHostedManagedUserCryptoStatus",
      "CloudflareHostedUserEnvStatus",
      "CloudflareHostedUserEnvUpdate",
    ])
  ) {
    return `${path.relative(repoRoot, filePath)} imports Cloudflare hosted-control contract types from ${JSON.stringify(specifier)}; use @murphai/cloudflare-hosted-control/contracts so mutable control contracts stay on the dedicated contract surface.`;
  }

  if (
    sourceMember === "apps/cloudflare"
    && specifier === "@murphai/cloudflare-hosted-control"
    && importsNamedBindingsFromSpecifier(source, specifier, [
      "parseCloudflareHostedManagedUserCryptoStatus",
      "parseCloudflareHostedUserEnvStatus",
      "parseCloudflareHostedUserEnvUpdate",
    ])
  ) {
    return `${path.relative(repoRoot, filePath)} imports Cloudflare hosted-control parsers from ${JSON.stringify(specifier)}; use @murphai/cloudflare-hosted-control/parsers so parsing stays on the dedicated codec surface.`;
  }

  if (
    sourceMember === "apps/web"
    && specifier === "@murphai/cloudflare-hosted-control"
    && importsNamedBindingsFromSpecifier(source, specifier, [
      "CloudflareHostedControlClient",
      "createCloudflareHostedControlClient",
    ])
  ) {
    return `${path.relative(repoRoot, filePath)} imports the Cloudflare hosted-control client from ${JSON.stringify(specifier)}; use @murphai/cloudflare-hosted-control/client so requester logic stays on the dedicated client surface.`;
  }

  if (
    sourceMember === "apps/cloudflare"
    && specifier === "@murphai/hosted-execution"
    && importsNamedBindingsFromSpecifier(source, specifier, [
      "HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH",
    ])
  ) {
    return `${path.relative(repoRoot, filePath)} imports runner route constants from ${JSON.stringify(specifier)}; apps/cloudflare must use @murphai/hosted-execution/routes so runtime route construction stays on the focused route surface.`;
  }

  if (
    (sourceMember === "packages/assistant-runtime" || sourceMember === "packages/assistantd")
    && specifier === "@murphai/vault-usecases"
    && filePath.includes(`${path.sep}src${path.sep}`)
  ) {
    return `${path.relative(repoRoot, filePath)} imports ${JSON.stringify(specifier)} from the vault-usecases root; headless assistant runtimes must depend on @murphai/vault-usecases/vault-services or @murphai/vault-usecases/runtime so they do not couple to CLI descriptor exports.`;
  }

  if (
    specifier === "@murphai/runtime-state"
    && importsNamedBindingsFromSpecifier(source, specifier, [
      "isValidAssistantOpaqueId",
      "normalizeAssistantOpaqueId",
    ])
  ) {
    return `${path.relative(repoRoot, filePath)} imports assistant opaque id helpers from ${JSON.stringify(specifier)}; use @murphai/runtime-state/assistant-ids so the dedicated helper stays off the broad runtime-state root barrel.`;
  }

  if (
    specifier === "@murphai/query"
    && importsNamedBindingsFromSpecifier(source, specifier, [
      "ALL_QUERY_ENTITY_FAMILIES",
    ])
  ) {
    return `${path.relative(repoRoot, filePath)} imports query entity-family metadata from ${JSON.stringify(specifier)}; use @murphai/query/entity-families so the constant stays on its dedicated query-owned surface instead of the broad query root barrel.`;
  }

  if (
    specifier === "@murphai/vault-usecases/runtime"
    && importsNamedBindingsFromSpecifier(source, specifier, [
      "ALL_QUERY_ENTITY_FAMILIES",
    ])
  ) {
    return `${path.relative(repoRoot, filePath)} imports query entity-family metadata from ${JSON.stringify(specifier)}; import ALL_QUERY_ENTITY_FAMILIES from @murphai/query/entity-families so the constant stays on its query-owned surface instead of the vault-usecases runtime helper layer.`;
  }

  if (
    sourceMember === "apps/cloudflare"
    && (
      (
        (
          specifier === "@murphai/assistant-engine"
          || specifier.startsWith("@murphai/assistant-engine/")
        )
        && !isAllowedCloudflareAssistantEngineOwnerImport(source, specifier)
      )
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

function isGenericInboxConnectorNormalizerSpecifier(specifier) {
  return (
    specifier === "@murphai/inboxd/connectors/email/normalize-parsed"
    || specifier === "@murphai/inboxd/connectors/email/parsed"
    || specifier === "@murphai/inboxd/connectors/linq/normalize"
    || specifier === "@murphai/inboxd/connectors/telegram/normalize"
  );
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
    (packageName === "@murphai/assistant-engine"
      && (
        specifier.startsWith("@murphai/assistant-engine/assistant/")
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

function isWorkspacePackageSpecifier(specifier) {
  return specifier.startsWith("@murphai/");
}

function isAllowedCloudflareAssistantEngineOwnerImport(source, specifier) {
  return (
    specifier === "@murphai/assistant-engine/assistant-codex"
    && importsOnlyNamedBindingsFromSpecifier(source, specifier, [
      "snapshotExpectedHostedCodexRootProcess",
      "stopHostedWarmCodexAppServer",
    ])
  );
}

function importsEmptyBindingsFromSpecifier(source, specifier) {
  const optionalTrivia = String.raw`(?:\s|/\*[\s\S]*?\*/|//[^\n\r]*(?:\r?\n|$))*`;

  return new RegExp(
    String.raw`^${optionalTrivia}import${optionalTrivia}(?:type${optionalTrivia})?\{${optionalTrivia}\}${optionalTrivia}from${optionalTrivia}["']${escapeRegExp(specifier)}["']`,
    "mu",
  ).test(source);
}

function importsOnlyNamedBindingsFromSpecifier(source, specifier, allowedBindingNames) {
  const optionalTrivia = String.raw`(?:\s|/\*[\s\S]*?\*/|//[^\n\r]*(?:\r?\n|$))*`;
  const specifierPattern = escapeRegExp(specifier);

  if (new RegExp(
    String.raw`^${optionalTrivia}import${optionalTrivia}(?:type${optionalTrivia})?(?:[A-Za-z_$][\w$]*${optionalTrivia},${optionalTrivia})?\*${optionalTrivia}as${optionalTrivia}[A-Za-z_$][\w$]*${optionalTrivia}from${optionalTrivia}["']${specifierPattern}["']`,
    "mu",
  ).test(source)) {
    return false;
  }

  if (new RegExp(
    String.raw`^${optionalTrivia}import${optionalTrivia}(?:type${optionalTrivia})?[A-Za-z_$][\w$]*(?:${optionalTrivia},${optionalTrivia}\{[^}]*\})?${optionalTrivia}from${optionalTrivia}["']${specifierPattern}["']`,
    "mu",
  ).test(source)) {
    return false;
  }

  const allowed = new Set(allowedBindingNames);
  const namedImportPattern = new RegExp(
    String.raw`^${optionalTrivia}import${optionalTrivia}(?:type${optionalTrivia})?\{(?<bindings>[^}]*)\}${optionalTrivia}from${optionalTrivia}["']${specifierPattern}["']`,
    "gmu",
  );
  const matches = [...source.matchAll(namedImportPattern)];

  if (matches.length === 0) {
    return false;
  }

  return matches.every((match) => {
    const bindings = stripImportBindingComments(match.groups?.bindings ?? "")
      .split(",")
      .map((binding) => binding.trim())
      .filter(Boolean)
      .map((binding) => binding.split(/\s+as\s+/iu)[0]?.trim())
      .filter(Boolean);

    return (
      bindings.length > 0
      && bindings.every((binding) => allowed.has(binding))
    );
  });
}

function importsNamedBindingsFromSpecifier(source, specifier, bindingNames) {
  const bindingPattern = bindingNames
    .map((name) => escapeRegExp(name))
    .join("|");

  if (new RegExp(
    String.raw`^\s*import\s+type\s*\{[^}]*\b(?:${bindingPattern})\b[^}]*\}\s+from\s+["']${escapeRegExp(specifier)}["']|^\s*import\s*\{[^}]*\b(?:${bindingPattern})\b[^}]*\}\s+from\s+["']${escapeRegExp(specifier)}["']`,
    "mu",
  ).test(source)) {
    return true;
  }

  const importedAliases = [
    ...extractNamespaceImportAliasesFromSpecifier(source, specifier),
    ...extractDefaultImportAliasesFromSpecifier(source, specifier),
  ];

  return importedAliases.some((alias) =>
    (
      new RegExp(
        String.raw`\b${escapeRegExp(alias)}\s*\.\s*(?:${bindingPattern})\b`,
        "u",
      ).test(source)
      || new RegExp(
        String.raw`\{[^}]*\b(?:${bindingPattern})\b[^}]*\}\s*=\s*${escapeRegExp(alias)}\b`,
        "u",
      ).test(source)
    ),
  );
}

function stripImportBindingComments(value) {
  return value
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\/\/[^\n\r]*(?:\r?\n|$)/gu, "\n");
}

function extractNamespaceImportAliasesFromSpecifier(source, specifier) {
  const aliases = [];
  const pattern = new RegExp(
    String.raw`^\s*import\s+(?:type\s+)?\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']${escapeRegExp(specifier)}["']`,
    "gmu",
  );

  let match = pattern.exec(source);
  while (match !== null) {
    aliases.push(match[1]);
    match = pattern.exec(source);
  }

  return aliases;
}

function extractDefaultImportAliasesFromSpecifier(source, specifier) {
  const aliases = [];
  const pattern = new RegExp(
    String.raw`^\s*import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s*(?:,\s*(?:\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*))?\s+from\s+["']${escapeRegExp(specifier)}["']`,
    "gmu",
  );

  let match = pattern.exec(source);
  while (match !== null) {
    aliases.push(match[1]);
    match = pattern.exec(source);
  }

  return aliases;
}
