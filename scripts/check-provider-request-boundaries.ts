import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { parse, type ParserPlugin } from "@babel/parser";
import traverseImport, { type NodePath } from "@babel/traverse";
import type {
  CallExpression,
  Expression,
  File,
  Node,
  OptionalCallExpression,
} from "@babel/types";

type Traverse = typeof import("@babel/traverse").default;
const traverseModule = traverseImport as unknown as Traverse | { default: Traverse };
const traverse: Traverse = (
  typeof traverseImport === "function"
    ? traverseModule as Traverse
    : (traverseModule as { default: Traverse }).default
);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

export const providerRequestScanRoots = ["apps", "packages", "scripts"] as const;
export const providerRequestSourceExtensions = [
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
] as const;

const sourceExtensions = new Set<string>(providerRequestSourceExtensions);
const skippedDirectoryNames = new Set([
  ".next",
  ".next-dev",
  ".next-smoke",
  ".deploy",
  "__tests__",
  "build",
  "coverage",
  "dist",
  "e2e",
  "fixtures",
  "generated",
  "node_modules",
  "out",
  "test",
  "tests",
]);

type RegisteredProviderRawHttpPolicy =
  | "allow-no-verified-sdk"
  | "require-official-sdk";

interface RegisteredProviderBoundary {
  readonly hosts: readonly string[];
  readonly id: string;
  readonly identifiers: readonly string[];
  readonly label: string;
  readonly rawHttpPolicy: RegisteredProviderRawHttpPolicy;
  readonly sdkModules: readonly string[];
}

export const providerBoundaryRegistry = Object.freeze([
  {
    hosts: ["backend.composio.dev"],
    id: "composio",
    identifiers: ["composio"],
    label: "Composio",
    rawHttpPolicy: "require-official-sdk",
    sdkModules: ["@composio/client"],
  },
  {
    hosts: [
      "api.us.junction.com",
      "api.eu.junction.com",
      "api.sandbox.us.junction.com",
      "api.sandbox.eu.junction.com",
    ],
    id: "junction",
    identifiers: ["junction"],
    label: "Junction",
    rawHttpPolicy: "require-official-sdk",
    sdkModules: ["@junction-api/sdk"],
  },
  {
    hosts: ["api.linqapp.com"],
    id: "linq",
    identifiers: ["linq"],
    label: "Linq",
    rawHttpPolicy: "require-official-sdk",
    sdkModules: ["@linqapp/sdk"],
  },
  {
    hosts: [],
    id: "kernel",
    identifiers: ["kernel"],
    label: "Kernel",
    rawHttpPolicy: "require-official-sdk",
    sdkModules: ["@onkernel/sdk"],
  },
  {
    hosts: [],
    id: "temporal",
    identifiers: ["temporal"],
    label: "Temporal",
    rawHttpPolicy: "require-official-sdk",
    sdkModules: ["@temporalio/client"],
  },
  {
    hosts: ["api.openai.com"],
    id: "openai",
    identifiers: ["openai", "open-ai"],
    label: "OpenAI",
    rawHttpPolicy: "require-official-sdk",
    sdkModules: ["openai"],
  },
  {
    hosts: ["api.retellai.com"],
    id: "retell",
    identifiers: ["retell"],
    label: "Retell",
    rawHttpPolicy: "require-official-sdk",
    sdkModules: ["retell-sdk"],
  },
  {
    hosts: ["api.stripe.com"],
    id: "stripe",
    identifiers: ["stripe"],
    label: "Stripe",
    rawHttpPolicy: "require-official-sdk",
    sdkModules: ["stripe"],
  },
  {
    hosts: ["api.agentmail.to"],
    id: "agentmail",
    identifiers: ["agentmail", "agent-mail"],
    label: "AgentMail",
    rawHttpPolicy: "require-official-sdk",
    sdkModules: ["agentmail"],
  },
  {
    hosts: ["api.resend.com"],
    id: "resend",
    identifiers: ["resend"],
    label: "Resend",
    rawHttpPolicy: "require-official-sdk",
    sdkModules: ["resend"],
  },
  {
    hosts: ["api.elevenlabs.io"],
    id: "elevenlabs",
    identifiers: ["elevenlabs", "eleven-labs"],
    label: "ElevenLabs",
    rawHttpPolicy: "require-official-sdk",
    sdkModules: ["@elevenlabs/elevenlabs-js"],
  },
  {
    hosts: ["api.exa.ai"],
    id: "exa",
    identifiers: ["exa"],
    label: "Exa",
    rawHttpPolicy: "require-official-sdk",
    sdkModules: ["exa-js"],
  },
  {
    hosts: ["api.lob.com"],
    id: "lob",
    identifiers: ["lob"],
    label: "Lob",
    rawHttpPolicy: "require-official-sdk",
    sdkModules: ["@lob/lob-typescript-sdk"],
  },
  {
    hosts: ["cloudkms.googleapis.com"],
    id: "google-cloud-kms",
    identifiers: ["cloudkms", "cloud-kms", "gcp-kms"],
    label: "Google Cloud KMS",
    rawHttpPolicy: "require-official-sdk",
    sdkModules: ["@google-cloud/kms"],
  },
  {
    hosts: ["sts.googleapis.com"],
    id: "google-sts",
    identifiers: ["gcp-sts", "google-sts"],
    label: "Google STS",
    rawHttpPolicy: "require-official-sdk",
    sdkModules: ["google-auth-library"],
  },
  {
    hosts: ["iamcredentials.googleapis.com"],
    id: "google-iam-credentials",
    identifiers: ["iamcredentials", "iam-credentials"],
    label: "Google IAM Credentials",
    rawHttpPolicy: "require-official-sdk",
    sdkModules: ["@google-cloud/iam-credentials"],
  },
  {
    hosts: ["api.x.ai"],
    id: "xai",
    identifiers: ["xai", "x-ai"],
    label: "xAI",
    rawHttpPolicy: "require-official-sdk",
    sdkModules: [],
  },
  {
    hosts: ["api.telegram.org"],
    id: "telegram",
    identifiers: ["telegram"],
    label: "Telegram",
    rawHttpPolicy: "allow-no-verified-sdk",
    sdkModules: [],
  },
  {
    hosts: ["api.ouraring.com"],
    id: "oura",
    identifiers: ["oura"],
    label: "Oura",
    rawHttpPolicy: "allow-no-verified-sdk",
    sdkModules: [],
  },
  {
    hosts: ["api.prod.whoop.com"],
    id: "whoop",
    identifiers: ["whoop"],
    label: "Whoop",
    rawHttpPolicy: "allow-no-verified-sdk",
    sdkModules: [],
  },
  {
    hosts: ["www.strava.com"],
    id: "strava",
    identifiers: ["strava"],
    label: "Strava",
    rawHttpPolicy: "allow-no-verified-sdk",
    sdkModules: [],
  },
] satisfies readonly RegisteredProviderBoundary[]);

type ApprovedRawHttpOwnerReason =
  | "existing-provider-boundary"
  | "official-sdk-fetch-hook"
  | "presigned-byte-transfer"
  | "provider-sdk-override"
  | "xai-x-search";

interface ApprovedRawHttpOwner {
  readonly ownerName: string;
  readonly providerIds: readonly string[];
  readonly reason: ApprovedRawHttpOwnerReason;
  readonly relativePath: string;
  readonly requiredRuntimeModule?: string;
}

// This is the policy surface. Production code owns request validation; the
// guard owns only where a raw transport capability may exist.
export const approvedProviderRawHttpOwners = Object.freeze([
  {
    ownerName: "fetchHostedLinqAttachmentDownloadUrl",
    providerIds: ["linq"],
    reason: "existing-provider-boundary",
    relativePath: "packages/assistant-runtime/src/hosted-runtime/events/linq.ts",
  },
  {
    ownerName: "hostedLocalFetch",
    providerIds: ["linq"],
    reason: "existing-provider-boundary",
    relativePath: "packages/hosted-local-harness/src/dev-hosted-local/linq-webhook-tunnel.ts",
  },
  {
    ownerName: "fetchLinqWebhookSubscriptions",
    providerIds: ["linq"],
    reason: "existing-provider-boundary",
    relativePath: "packages/hosted-local-harness/src/dev-hosted-local/linq-webhook-tunnel.ts",
  },
  {
    ownerName: "resolveDefaultLinqFetch",
    providerIds: ["linq"],
    reason: "official-sdk-fetch-hook",
    relativePath: "packages/operator-config/src/linq-runtime.ts",
    requiredRuntimeModule: "@linqapp/sdk",
  },
  {
    ownerName: "putHostedContainerDirectR2SmokePayload",
    providerIds: [],
    reason: "presigned-byte-transfer",
    relativePath: "apps/cloudflare/src/container-entrypoint.ts",
  },
  {
    ownerName: "fetchMurphHostedLinqContactCardVcfPhoto",
    providerIds: ["linq"],
    reason: "presigned-byte-transfer",
    relativePath: "apps/web/src/lib/hosted-onboarding/linq-contact-card.ts",
  },
  {
    ownerName: "sendHostedLinqAttachmentMessage",
    providerIds: ["linq"],
    reason: "presigned-byte-transfer",
    relativePath: "apps/web/src/lib/hosted-onboarding/linq-client.ts",
  },
  {
    ownerName: "uploadLinqAttachmentBytes",
    providerIds: ["linq"],
    reason: "presigned-byte-transfer",
    relativePath: "packages/operator-config/src/linq-runtime.ts",
  },
  {
    ownerName: "downloadHostedLinqAttachmentBytes",
    providerIds: ["linq"],
    reason: "presigned-byte-transfer",
    relativePath: "packages/assistant-runtime/src/hosted-runtime/events/linq.ts",
  },
  {
    ownerName: "executeAskGrokTool",
    providerIds: ["xai"],
    reason: "xai-x-search",
    relativePath: "packages/assistant-engine/src/assistant-codex/ask-grok-tool.ts",
  },
  {
    ownerName: "createOperatorLinqFetch",
    providerIds: ["linq"],
    reason: "official-sdk-fetch-hook",
    relativePath: "apps/cloudflare/src/operator-alert/linq.ts",
    requiredRuntimeModule: "@linqapp/sdk",
  },
  {
    ownerName: "createBoundedComposioFetch",
    providerIds: ["composio"],
    reason: "official-sdk-fetch-hook",
    relativePath: "apps/web/src/lib/connected-apps/composio.ts",
    requiredRuntimeModule: "@composio/client",
  },
  {
    ownerName: "createHostedLinqFirstContactAdmissionOpenAiFetch",
    providerIds: ["openai"],
    reason: "official-sdk-fetch-hook",
    relativePath: "apps/web/src/lib/hosted-onboarding/linq-first-contact-admission.ts",
    requiredRuntimeModule: "openai",
  },
  {
    ownerName: "requestJunctionResource",
    providerIds: ["junction"],
    reason: "official-sdk-fetch-hook",
    relativePath: "apps/web/src/lib/labs/junction.ts",
    requiredRuntimeModule: "@junction-api/sdk",
  },
  {
    ownerName: "createBoundedLinqApiFetch",
    providerIds: ["linq"],
    reason: "official-sdk-fetch-hook",
    relativePath: "apps/web/src/lib/linq/api.ts",
    requiredRuntimeModule: "@linqapp/sdk",
  },
  {
    ownerName: "createLobFetchAdapter",
    providerIds: ["lob"],
    reason: "official-sdk-fetch-hook",
    relativePath: "apps/web/src/lib/physical-notes/lob-runtime.ts",
    requiredRuntimeModule: "@lob/lob-typescript-sdk",
  },
  {
    ownerName: "createTelegramElevenLabsFetchAdapter",
    providerIds: ["elevenlabs"],
    reason: "official-sdk-fetch-hook",
    relativePath: "packages/assistant-engine/src/assistant/channels/runtime.ts",
    requiredRuntimeModule: "@murphai/operator-config/elevenlabs-runtime",
  },
  {
    ownerName: "createOpenAiImageSdkFetch",
    providerIds: ["openai"],
    reason: "official-sdk-fetch-hook",
    relativePath: "packages/assistant-engine/src/assistant-codex/openai-image-generation.ts",
    requiredRuntimeModule: "openai",
  },
  {
    ownerName: "requestSdkResource",
    providerIds: ["junction"],
    reason: "official-sdk-fetch-hook",
    relativePath: "packages/device-syncd/src/providers/junction-client.ts",
    requiredRuntimeModule: "@junction-api/sdk/activity",
  },
  {
    ownerName: "createElevenLabsSdkFetch",
    providerIds: ["elevenlabs"],
    reason: "official-sdk-fetch-hook",
    relativePath: "packages/operator-config/src/elevenlabs-runtime.ts",
    requiredRuntimeModule: "@elevenlabs/elevenlabs-js",
  },
  {
    ownerName: "createLinqSdkFetch",
    providerIds: ["linq"],
    reason: "official-sdk-fetch-hook",
    relativePath: "packages/operator-config/src/linq-runtime.ts",
    requiredRuntimeModule: "@linqapp/sdk",
  },
  {
    ownerName: "fetchRequest",
    providerIds: ["resend"],
    reason: "provider-sdk-override",
    relativePath: "apps/web/src/lib/hosted-onboarding/resend-plain-text-email.ts",
    requiredRuntimeModule: "resend",
  },
  {
    ownerName: "request",
    providerIds: ["exa"],
    reason: "provider-sdk-override",
    relativePath: "packages/cli/src/research-scout-client.ts",
    requiredRuntimeModule: "exa-js",
  },
  {
    ownerName: "fetchAuthorizedProviderUpstream",
    providerIds: ["elevenlabs", "exa", "linq", "openai", "xai"],
    reason: "existing-provider-boundary",
    relativePath: "apps/cloudflare/src/runner-egress-intercept.ts",
  },
  {
    ownerName: "requestLinqApi",
    providerIds: ["linq"],
    reason: "existing-provider-boundary",
    relativePath: "scripts/linq-typing-repro.ts",
  },
  {
    ownerName: "resolveJunctionUser",
    providerIds: ["junction"],
    reason: "existing-provider-boundary",
    relativePath: "scripts/native-ios-hosted-e2e-identity.mjs",
  },
  {
    ownerName: "deleteJunctionUser",
    providerIds: ["junction"],
    reason: "existing-provider-boundary",
    relativePath: "scripts/native-ios-hosted-e2e-identity.mjs",
  },
] satisfies readonly ApprovedRawHttpOwner[]);

type ProviderRequestBoundaryViolationKind =
  | "approved-owner-overflow"
  | "invalid-approved-owner"
  | "raw-provider-http";

export interface ProviderRequestBoundaryViolation {
  readonly boundary: string;
  readonly column: number;
  readonly filePath: string;
  readonly kind: ProviderRequestBoundaryViolationKind;
  readonly line: number;
}

interface RawTransportCall {
  readonly urlPath: NodePath<Node> | null;
}

const lowLevelTransportModules = new Set([
  "cross-fetch",
  "http",
  "https",
  "node-fetch",
  "node:http",
  "node:https",
  "undici",
]);
const lowLevelTransportMethods = new Set(["fetch", "get", "request"]);
const transparentExpressionTypes = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSInstantiationExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TypeCastExpression",
]);
const potentialRawTransportPattern = String.raw`\bfetch(?:Impl|Implementation)?\b|["'](?:node:)?https?["']|["'](?:cross-fetch|node-fetch|undici)["']`;
const potentialRawTransportRegex = new RegExp(potentialRawTransportPattern, "u");

export async function collectProviderRequestBoundaryViolations(): Promise<
  ProviderRequestBoundaryViolation[]
> {
  const sourceFiles: string[] = [];
  sourceFiles.push(...await listProviderRequestSourceFiles());
  const violations = await mapWithConcurrency(sourceFiles, 16, async (relativePath) => {
    let contents: string;
    try {
      contents = await readFile(path.join(repoRoot, relativePath), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
    return findProviderRequestBoundaryViolations(relativePath, contents);
  });
  return violations.flat().sort(compareViolations);
}

export function findProviderRequestBoundaryViolations(
  relativePath: string,
  contents: string,
): ProviderRequestBoundaryViolation[] {
  if (!containsPotentialRawTransport(contents)) {
    return [];
  }

  const normalizedPath = normalizeRepoPath(relativePath);
  const sourceFile = parse(contents, {
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    allowUndeclaredExports: true,
    attachComment: false,
    plugins: parserPlugins(normalizedPath),
    sourceFilename: normalizedPath,
    sourceType: "unambiguous",
  });
  const runtimeModules = collectRuntimeModules(sourceFile);
  const importedProviderIds = collectImportedProviderIds(runtimeModules);
  const approvalCounts = new Map<ApprovedRawHttpOwner, number>();
  const violations = new Map<string, ProviderRequestBoundaryViolation>();

  traverse(sourceFile, {
    CallExpression(callPath) {
      inspectCall(callPath);
    },
    OptionalCallExpression(callPath) {
      inspectCall(callPath);
    },
  });

  return [...violations.values()].sort(compareViolations);

  function inspectCall(
    callPath: NodePath<CallExpression | OptionalCallExpression>,
  ): void {
    const rawCall = readRawTransportCall(callPath, contents);
    if (!rawCall || isStaticSameOrigin(rawCall.urlPath, new Set())) {
      return;
    }

    const ownerNames = readCallableNames(callPath);
    const ownerName = ownerNames[0] ?? "<module>";
    const approval = approvedProviderRawHttpOwners.find(
      (candidate) =>
        candidate.relativePath === normalizedPath &&
        ownerNames.includes(candidate.ownerName),
    );
    const providerIds = collectCallProviderIds({
      callPath,
      contents,
      importedProviderIds,
      ownerName,
      relativePath: normalizedPath,
      urlPath: rawCall.urlPath,
    });
    const requiredProviderIds = providerIds.filter(
      (providerId) => providerById(providerId)?.rawHttpPolicy === "require-official-sdk",
    );

    if (approval) {
      const count = (approvalCounts.get(approval) ?? 0) + 1;
      approvalCounts.set(approval, count);
      if (count > 1) {
        recordViolation({
          boundary: `${approval.reason} owner ${ownerName}`,
          kind: "approved-owner-overflow",
          node: callPath.node,
        });
        return;
      }
      if (
        approval.requiredRuntimeModule &&
        !hasRuntimeModule(runtimeModules, approval.requiredRuntimeModule)
      ) {
        recordViolation({
          boundary: `${approval.reason} owner ${ownerName}`,
          kind: "invalid-approved-owner",
          node: callPath.node,
        });
        return;
      }
    }

    const uncoveredProviderIds = requiredProviderIds.filter(
      (providerId) => !approval?.providerIds.includes(providerId),
    );
    if (uncoveredProviderIds.length === 0) {
      return;
    }
    const labels = uncoveredProviderIds
      .map((providerId) => providerById(providerId)?.label ?? providerId)
      .sort((left, right) => left.localeCompare(right));
    recordViolation({
      boundary: `Direct ${labels.join(" / ")} provider HTTP in ${ownerName}`,
      kind: "raw-provider-http",
      node: callPath.node,
    });
  }

  function recordViolation(input: {
    readonly boundary: string;
    readonly kind: ProviderRequestBoundaryViolationKind;
    readonly node: Node;
  }): void {
    const start = input.node.start ?? 0;
    const key = `${input.kind}:${start}`;
    if (violations.has(key)) {
      return;
    }
    const position = readLineAndColumn(contents, start);
    violations.set(key, {
      boundary: input.boundary,
      column: position.column,
      filePath: normalizedPath,
      kind: input.kind,
      line: position.line,
    });
  }
}

export async function main(): Promise<void> {
  const violations = await collectProviderRequestBoundaryViolations();
  if (violations.length === 0) {
    console.log("External provider raw HTTP is confined to registered owners.");
    return;
  }

  throw new Error([
    "Found external provider request boundary violations.",
    "Use the official SDK. If raw transport is unavoidable, isolate one call in an exact audited owner and register that owner here.",
    ...violations.map(
      (violation) =>
        `- ${violation.filePath}:${violation.line}:${violation.column} ${formatViolationKind(violation.kind)} at \`${violation.boundary}\``,
    ),
  ].join("\n"));
}

export function isProviderRequestGuardEntrypoint(
  entryPath: string | undefined,
  moduleUrl: string,
): boolean {
  if (!entryPath) {
    return false;
  }
  try {
    return path.resolve(entryPath) === path.resolve(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

function readRawTransportCall(
  callPath: NodePath<CallExpression | OptionalCallExpression>,
  contents: string,
): RawTransportCall | null {
  const calleePath = callPath.get("callee") as NodePath<Node>;
  if (!isLowLevelTransportExpression(calleePath, contents, new Set())) {
    return null;
  }
  const argumentsPaths = callPath.get("arguments") as NodePath<Node>[];
  const calleeName = readStaticMemberName(calleePath.node);
  if (calleeName === "bind") {
    return null;
  }
  const urlIndex = calleeName === "call" ? 1 : calleeName === "apply" ? -1 : 0;
  return {
    urlPath: urlIndex >= 0 ? argumentsPaths[urlIndex] ?? null : null,
  };
}

function isLowLevelTransportExpression(
  originalPath: NodePath<Node>,
  contents: string,
  resolvingBindings: Set<string>,
): boolean {
  const expressionPath = unwrapExpressionPath(originalPath);
  const node = expressionPath.node;

  if (expressionPath.isLogicalExpression()) {
    return isLowLevelTransportExpression(
      expressionPath.get("left") as NodePath<Node>,
      contents,
      resolvingBindings,
    ) || isLowLevelTransportExpression(
      expressionPath.get("right") as NodePath<Node>,
      contents,
      resolvingBindings,
    );
  }

  if (expressionPath.isConditionalExpression()) {
    return isLowLevelTransportExpression(
      expressionPath.get("consequent") as NodePath<Node>,
      contents,
      resolvingBindings,
    ) || isLowLevelTransportExpression(
      expressionPath.get("alternate") as NodePath<Node>,
      contents,
      resolvingBindings,
    );
  }

  if (expressionPath.isIdentifier()) {
    const name = expressionPath.node.name;
    const binding = expressionPath.scope.getBinding(name);
    if (!binding) {
      return name === "fetch";
    }
    const bindingKey = `${name}:${binding.identifier.start ?? 0}`;
    if (resolvingBindings.has(bindingKey)) {
      return false;
    }
    const nextResolving = new Set(resolvingBindings).add(bindingKey);
    if (binding.kind === "param") {
      return isFetchLikeName(name) || bindingHasFetchType(binding.path, contents);
    }
    if (binding.path.isImportSpecifier() || binding.path.isImportDefaultSpecifier()) {
      const declaration = binding.path.parentPath;
      if (!declaration?.isImportDeclaration()) {
        return false;
      }
      const moduleName = declaration.node.source.value;
      const importedName = binding.path.isImportSpecifier()
        ? readImportedName(binding.path.node.imported)
        : "default";
      return isCallableTransportImport(moduleName, importedName);
    }
    const declarator = binding.path.isVariableDeclarator()
      ? binding.path
      : binding.path.parentPath?.isVariableDeclarator()
        ? binding.path.parentPath
        : null;
    if (declarator) {
      const initPath = declarator.get("init") as NodePath<Node> | null;
      if (initPath?.node && isLowLevelTransportExpression(initPath, contents, nextResolving)) {
        return true;
      }
      const destructuredTransport = readDestructuredTransportBinding(
        declarator,
        name,
      );
      if (destructuredTransport) {
        return true;
      }
    }
    return binding.constantViolations.length > 0 && isFetchLikeName(name);
  }

  if (expressionPath.isMemberExpression() || expressionPath.isOptionalMemberExpression()) {
    const memberName = readStaticMemberName(node);
    const objectPath = expressionPath.get("object") as NodePath<Node>;
    if (memberName === "call" || memberName === "apply" || memberName === "bind") {
      return isLowLevelTransportExpression(objectPath, contents, resolvingBindings);
    }
    if (memberName && isFetchLikeName(memberName)) {
      return true;
    }
    if (memberName && lowLevelTransportMethods.has(memberName)) {
      return isTransportNamespace(objectPath, resolvingBindings);
    }
    return false;
  }

  if (expressionPath.isCallExpression() || expressionPath.isOptionalCallExpression()) {
    const innerCallee = expressionPath.get("callee") as NodePath<Node>;
    if (readLoaderModuleName(expressionPath.node)) {
      return true;
    }
    return readStaticMemberName(innerCallee.node) === "bind" &&
      isLowLevelTransportExpression(innerCallee, contents, resolvingBindings);
  }

  return false;
}

function isTransportNamespace(
  originalPath: NodePath<Node>,
  resolvingBindings: Set<string>,
): boolean {
  const expressionPath = unwrapExpressionPath(originalPath);
  if (expressionPath.isAwaitExpression()) {
    return isTransportNamespace(
      expressionPath.get("argument") as NodePath<Node>,
      resolvingBindings,
    );
  }
  if (expressionPath.isCallExpression() || expressionPath.isOptionalCallExpression()) {
    const moduleName = readLoaderModuleName(expressionPath.node);
    return moduleName !== null && lowLevelTransportModules.has(moduleName);
  }
  if (!expressionPath.isIdentifier()) {
    return false;
  }
  const binding = expressionPath.scope.getBinding(expressionPath.node.name);
  if (!binding) {
    return expressionPath.node.name === "http" || expressionPath.node.name === "https";
  }
  const bindingKey = `${expressionPath.node.name}:${binding.identifier.start ?? 0}`;
  if (resolvingBindings.has(bindingKey)) {
    return false;
  }
  const nextResolving = new Set(resolvingBindings).add(bindingKey);
  if (binding.path.isImportNamespaceSpecifier()) {
    const declaration = binding.path.parentPath;
    return Boolean(
      declaration?.isImportDeclaration() &&
      lowLevelTransportModules.has(declaration.node.source.value),
    );
  }
  if (binding.path.isTSImportEqualsDeclaration()) {
    const moduleReference = binding.path.node.moduleReference;
    return moduleReference.type === "TSExternalModuleReference" &&
      moduleReference.expression.type === "StringLiteral" &&
      lowLevelTransportModules.has(moduleReference.expression.value);
  }
  const declarator = binding.path.isVariableDeclarator()
    ? binding.path
    : binding.path.parentPath?.isVariableDeclarator()
      ? binding.path.parentPath
      : null;
  if (!declarator) {
    return false;
  }
  const initPath = declarator.get("init") as NodePath<Node> | null;
  return Boolean(
    initPath?.node && isTransportNamespace(initPath, nextResolving),
  );
}

function readDestructuredTransportBinding(
  declarator: NodePath<Node>,
  localName: string,
): boolean {
  if (!declarator.isVariableDeclarator() || declarator.node.id.type !== "ObjectPattern") {
    return false;
  }
  const initPath = declarator.get("init") as NodePath<Node> | null;
  if (!initPath?.node) {
    return false;
  }
  const moduleName = readLoaderModuleName(unwrapExpressionPath(initPath).node);
  const globalObject = readMemberPath(unwrapExpressionPath(initPath).node)?.join(".");
  for (const property of declarator.node.id.properties) {
    if (property.type !== "ObjectProperty") {
      continue;
    }
    const boundName = property.value.type === "Identifier"
      ? property.value.name
      : property.value.type === "AssignmentPattern" && property.value.left.type === "Identifier"
        ? property.value.left.name
        : null;
    if (boundName !== localName) {
      continue;
    }
    const importedName = property.key.type === "Identifier"
      ? property.key.name
      : property.key.type === "StringLiteral"
        ? property.key.value
        : null;
    return Boolean(
      importedName &&
      lowLevelTransportMethods.has(importedName) &&
      (
        (moduleName !== null && lowLevelTransportModules.has(moduleName)) ||
        globalObject === "globalThis"
      ),
    );
  }
  return false;
}

function collectRuntimeModules(sourceFile: File): Set<string> {
  const modules = new Set<string>();
  traverse(sourceFile, {
    ImportDeclaration(importPath) {
      if (importPath.node.importKind !== "type") {
        modules.add(importPath.node.source.value);
      }
    },
    TSImportEqualsDeclaration(importPath) {
      if (importPath.node.importKind === "type") {
        return;
      }
      const reference = importPath.node.moduleReference;
      if (
        reference.type === "TSExternalModuleReference" &&
        reference.expression.type === "StringLiteral"
      ) {
        modules.add(reference.expression.value);
      }
    },
    CallExpression(callPath) {
      const moduleName = readLoaderModuleName(callPath.node);
      if (moduleName) {
        modules.add(moduleName);
      }
    },
  });
  return modules;
}

function collectImportedProviderIds(runtimeModules: ReadonlySet<string>): Set<string> {
  const providerIds = new Set<string>();
  for (const provider of providerBoundaryRegistry) {
    if (
      provider.sdkModules.some((sdkModule) => hasRuntimeModule(runtimeModules, sdkModule))
    ) {
      providerIds.add(provider.id);
    }
  }
  return providerIds;
}

function collectCallProviderIds(input: {
  readonly callPath: NodePath<CallExpression | OptionalCallExpression>;
  readonly contents: string;
  readonly importedProviderIds: ReadonlySet<string>;
  readonly ownerName: string;
  readonly relativePath: string;
  readonly urlPath: NodePath<Node> | null;
}): string[] {
  const providerIds = new Set(input.importedProviderIds);
  const callText = readNodeText(input.callPath.node, input.contents);
  const urlText = input.urlPath
    ? readNodeText(input.urlPath.node, input.contents)
    : "";
  const pathFallback = input.importedProviderIds.size === 0 ? input.relativePath : "";
  const evidenceText = `${pathFallback} ${input.ownerName} ${callText} ${urlText}`;
  for (const provider of providerBoundaryRegistry) {
    if (
      provider.hosts.some((host) => callText.toLowerCase().includes(host)) ||
      provider.identifiers.some((identifier) =>
        containsNormalizedIdentifier(evidenceText, identifier)
      )
    ) {
      providerIds.add(provider.id);
    }
  }
  return [...providerIds].sort((left, right) => left.localeCompare(right));
}

function isStaticSameOrigin(
  originalPath: NodePath<Node> | null,
  resolvingBindings: Set<string>,
): boolean {
  if (!originalPath?.node) {
    return false;
  }
  const expressionPath = unwrapExpressionPath(originalPath);
  if (expressionPath.isStringLiteral()) {
    return isSingleSlashPath(expressionPath.node.value);
  }
  if (expressionPath.isTemplateLiteral()) {
    return expressionPath.node.expressions.length === 0 &&
      isSingleSlashPath(expressionPath.node.quasis[0]?.value.cooked ?? "");
  }
  if (expressionPath.isIdentifier()) {
    const binding = expressionPath.scope.getBinding(expressionPath.node.name);
    if (!binding) {
      return false;
    }
    const bindingKey = `${expressionPath.node.name}:${binding.identifier.start ?? 0}`;
    if (resolvingBindings.has(bindingKey)) {
      return false;
    }
    const declarator = binding.path.isVariableDeclarator()
      ? binding.path
      : binding.path.parentPath?.isVariableDeclarator()
        ? binding.path.parentPath
        : null;
    const initPath = declarator?.get("init") as NodePath<Node> | null;
    return Boolean(
      initPath?.node &&
      isStaticSameOrigin(
        initPath,
        new Set(resolvingBindings).add(bindingKey),
      ),
    );
  }
  if (!expressionPath.isNewExpression()) {
    return false;
  }
  const calleePath = readMemberPath(expressionPath.node.callee);
  const argumentPaths = expressionPath.get("arguments") as NodePath<Node>[];
  return calleePath?.join(".") === "URL" &&
    isStaticSameOrigin(argumentPaths[0] ?? null, resolvingBindings) &&
    readMemberPath(argumentPaths[1]?.node)?.join(".") === "location.origin";
}

function readCallableNames(pathInput: NodePath<Node>): string[] {
  const names: string[] = [];
  for (let current = pathInput.parentPath; current; current = current.parentPath) {
    if (!current.isFunction()) {
      continue;
    }
    const node = current.node;
    if ((node.type === "FunctionDeclaration" || node.type === "FunctionExpression") && node.id) {
      names.push(node.id.name);
      continue;
    }
    if (
      node.type === "ClassMethod" ||
      node.type === "ClassPrivateMethod" ||
      node.type === "ObjectMethod"
    ) {
      const name = readPropertyName(node.key);
      if (name) {
        names.push(name);
      }
      continue;
    }
    const parent = current.parentPath;
    if (parent?.isVariableDeclarator() && parent.node.id.type === "Identifier") {
      names.push(parent.node.id.name);
      continue;
    }
    if (parent?.isObjectProperty()) {
      const name = readPropertyName(parent.node.key);
      if (name) {
        names.push(name);
      }
    }
  }
  return names;
}

function unwrapExpressionPath(originalPath: NodePath<Node>): NodePath<Node> {
  let current = originalPath;
  while (transparentExpressionTypes.has(current.node.type)) {
    current = current.get("expression") as NodePath<Node>;
  }
  return current;
}

function readLoaderModuleName(node: Node): string | null {
  if (node.type === "AwaitExpression") {
    return readLoaderModuleName(node.argument);
  }
  if (node.type !== "CallExpression" && node.type !== "OptionalCallExpression") {
    return null;
  }
  const calleeIsLoader =
    (node.callee.type === "Identifier" && node.callee.name === "require") ||
    node.callee.type === "Import";
  const argument = node.arguments[0];
  return calleeIsLoader && argument?.type === "StringLiteral"
    ? argument.value
    : null;
}

function readMemberPath(node: Node | null | undefined): string[] | null {
  if (!node) {
    return null;
  }
  if (node.type === "Identifier") {
    return [node.name];
  }
  if (transparentExpressionTypes.has(node.type)) {
    return readMemberPath((node as Node & { expression: Node }).expression);
  }
  if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression") {
    return null;
  }
  const root = readMemberPath(node.object);
  const property = readStaticMemberName(node);
  return root && property ? [...root, property] : null;
}

function readStaticMemberName(node: Node): string | null {
  if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression") {
    return null;
  }
  if (!node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }
  if (node.computed && node.property.type === "StringLiteral") {
    return node.property.value;
  }
  return null;
}

function readImportedName(node: Node): string {
  return node.type === "Identifier" ? node.name : node.type === "StringLiteral" ? node.value : "";
}

function readPropertyName(node: Node): string | null {
  return node.type === "Identifier" || node.type === "PrivateName"
    ? node.type === "PrivateName"
      ? node.id.name
      : node.name
    : node.type === "StringLiteral"
      ? node.value
      : null;
}

function bindingHasFetchType(bindingPath: NodePath<Node>, contents: string): boolean {
  const text = readNodeText(bindingPath.node, contents);
  return /\btypeof\s+(?:globalThis\.)?fetch\b|\bPromise\s*<\s*Response\b/u.test(text);
}

function isCallableTransportImport(moduleName: string, importedName: string): boolean {
  if (!lowLevelTransportModules.has(moduleName)) {
    return false;
  }
  return importedName === "default" || lowLevelTransportMethods.has(importedName);
}

function isFetchLikeName(name: string): boolean {
  return /^fetch(?:Impl|Implementation)?$/iu.test(name);
}

function isSingleSlashPath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\");
}

function providerById(id: string): RegisteredProviderBoundary | undefined {
  return providerBoundaryRegistry.find((provider) => provider.id === id);
}

function hasRuntimeModule(modules: ReadonlySet<string>, expected: string): boolean {
  for (const moduleName of modules) {
    if (moduleName === expected || moduleName.startsWith(`${expected}/`)) {
      return true;
    }
  }
  return false;
}

function containsPotentialRawTransport(contents: string): boolean {
  return potentialRawTransportRegex.test(contents);
}

function containsNormalizedIdentifier(text: string, identifier: string): boolean {
  return containsNormalizedIdentifierInNormalizedText(
    normalizeIdentifierText(text),
    identifier,
  );
}

function containsNormalizedIdentifierInNormalizedText(
  normalizedText: string,
  identifier: string,
): boolean {
  const normalizedIdentifier = normalizeIdentifierText(identifier);
  return `-${normalizedText}-`.includes(`-${normalizedIdentifier}-`);
}

function normalizeIdentifierText(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

export async function listProviderRequestSourceFiles(): Promise<string[]> {
  const matches = await listPotentialRawTransportFiles();
  return [...new Set(matches)]
    .filter(Boolean)
    .map(normalizeRepoPath)
    .filter((relativePath) =>
      shouldScanProviderRequestSourceFile(relativePath) &&
      relativePath
        .split("/")
        .slice(0, -1)
        .every((segment) => !shouldSkipProviderRequestDirectory(segment))
    )
    .sort((left, right) => left.localeCompare(right));
}

async function listPotentialRawTransportFiles(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "rg",
      [
        "--files-with-matches",
        "--no-messages",
        "--glob",
        "*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}",
        potentialRawTransportPattern,
        "--",
        ...providerRequestScanRoots,
      ],
      { cwd: repoRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    return stdout.split("\n").filter(Boolean);
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) {
      return [];
    }
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const { stdout } = await execFileAsync(
    "git",
    ["grep", "-I", "-l", "-P", potentialRawTransportPattern, "--", ...providerRequestScanRoots],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout.split("\n").filter(Boolean);
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapValue: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        results[index] = await mapValue(values[index]!);
      }
    },
  ));
  return results;
}

function parserPlugins(relativePath: string): ParserPlugin[] {
  const plugins: ParserPlugin[] = [["decorators", { decoratorsBeforeExport: true }], "typescript"];
  if (/\.[jt]sx$/u.test(relativePath)) {
    plugins.push("jsx");
  }
  return plugins;
}

export function shouldScanProviderRequestSourceFile(relativePath: string): boolean {
  return !/\.d\.[cm]?ts$/u.test(relativePath) &&
    !/\.(?:gen|generated)\.[cm]?[jt]sx?$/u.test(relativePath) &&
    !/\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(relativePath) &&
    sourceExtensions.has(path.posix.extname(relativePath));
}

export function shouldSkipProviderRequestDirectory(name: string): boolean {
  return skippedDirectoryNames.has(name) || name.startsWith(".next");
}

function compareViolations(
  left: ProviderRequestBoundaryViolation,
  right: ProviderRequestBoundaryViolation,
): number {
  return left.filePath.localeCompare(right.filePath) ||
    left.line - right.line ||
    left.column - right.column ||
    left.kind.localeCompare(right.kind);
}

function formatViolationKind(kind: ProviderRequestBoundaryViolationKind): string {
  switch (kind) {
    case "approved-owner-overflow":
      return "contains more raw transport calls than its approval permits";
    case "invalid-approved-owner":
      return "lost its required runtime SDK import";
    case "raw-provider-http":
      return "uses raw provider HTTP";
  }
}

function readNodeText(node: Node, sourceText: string): string {
  return sourceText.slice(node.start ?? 0, node.end ?? 0);
}

function readLineAndColumn(
  sourceText: string,
  position: number,
): { readonly column: number; readonly line: number } {
  const prefix = sourceText.slice(0, position);
  const lineStart = prefix.lastIndexOf("\n") + 1;
  return {
    column: prefix.length - lineStart + 1,
    line: prefix.split("\n").length,
  };
}

function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/gu, "/");
}

if (isProviderRequestGuardEntrypoint(process.argv[1], import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
