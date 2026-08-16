import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse, type ParserPlugin } from "@babel/parser";
import {
  isAssignmentExpression,
  isCallExpression,
  isClassProperty,
  isExpression,
  isFunction,
  isIdentifier,
  isImportDeclaration,
  isImportDefaultSpecifier,
  isImportNamespaceSpecifier,
  isImportSpecifier,
  isMemberExpression,
  isNewExpression,
  isNumericLiteral,
  isObjectExpression,
  isObjectProperty,
  isOptionalCallExpression,
  isOptionalMemberExpression,
  isReturnStatement,
  isSpreadElement,
  isStringLiteral,
  isTemplateLiteral,
  isTSTypeAliasDeclaration,
  isVariableDeclarator,
  traverseFast,
  VISITOR_KEYS,
  type CallExpression,
  type Expression,
  type Node,
  type OptionalCallExpression,
} from "@babel/types";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const providerRequestScanRoots = [
  "apps",
  "packages",
  "scripts",
] as const;

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
    identifiers: ["cloudkms", "cloud-kms", "gcp", "kms"],
    label: "Google Cloud KMS",
    rawHttpPolicy: "require-official-sdk",
    sdkModules: ["@google-cloud/kms"],
  },
  {
    hosts: ["sts.googleapis.com"],
    id: "google-sts",
    identifiers: ["gcp-sts", "sts"],
    label: "Google STS",
    rawHttpPolicy: "require-official-sdk",
    sdkModules: ["google-auth-library"],
  },
  {
    hosts: ["iamcredentials.googleapis.com"],
    id: "google-iam-credentials",
    identifiers: ["iam", "iamcredentials", "iam-credentials"],
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

export const providerHttpExceptionRegistry = Object.freeze([
  {
    description:
      "Opaque presigned upload/download byte transfer without provider credentials or provider endpoint synthesis.",
    id: "presigned-byte-transfer",
  },
  {
    description: "Internal or same-origin application HTTP traffic.",
    id: "internal-same-origin",
  },
  {
    description:
      "The path-scoped xAI Responses request carrying exactly one x_search extension.",
    id: "xai-x-search-responses",
  },
  {
    description:
      "A path-scoped official SDK transport adapter whose audited implementation and SDK wiring are pinned exactly.",
    id: "official-sdk-fetch-hook",
  },
  {
    description:
      "The path-scoped Resend fetchRequest override required because the official SDK has no fetch or AbortSignal option.",
    id: "resend-sdk-fetch-request-override",
  },
  {
    description:
      "The path-scoped Exa request override required because the official SDK has no fetch or AbortSignal option.",
    id: "exa-sdk-request-override",
  },
] as const);

const approvedPresignedTransferHeaderFactories = Object.freeze([
  {
    implementationSha256: "039cd93198c2d0d02895ab465d9a46fba4be4ed96c9d7addd450f6b85944c572",
    name: "parseHostedLinqAttachmentUploadHeaders",
    relativePath: "apps/web/src/lib/hosted-onboarding/linq-client.ts",
  },
  {
    implementationSha256: "9270f5a2ade489be7f0d818c28eda988a82a1babafff228cc9554d4f58d7c7ad",
    name: "normalizeLinqRequiredHeaders",
    relativePath: "packages/operator-config/src/linq-runtime.ts",
  },
] as const);
const approvedPresignedTransferUrlOwners = Object.freeze([
  {
    implementationSha256: "df89ecf4a04b585a6d17cafbac5445b5654d57a05c344591d27074a06a13145f",
    names: ["presignedPutUrl", "url"],
    ownerName: "putHostedContainerDirectR2SmokePayload",
    relativePath: "apps/cloudflare/src/container-entrypoint.ts",
  },
  {
    implementationSha256: "c9f0c881712a8b5e6ec7b4d79943357bcbd23df8e4608baa4ffc681084d4f58c",
    names: ["imageUrl"],
    ownerName: "fetchMurphHostedLinqContactCardVcfPhoto",
    relativePath: "apps/web/src/lib/hosted-onboarding/linq-contact-card.ts",
  },
  {
    implementationSha256: "8bbe9ad24d1650ec713d9d85251d6a282e174eda708a7cb98aac485d3e40f368",
    names: ["uploadUrl"],
    ownerName: "sendHostedLinqAttachmentMessage",
    relativePath: "apps/web/src/lib/hosted-onboarding/linq-client.ts",
  },
  {
    implementationSha256: "516432d2137d65ceb2130c7ff898b9336c7697688226b24171371857945c35b1",
    names: ["uploadUrl"],
    ownerName: "uploadLinqAttachmentBytes",
    relativePath: "packages/operator-config/src/linq-runtime.ts",
    urlFactoryImplementationSha256:
      "622f955de784fa29b35a8c2b028b0205b8e7274dac4c1f827fb185cde3266d29",
    urlFactoryName: "normalizeLinqAttachmentUploadUrl",
  },
  {
    implementationSha256: "441cacf90f7446d1006cc6b17e9c0e5a1d59bda6cffe230f63af70b2c60bd1d0",
    names: ["url"],
    ownerName: "downloadHostedLinqAttachmentBytes",
    relativePath: "packages/assistant-runtime/src/hosted-runtime/events/linq.ts",
  },
] as const);

const safeLiteralTransferHeaderNames = new Set([
  "content-length",
  "content-type",
  "if-none-match",
  "x-upload-token",
]);
const binaryTransferConstructorNames = new Set([
  "ArrayBuffer",
  "Blob",
  "DataView",
  "ReadableStream",
  "Uint8Array",
]);

const providerModulePrefixes = providerBoundaryRegistry.flatMap(
  (provider) => provider.sdkModules,
);
const providerSourceMarkers = providerModulePrefixes;
const providerClientFactoryNames = new Set([
  "requireHostedStripeApi",
]);
const providerRequestTypeNamePattern =
  /(?:ConnectionOptions|Create(?:Batch|Email)(?:Request)?Options|MediaPart|MessageContent|Params?(?:NonStreaming|Streaming)?|RequestOptions|TextPart)$/u;

type ProviderRequestBoundaryViolationKind =
  | "handwritten-provider-transport"
  | "object-assign"
  | "object-spread"
  | "raw-provider-http"
  | "untyped-request-object";

interface VariableBinding {
  readonly conditionallyExecuted: boolean;
  readonly defaultExpression: Expression | null;
  readonly definitive: boolean;
  readonly identifierStart: number;
  readonly initializer: Expression;
  readonly propertyPath: readonly string[] | null;
  readonly scopeEnd: number;
  readonly scopeStart: number;
  readonly start: number;
  readonly typeAnnotation: string | null;
  readonly writeScopeEnd: number;
  readonly writeScopeStart: number;
}

interface MemberBinding {
  readonly initializer: Expression | null;
  readonly start: number;
  readonly typeAnnotation: string | null;
}

interface ParameterBinding {
  readonly defaultExpression: Expression | null;
  readonly name: string;
  readonly ownerName: string | null;
  readonly propertyPath: readonly string[] | null;
  readonly scopeEnd: number;
  readonly scopeStart: number;
  readonly typeAnnotation: string | null;
}

interface ProviderHttpSourceAnalysis {
  readonly contents: string;
  readonly exactFetchTypeNames: ReadonlySet<string>;
  readonly fileFallbackProviderIds: ReadonlySet<string>;
  readonly fetchTypeNames: ReadonlySet<string>;
  readonly fileProviderIds: ReadonlySet<string>;
  readonly functionBindings: ReadonlyMap<string, readonly FunctionBinding[]>;
  readonly memberBindings: ReadonlyMap<string, readonly MemberBinding[]>;
  readonly parameterBindings: ReadonlyMap<string, readonly ParameterBinding[]>;
  readonly sourceFile: Node;
  readonly transportBindings: ReadonlyMap<string, readonly TransportBinding[]>;
  readonly transportEvidenceProviderIds: ReadonlySet<string>;
}

interface ProviderExpressionFacts {
  readonly explicitProviderIds: Set<string>;
  readonly providerIds: Set<string>;
}

type ProviderCallParameterValues = ReadonlyMap<
  string,
  readonly ProviderCallParameterValue[]
>;

interface ProviderCallParameterValue {
  readonly before: number;
  readonly callParameterValues?: ProviderCallParameterValues;
  readonly node: Node;
  readonly projectionBefore: number;
  readonly projectionReferencePaths: readonly (readonly string[])[];
}

interface ProviderCallPropertyStep {
  readonly defaultExpression: Expression | null;
  readonly propertyName: string | null;
}

interface ParameterBindingEntry {
  readonly defaultExpression: Expression | null;
  readonly name: string;
  readonly propertyPath: readonly string[] | null;
  readonly propertySteps: readonly ProviderCallPropertyStep[];
}

interface TransportBinding {
  readonly initializer: Expression | null;
  readonly kind: "call" | "expression" | "namespace" | "shadow";
  readonly scopeEnd: number;
  readonly scopeStart: number;
  readonly start: number;
  readonly transport: HttpTransportModuleKind | null;
}

interface FunctionBinding {
  readonly node: Node;
  readonly scopeEnd: number;
  readonly scopeStart: number;
  readonly start: number;
}

interface LexicalScope {
  readonly end: number;
  readonly start: number;
}

interface ProviderSourceAnalysis {
  readonly clientNames: ReadonlySet<string>;
  readonly methodAliases: ReadonlyMap<string, string>;
  readonly requestTypeNames: ReadonlySet<string>;
  readonly typeRoots: ReadonlySet<string>;
}

export interface ProviderRequestBoundaryViolation {
  readonly boundary: string;
  readonly column: number;
  readonly filePath: string;
  readonly kind: ProviderRequestBoundaryViolationKind;
  readonly line: number;
}

export async function collectProviderRequestBoundaryViolations(): Promise<
  ProviderRequestBoundaryViolation[]
> {
  const violations: ProviderRequestBoundaryViolation[] = [];
  for (const root of providerRequestScanRoots) {
    await scanDirectory(root, violations);
  }
  return violations.sort(compareViolations);
}

export function findProviderRequestBoundaryViolations(
  relativePath: string,
  contents: string,
): ProviderRequestBoundaryViolation[] {
  const sourceFile = parse(contents, {
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    allowUndeclaredExports: true,
    attachComment: false,
    plugins: parserPlugins(relativePath),
    sourceFilename: relativePath,
    sourceType: "unambiguous",
  });
  const hasProviderSdkSourceMarker = containsProviderSourceMarker(contents);
  const analysis = hasProviderSdkSourceMarker
    ? analyzeProviderSource(sourceFile, contents)
    : emptyProviderSourceAnalysis();
  const bindings = collectVariableBindings(sourceFile, contents);
  const httpAnalysis = analyzeProviderHttpSource(
    sourceFile,
    relativePath,
    contents,
    bindings,
  );
  const violationsByKey = new Map<string, ProviderRequestBoundaryViolation>();

  if (hasProviderSdkSourceMarker) {
    traverseFast(sourceFile, (node) => {
      if (!isProviderRequestCall(node, analysis)) {
        return;
      }

      const boundary = readProviderBoundaryName(node, analysis, contents);
      for (const argument of node.arguments) {
        if (argument.type === "ArgumentPlaceholder") {
          continue;
        }
        collectUnsafeProviderRequestComposition({
          bindings,
          boundary,
          contents,
          node: argument,
          relativePath,
          resolvingBindings: new Set(),
          violationsByKey,
        });
        recordUntypedRequestObject({
          argument,
          bindings,
          boundary,
          contents,
          relativePath,
          violationsByKey,
        });
      }
    });

    traverseFast(sourceFile, (node) => {
      if (isFunction(node) && node.returnType) {
        const returnType = readNodeText(node.returnType, contents);
        if (isProviderRequestTypeText(returnType, analysis)) {
          const boundary = `Provider-typed request builder ${readFunctionName(node)}`;
          if (node.body.type !== "BlockStatement") {
            collectUnsafeProviderRequestComposition({
              bindings,
              boundary,
              contents,
              node: node.body,
              relativePath,
              resolvingBindings: new Set(),
              violationsByKey,
            });
            return;
          }
          traverseFast(node.body, (child) => {
            if (isFunction(child)) {
              return traverseFast.skip;
            }
            if (isReturnStatement(child) && child.argument) {
              collectUnsafeProviderRequestComposition({
                bindings,
                boundary,
                contents,
                node: child.argument,
                relativePath,
                resolvingBindings: new Set(),
                violationsByKey,
              });
            }
          });
        }
        return;
      }

      if (
        isVariableDeclarator(node) &&
        isIdentifier(node.id) &&
        node.id.typeAnnotation &&
        node.init &&
        isProviderRequestTypeText(
          readNodeText(node.id.typeAnnotation, contents),
          analysis,
        )
      ) {
        collectUnsafeProviderRequestComposition({
          bindings,
          boundary: `Provider-typed request object ${node.id.name}`,
          contents,
          node: node.init,
          relativePath,
          resolvingBindings: new Set(),
          violationsByKey,
        });
        return;
      }

      if (
        node.type === "TSSatisfiesExpression" &&
        isProviderRequestTypeText(readNodeText(node.typeAnnotation, contents), analysis)
      ) {
        collectUnsafeProviderRequestComposition({
          bindings,
          boundary: "Provider-typed satisfies expression",
          contents,
          node: node.expression,
          relativePath,
          resolvingBindings: new Set(),
          violationsByKey,
        });
      }
    });
  }

  collectRawProviderHttpViolations({
    analysis: httpAnalysis,
    bindings,
    contents,
    relativePath,
    sourceFile,
    violationsByKey,
  });
  collectHandwrittenProviderTransportViolations({
    analysis: httpAnalysis,
    contents,
    relativePath,
    sourceFile,
    violationsByKey,
  });

  return [...violationsByKey.values()].sort(compareViolations);
}

export async function main(): Promise<void> {
  const violations = await collectProviderRequestBoundaryViolations();
  if (violations.length === 0) {
    console.log("External provider request boundaries use registered official SDK contracts.");
    return;
  }

  throw new Error([
    "Found external provider request boundary violations.",
    "Use the registered official SDK client and SDK-owned request/response types. Keep SDK request objects explicit and assign optional fields individually.",
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

function analyzeProviderSource(sourceFile: Node, contents: string): ProviderSourceAnalysis {
  const clientNames = new Set<string>();
  const requestTypeNames = new Set<string>();
  const typeRoots = new Set<string>();

  traverseFast(sourceFile, (node) => {
    if (node.type === "TSImportEqualsDeclaration") {
      const moduleName = readImportEqualsModuleName(node);
      if (moduleName && isProviderModule(moduleName)) {
        typeRoots.add(node.id.name);
        if (node.importKind !== "type") {
          clientNames.add(node.id.name);
          clientNames.add(lowercaseInitial(node.id.name));
        }
      }
      return;
    }
    if (isVariableDeclarator(node) && node.init) {
      const requiredModule = readRequiredModuleName(unwrapExpression(node.init));
      if (requiredModule && isProviderModule(requiredModule)) {
        for (const localName of readBindingPatternNames(node.id)) {
          clientNames.add(localName);
          clientNames.add(lowercaseInitial(localName));
          typeRoots.add(localName);
        }
      }
      return;
    }
    if (!isImportDeclaration(node) || !isProviderModule(node.source.value)) {
      return;
    }
    for (const specifier of node.specifiers) {
      const localName = specifier.local.name;
      typeRoots.add(localName);
      if (
        isImportSpecifier(specifier) &&
        providerRequestTypeNamePattern.test(readImportedName(specifier))
      ) {
        requestTypeNames.add(localName);
      }
      const typeOnly = node.importKind === "type" ||
        (isImportSpecifier(specifier) && specifier.importKind === "type");
      if (
        !typeOnly &&
        (
          isImportDefaultSpecifier(specifier) ||
          isImportNamespaceSpecifier(specifier) ||
          isImportSpecifier(specifier)
        )
      ) {
        clientNames.add(localName);
        clientNames.add(lowercaseInitial(localName));
      }
    }
  });

  clientNames.add("stripe");
  typeRoots.add("Stripe");

  const typeAliases: Array<{ readonly name: string; readonly text: string }> = [];
  traverseFast(sourceFile, (node) => {
    if (isTSTypeAliasDeclaration(node)) {
      typeAliases.push({
        name: node.id.name,
        text: readNodeText(node.typeAnnotation, contents),
      });
    }
  });
  let aliasesChanged = true;
  while (aliasesChanged) {
    aliasesChanged = false;
    for (const alias of typeAliases) {
      if (
        !requestTypeNames.has(alias.name) &&
        isProviderRequestTypeText(alias.text, {
          requestTypeNames,
          typeRoots,
        })
      ) {
        requestTypeNames.add(alias.name);
        aliasesChanged = true;
      }
    }
  }

  traverseFast(sourceFile, (node) => {
    if (isVariableDeclarator(node) && isIdentifier(node.id)) {
      const declaredType = node.id.typeAnnotation
        ? readNodeText(node.id.typeAnnotation, contents)
        : "";
      const initializer = node.init ? readNodeText(node.init, contents) : "";
      if (
        typeTextIsProviderClient(declaredType, typeRoots) ||
        textReferencesProviderClient(initializer, clientNames)
      ) {
        clientNames.add(node.id.name);
      }
      return;
    }

    if (
      isClassProperty(node) &&
      isIdentifier(node.key) &&
      node.typeAnnotation &&
      typeTextIsProviderClient(
        readNodeText(node.typeAnnotation, contents),
        typeRoots,
      )
    ) {
      clientNames.add(node.key.name);
      return;
    }

    if (isFunction(node)) {
      for (const parameter of node.params) {
        if (
          isIdentifier(parameter) &&
          parameter.typeAnnotation &&
          typeTextIsProviderClient(
            readNodeText(parameter.typeAnnotation, contents),
            typeRoots,
          )
        ) {
          clientNames.add(parameter.name);
        }
      }
    }
  });

  const methodAliases = new Map<string, string>();
  traverseFast(sourceFile, (node) => {
    if (
      !isVariableDeclarator(node) ||
      !isIdentifier(node.id) ||
      !node.init ||
      (!isMemberExpression(node.init) && !isOptionalMemberExpression(node.init))
    ) {
      return;
    }
    const pathParts = readMemberPath(node.init);
    if (pathParts && isProviderMemberPath(pathParts, clientNames)) {
      methodAliases.set(node.id.name, readNodeText(node.init, contents));
    }
  });

  return {
    clientNames,
    methodAliases,
    requestTypeNames,
    typeRoots,
  };
}


function emptyProviderSourceAnalysis(): ProviderSourceAnalysis {
  return {
    clientNames: new Set(),
    methodAliases: new Map(),
    requestTypeNames: new Set(),
    typeRoots: new Set(),
  };
}

function analyzeProviderHttpSource(
  sourceFile: Node,
  relativePath: string,
  contents: string,
  variableBindings: ReadonlyMap<string, readonly VariableBinding[]>,
): ProviderHttpSourceAnalysis {
  return {
    contents,
    exactFetchTypeNames: collectFetchTypeNames(sourceFile, contents, true),
    fileFallbackProviderIds: collectFileProviderFallbackIds(
      sourceFile,
      relativePath,
    ),
    fetchTypeNames: collectFetchTypeNames(sourceFile, contents),
    fileProviderIds: collectFileProviderIds(sourceFile, relativePath),
    functionBindings: collectFunctionBindings(sourceFile),
    memberBindings: collectMemberBindings(sourceFile, contents),
    parameterBindings: collectParameterBindings(sourceFile, contents),
    sourceFile,
    transportBindings: collectHttpTransportBindings(
      sourceFile,
      variableBindings,
    ),
    transportEvidenceProviderIds: collectTransportEvidenceProviderIds(
      sourceFile,
      contents,
    ),
  };
}

function collectFetchTypeNames(
  sourceFile: Node,
  contents: string,
  exact = false,
): Set<string> {
  const fetchTypeAliases: Array<{
    readonly name: string;
    readonly typeText: string;
  }> = [];
  const fetchTypeNames = new Set<string>();

  traverseFast(sourceFile, (node) => {
    if (isTSTypeAliasDeclaration(node)) {
      fetchTypeAliases.push({
        name: node.id.name,
        typeText: readNodeText(node.typeAnnotation, contents),
      });
    }
  });

  let fetchTypesChanged = true;
  while (fetchTypesChanged) {
    fetchTypesChanged = false;
    for (const alias of fetchTypeAliases) {
      if (
        !fetchTypeNames.has(alias.name) &&
        (
          (exact
            ? looksLikeExactFetchFunctionType(alias.typeText)
            : looksLikeFetchFunctionType(alias.typeText)) ||
          looksLikeStandardFetchDerivedBivariantType(alias.typeText) ||
          typeTextIsFetchCallable(alias.typeText, fetchTypeNames)
        )
      ) {
        fetchTypeNames.add(alias.name);
        fetchTypesChanged = true;
      }
    }
  }

  return fetchTypeNames;
}

function collectHttpTransportBindings(
  sourceFile: Node,
  variableBindings: ReadonlyMap<string, readonly VariableBinding[]>,
): Map<string, TransportBinding[]> {
  const scopes = collectLexicalScopes(sourceFile);
  const bindings = new Map<string, TransportBinding[]>();

  const addBinding = (
    name: string,
    kind: TransportBinding["kind"],
    node: Node,
    transport: HttpTransportModuleKind | null,
    initializer: Expression | null = null,
    inheritedScope: Pick<TransportBinding, "scopeEnd" | "scopeStart"> | null = null,
  ): boolean => {
    let current = bindings.get(name) ?? [];
    const start = node.start ?? 0;
    if (kind !== "shadow") {
      const withoutSameDeclarationFallback = current.filter(
        (binding) =>
          binding.start !== start ||
          (
            binding.kind !== "shadow" &&
            (kind === "expression" || binding.kind !== "expression")
          ),
      );
      if (withoutSameDeclarationFallback.length !== current.length) {
        current = withoutSameDeclarationFallback;
        bindings.set(name, current);
      }
    }
    if (
      current.some((binding) =>
        binding.kind === kind &&
        binding.start === start &&
        binding.transport === transport &&
        binding.initializer === initializer
      )
    ) {
      return false;
    }
    const scope = inheritedScope
      ? { end: inheritedScope.scopeEnd, start: inheritedScope.scopeStart }
      : findInnermostLexicalScope(scopes, start);
    current.push({
      initializer,
      kind,
      scopeEnd: scope.end,
      scopeStart: scope.start,
      start,
      transport,
    });
    bindings.set(name, current);
    return true;
  };

  traverseFast(sourceFile, (node) => {
    if (node.type === "TSImportEqualsDeclaration") {
      const moduleName = readImportEqualsModuleName(node);
      const transport = moduleName
        ? classifyHttpTransportModule(moduleName)
        : null;
      if (transport && node.importKind !== "type") {
        addBinding(
          node.id.name,
          transport === "fetch-package" ? "call" : "namespace",
          node,
          transport,
        );
      } else {
        addBinding(node.id.name, "shadow", node, null);
      }
      return;
    }
    if (!isImportDeclaration(node)) {
      return;
    }
    const transport = classifyHttpTransportModule(node.source.value);
    if (!transport) {
      return;
    }
    for (const specifier of node.specifiers) {
      if (isImportNamespaceSpecifier(specifier)) {
        addBinding(specifier.local.name, "namespace", node, transport);
        continue;
      }
      if (isImportDefaultSpecifier(specifier)) {
        if (transport === "node-http") {
          addBinding(specifier.local.name, "namespace", node, transport);
        } else if (transport === "fetch-package") {
          addBinding(specifier.local.name, "call", node, transport);
        }
        continue;
      }
      if (!isImportSpecifier(specifier)) {
        continue;
      }
      const importedName = readImportedName(specifier);
      if (isHttpTransportMethod(transport, importedName)) {
        addBinding(specifier.local.name, "call", node, transport);
      }
    }
  });

  traverseFast(sourceFile, (node) => {
    if (isFunction(node)) {
      const functionScope = findInnermostLexicalScope(
        scopes,
        node.body.start ?? node.start ?? 0,
      );
      for (const parameter of node.params) {
        for (const entry of readParameterBindingEntries(parameter)) {
          addBinding(entry.name, "shadow", parameter, null, null, {
            scopeEnd: functionScope.end,
            scopeStart: functionScope.start,
          });
        }
      }
      return;
    }
    if (isImportDeclaration(node)) {
      for (const specifier of node.specifiers) {
        if (
          !hasTransportBindingAt(
            bindings,
            specifier.local.name,
            node.start ?? 0,
          )
        ) {
          addBinding(specifier.local.name, "shadow", node, null);
        }
      }
      return;
    }
    if (node.type === "TSImportEqualsDeclaration") {
      if (!hasTransportBindingAt(bindings, node.id.name, node.start ?? 0)) {
        addBinding(node.id.name, "shadow", node, null);
      }
      return;
    }
    if (node.type === "CatchClause" && node.param) {
      for (const name of readBindingPatternNames(node.param)) {
        addBinding(name, "shadow", node, null);
      }
      return;
    }
    if (
      (node.type === "ClassDeclaration" || node.type === "TSEnumDeclaration") &&
      node.id
    ) {
      addBinding(node.id.name, "shadow", node, null);
      return;
    }
    if (
      isAssignmentExpression(node) &&
      node.operator === "=" &&
      isIdentifier(node.left) &&
      isExpression(node.right)
    ) {
      const previous = resolveTransportBinding(
        bindings,
        node.left.name,
        node.start ?? 0,
      );
      addBinding(
        node.left.name,
        "expression",
        node,
        null,
        node.right,
        previous,
      );
      return;
    }
    if (!isVariableDeclarator(node)) {
      return;
    }
    for (const name of readBindingPatternNames(node.id)) {
      if (!hasTransportBindingAt(bindings, name, node.start ?? 0)) {
        addBinding(name, "shadow", node, null);
      }
    }
  });

  let changed = true;
  while (changed) {
    changed = false;
    traverseFast(sourceFile, (node) => {
      const destructuringTarget = isVariableDeclarator(node) &&
          node.init &&
          node.id.type === "ObjectPattern"
        ? { initializer: node.init, pattern: node.id }
        : isAssignmentExpression(node) &&
            node.operator === "=" &&
            node.left.type === "ObjectPattern"
          ? { initializer: node.right, pattern: node.left }
          : null;
      if (destructuringTarget) {
        const init = unwrapExpression(destructuringTarget.initializer);
        const staticModule = readStaticTransportModule(init);
        const directTransport = staticModule
          ? classifyHttpTransportModule(staticModule.moduleName)
          : null;
        const namespaceTransports = directTransport
          ? [directTransport]
          : readTransportNamespaceKinds(
            init,
            bindings,
            variableBindings,
            node.start ?? 0,
            sourceFile,
          );
        if (namespaceTransports.length === 0) {
          return;
        }
        for (const property of destructuringTarget.pattern.properties) {
          if (
            property.type === "RestElement" &&
            isIdentifier(property.argument)
          ) {
            for (const transport of namespaceTransports) {
              changed = addBinding(
                property.argument.name,
                "namespace",
                node,
                transport,
              ) || changed;
            }
            continue;
          }
          if (
            !isObjectProperty(property) ||
            (property.computed && !isStringLiteral(property.key))
          ) {
            continue;
          }
          const localIdentifier = isIdentifier(property.value)
            ? property.value
            : property.value.type === "AssignmentPattern" &&
                isIdentifier(property.value.left)
              ? property.value.left
              : null;
          if (!localIdentifier) {
            continue;
          }
          const importedName = readPropertyName(property.key);
          if (!importedName) {
            continue;
          }
          for (const transport of namespaceTransports) {
            if (!isHttpTransportMethod(transport, importedName)) {
              continue;
            }
            changed = addBinding(
              localIdentifier.name,
              "call",
              node,
              transport,
            ) || changed;
          }
        }
        return;
      }

      const target = isVariableDeclarator(node) && node.init &&
          isIdentifier(node.id)
        ? { inheritedScope: null, initializer: node.init, name: node.id.name }
        : isAssignmentExpression(node) &&
            node.operator === "=" &&
            isIdentifier(node.left) &&
            isExpression(node.right)
          ? {
            inheritedScope: resolveTransportBinding(
              bindings,
              node.left.name,
              node.start ?? 0,
            ),
            initializer: node.right,
            name: node.left.name,
          }
          : null;
      if (!target) {
        return;
      }
      const init = unwrapExpression(target.initializer);
      const staticModule = readStaticTransportModule(init);
      const directTransport = staticModule
        ? classifyHttpTransportModule(staticModule.moduleName)
        : null;

      if (directTransport) {
        changed = addBinding(
          target.name,
          directTransport === "fetch-package" &&
            staticModule?.source === "require"
            ? "call"
            : "namespace",
          node,
          directTransport,
          null,
          target.inheritedScope,
        ) || changed;
        return;
      }
      const namespaceTransports = readTransportNamespaceKinds(
        init,
        bindings,
        variableBindings,
        node.start ?? 0,
        sourceFile,
      );
      if (namespaceTransports.length > 0) {
        for (const transport of namespaceTransports) {
          changed = addBinding(
            target.name,
            "namespace",
            node,
            transport,
            null,
            target.inheritedScope,
          ) || changed;
        }
        return;
      }
      const memberTransports = readTransportMemberBindings(
        init,
        bindings,
        variableBindings,
        node.start ?? 0,
        sourceFile,
      );
      for (const transport of memberTransports) {
        changed = addBinding(
          target.name,
          "call",
          node,
          transport,
          null,
          target.inheritedScope,
        ) || changed;
      }
    });
  }

  return bindings;
}

function hasTransportBindingAt(
  bindings: ReadonlyMap<string, readonly TransportBinding[]>,
  name: string,
  start: number,
): boolean {
  return bindings.get(name)?.some((binding) => binding.start === start) ?? false;
}

function readBindingPatternNames(node: Node): string[] {
  if (isIdentifier(node)) {
    return [node.name];
  }
  if (node.type === "AssignmentPattern") {
    return readBindingPatternNames(node.left);
  }
  if (node.type === "RestElement") {
    return readBindingPatternNames(node.argument);
  }
  if (node.type === "ArrayPattern") {
    return node.elements.flatMap((element) =>
      element ? readBindingPatternNames(element) : []
    );
  }
  if (node.type === "ObjectPattern") {
    return node.properties.flatMap((property) =>
      property.type === "RestElement"
        ? readBindingPatternNames(property.argument)
        : isObjectProperty(property)
          ? readBindingPatternNames(property.value)
          : []
    );
  }
  return [];
}

function readParameterBindingEntries(
  node: Node,
  propertySteps: readonly ProviderCallPropertyStep[] = [],
  rootDefaultExpression: Expression | null = null,
): ParameterBindingEntry[] {
  if (node.type === "TSParameterProperty") {
    return readParameterBindingEntries(
      node.parameter,
      propertySteps,
      rootDefaultExpression,
    );
  }
  if (isIdentifier(node)) {
    const propertyDefaultExpression = propertySteps.at(-1)
      ?.defaultExpression ?? null;
    const propertyPath = propertySteps.length > 0 &&
      propertySteps.every((step) => step.propertyName !== null)
      ? propertySteps.map((step) => step.propertyName as string)
      : null;
    return [{
      defaultExpression: propertySteps.length === 0
        ? rootDefaultExpression
        : propertyDefaultExpression,
      name: node.name,
      propertyPath,
      propertySteps,
    }];
  }
  if (node.type === "AssignmentPattern") {
    if (!isExpression(node.right)) {
      return readParameterBindingEntries(
        node.left,
        propertySteps,
        rootDefaultExpression,
      );
    }
    if (propertySteps.length === 0) {
      return readParameterBindingEntries(
        node.left,
        propertySteps,
        node.right,
      );
    }
    const nestedSteps = propertySteps.map((step, index) =>
      index === propertySteps.length - 1
        ? { ...step, defaultExpression: node.right }
        : step
    );
    return readParameterBindingEntries(
      node.left,
      nestedSteps,
      rootDefaultExpression,
    );
  }
  if (node.type === "RestElement") {
    return readParameterBindingEntries(
      node.argument,
      propertySteps,
      rootDefaultExpression,
    );
  }
  if (node.type === "ArrayPattern") {
    return node.elements.flatMap((element, index) =>
      element
        ? readParameterBindingEntries(
            element,
            [...propertySteps, {
              defaultExpression: null,
              propertyName: String(index),
            }],
            rootDefaultExpression,
          )
        : []
    );
  }
  if (node.type !== "ObjectPattern") {
    return [];
  }
  return node.properties.flatMap((property) => {
    if (!isObjectProperty(property)) {
      return [];
    }
    const propertyName = property.computed
      ? isStringLiteral(property.key)
        ? property.key.value
        : isNumericLiteral(property.key)
          ? String(property.key.value)
          : null
      : readPropertyName(property.key) ??
        (isNumericLiteral(property.key) ? String(property.key.value) : null);
    return readParameterBindingEntries(
      property.value,
      [...propertySteps, { defaultExpression: null, propertyName }],
      rootDefaultExpression,
    );
  });
}

type HttpTransportModuleKind =
  | "fetch-package"
  | "node-http"
  | "undici"
  | "web-global";

interface StaticTransportModule {
  readonly moduleName: string;
  readonly source: "dynamic-import" | "require";
}

function classifyHttpTransportModule(
  moduleName: string,
): HttpTransportModuleKind | null {
  if (/^(?:node:)?https?$/u.test(moduleName)) {
    return "node-http";
  }
  if (/^undici(?:\/|$)/u.test(moduleName)) {
    return "undici";
  }
  if (/^(?:cross-fetch|node-fetch)(?:\/|$)/u.test(moduleName)) {
    return "fetch-package";
  }
  return null;
}

function isHttpTransportMethod(
  transport: HttpTransportModuleKind,
  method: string,
): boolean {
  if (transport === "node-http") {
    return /^(?:get|request)$/u.test(method);
  }
  if (transport === "undici") {
    return /^(?:fetch|request)$/u.test(method);
  }
  if (transport === "web-global") {
    return method === "fetch";
  }
  return /^(?:default|fetch)$/u.test(method);
}

function readRequiredModuleName(node: Node): string | null {
  if (
    (!isCallExpression(node) && !isOptionalCallExpression(node)) ||
    !isIdentifier(node.callee, { name: "require" })
  ) {
    return null;
  }
  const moduleName = node.arguments[0];
  return moduleName && isStringLiteral(moduleName) ? moduleName.value : null;
}

function readStaticTransportModule(node: Node): StaticTransportModule | null {
  const expression = unwrapExpression(node);
  if (expression.type === "AwaitExpression") {
    return readStaticTransportModule(expression.argument);
  }
  if (expression.type === "ImportExpression") {
    return isStringLiteral(expression.source) && expression.options === null
      ? { moduleName: expression.source.value, source: "dynamic-import" }
      : null;
  }
  if (
    (isCallExpression(expression) || isOptionalCallExpression(expression)) &&
    expression.callee.type === "Import"
  ) {
    if (expression.arguments.length !== 1) {
      return null;
    }
    const [moduleName] = expression.arguments;
    return moduleName &&
      moduleName.type !== "ArgumentPlaceholder" &&
      moduleName.type !== "SpreadElement" &&
      isStringLiteral(moduleName)
      ? { moduleName: moduleName.value, source: "dynamic-import" }
      : null;
  }
  const requiredModule = readRequiredModuleName(expression);
  return requiredModule
    ? { moduleName: requiredModule, source: "require" }
    : null;
}

function readImportEqualsModuleName(node: Node): string | null {
  if (
    node.type !== "TSImportEqualsDeclaration" ||
    node.moduleReference.type !== "TSExternalModuleReference" ||
    !isStringLiteral(node.moduleReference.expression)
  ) {
    return null;
  }
  return node.moduleReference.expression.value;
}

function readTransportNamespaceKinds(
  node: Node,
  transportBindings: ReadonlyMap<string, readonly TransportBinding[]>,
  variableBindings: ReadonlyMap<string, readonly VariableBinding[]>,
  before: number,
  sourceFile: Node,
): readonly HttpTransportModuleKind[] {
  const transports = new Set<HttpTransportModuleKind>();
  const visit = (
    candidate: Node,
    position: number,
    resolving: ReadonlySet<string>,
  ): void => {
    const expression = unwrapExpression(candidate);
    const staticModule = readStaticTransportModule(expression);
    if (staticModule) {
      const transport = classifyHttpTransportModule(staticModule.moduleName);
      if (
        transport &&
        !(transport === "fetch-package" && staticModule.source === "require")
      ) {
        transports.add(transport);
      }
      return;
    }
    if (isIdentifier(expression)) {
      for (const binding of resolvePossibleBindings(
        variableBindings,
        expression.name,
        position,
      )) {
        const key = `transport-variable:${expression.name}:${binding.start}`;
        if (resolving.has(key)) {
          continue;
        }
        const nextResolving = new Set(resolving);
        nextResolving.add(key);
        for (const value of readVariableBindingPossibleValues(
          binding,
          variableBindings,
          sourceFile,
        )) {
          visit(value, binding.start - 1, nextResolving);
        }
      }
      const resolved = resolvePossibleTransportBindings(
        transportBindings,
        expression.name,
        position,
      );
      if (
        /^(?:globalThis|self|window)$/u.test(expression.name) &&
        resolved.length === 0
      ) {
        transports.add("web-global");
      }
      for (const binding of resolved) {
        if (binding.kind === "namespace" && binding.transport) {
          transports.add(binding.transport);
        }
      }
      return;
    }
    if (expression.type === "ConditionalExpression") {
      visit(expression.consequent, position, resolving);
      visit(expression.alternate, position, resolving);
      return;
    }
    if (expression.type === "LogicalExpression") {
      visit(expression.left, position, resolving);
      visit(expression.right, position, resolving);
      return;
    }
    if (expression.type === "SequenceExpression") {
      for (const child of expression.expressions) {
        visit(child, position, resolving);
      }
    }
  };
  visit(node, before, new Set());
  return [...transports];
}

function readTransportMemberBindings(
  node: Node,
  transportBindings: ReadonlyMap<string, readonly TransportBinding[]>,
  variableBindings: ReadonlyMap<string, readonly VariableBinding[]>,
  before: number,
  sourceFile: Node,
): readonly HttpTransportModuleKind[] {
  if (!isMemberExpression(node) && !isOptionalMemberExpression(node)) {
    return [];
  }
  const parts = readMemberPath(node);
  const root = parts?.[0];
  const method = readPropertyName(node.property);
  if (!method) {
    return [];
  }
  const staticModule = readStaticTransportModule(node.object);
  const directTransport = staticModule
    ? classifyHttpTransportModule(staticModule.moduleName)
    : null;
  if (directTransport) {
    return isHttpTransportMethod(directTransport, method)
      ? [directTransport]
      : [];
  }
  if (!root) {
    return [];
  }
  return readTransportNamespaceKinds(
    node.object,
    transportBindings,
    variableBindings,
    before,
    sourceFile,
  ).filter((transport) => isHttpTransportMethod(transport, method));
}

function collectFunctionBindings(sourceFile: Node): Map<string, FunctionBinding[]> {
  const scopes = collectLexicalScopes(sourceFile);
  const bindings = new Map<string, FunctionBinding[]>();
  traverseFast(sourceFile, (node) => {
    if (node.type !== "FunctionDeclaration") {
      return;
    }
    const name = readCallableName(node);
    if (!name) {
      return;
    }
    const scope = findInnermostLexicalScope(scopes, node.start ?? 0);
    const current = bindings.get(name) ?? [];
    current.push({
      node,
      scopeEnd: scope.end,
      scopeStart: scope.start,
      start: node.start ?? 0,
    });
    bindings.set(name, current);
  });
  return bindings;
}

function readDirectFunctionReturnExpressions(node: Node): Expression[] {
  if (!isFunction(node)) {
    return [];
  }
  if (node.body.type !== "BlockStatement") {
    return isExpression(node.body) ? [node.body] : [];
  }
  const returned: Expression[] = [];
  traverseFast(node.body, (child) => {
    if (isFunction(child)) {
      return traverseFast.skip;
    }
    if (isReturnStatement(child) && isExpression(child.argument)) {
      returned.push(child.argument);
    }
  });
  return returned;
}

function collectFileProviderIds(
  sourceFile: Node,
  relativePath: string,
): Set<string> {
  const providerIds = collectFileProviderFallbackIds(sourceFile, relativePath);
  traverseFast(sourceFile, (node) => {
    if (isImportDeclaration(node)) {
      addProviderIds(providerIds, providerIdsFromModule(node.source.value));
    }
  });
  return providerIds;
}

function collectFileProviderFallbackIds(
  sourceFile: Node,
  relativePath: string,
): Set<string> {
  const providerIds = providerIdsFromIdentifier(relativePath);
  traverseFast(sourceFile, (node) => {
    if (isStringLiteral(node)) {
      addProviderIds(providerIds, providerIdsFromStaticText(node.value));
      return;
    }
    if (isTemplateLiteral(node)) {
      for (const quasi of node.quasis) {
        addProviderIds(
          providerIds,
          providerIdsFromStaticText(quasi.value.cooked ?? quasi.value.raw),
        );
      }
    }
  });
  return providerIds;
}

function collectTransportEvidenceProviderIds(
  sourceFile: Node,
  contents: string,
): Set<string> {
  const providerIds = new Set<string>();
  traverseFast(sourceFile, (node) => {
    if (isImportDeclaration(node)) {
      addProviderIds(providerIds, providerIdsFromModule(node.source.value));
      return;
    }
    if (isStringLiteral(node)) {
      addProviderIds(providerIds, providerIdsFromStaticText(node.value));
      return;
    }
    if (
      isVariableDeclarator(node) &&
      isIdentifier(node.id) &&
      node.init &&
      isTransportEndpointBindingName(node.id.name)
    ) {
      addProviderIds(providerIds, providerIdsFromIdentifier(node.id.name));
      addProviderIds(
        providerIds,
        providerIdsFromStaticText(readNodeText(node.init, contents)),
      );
      return;
    }
    if (
      isClassProperty(node) &&
      isIdentifier(node.key) &&
      node.value &&
      isTransportEndpointBindingName(node.key.name)
    ) {
      addProviderIds(providerIds, providerIdsFromIdentifier(node.key.name));
      addProviderIds(
        providerIds,
        providerIdsFromStaticText(readNodeText(node.value, contents)),
      );
    }
  });
  return providerIds;
}

function isTransportEndpointBindingName(name: string): boolean {
  const normalized = normalizeIdentifierForMatch(name);
  return /(?:api(?:base|root)?url|apiroot|baseurl|endpoint|method|path|tokenuri)$/u
    .test(normalized);
}

function collectMemberBindings(
  sourceFile: Node,
  contents: string,
): Map<string, MemberBinding[]> {
  const bindings = new Map<string, MemberBinding[]>();
  traverseFast(sourceFile, (node) => {
    if (
      isAssignmentExpression(node) &&
      node.operator === "=" &&
      isExpression(node.right)
    ) {
      const pathParts = readMemberPath(node.left);
      if (!pathParts || pathParts[0] !== "this") {
        return;
      }
      const key = pathParts.join(".");
      const current = bindings.get(key) ?? [];
      current.push({
        initializer: node.right,
        start: node.start ?? 0,
        typeAnnotation: null,
      });
      bindings.set(key, current);
      return;
    }

    if (
      isClassProperty(node) &&
      isIdentifier(node.key)
    ) {
      const key = `this.${node.key.name}`;
      const current = bindings.get(key) ?? [];
      current.push({
        initializer: node.value && isExpression(node.value) ? node.value : null,
        start: node.start ?? 0,
        typeAnnotation: node.typeAnnotation
          ? readNodeText(node.typeAnnotation, contents)
          : null,
      });
      bindings.set(key, current);
      return;
    }

    if (node.type === "TSParameterProperty") {
      const identifier = readParameterIdentifier(node);
      if (!identifier) {
        return;
      }
      const key = `this.${identifier.name}`;
      const current = bindings.get(key) ?? [];
      const defaultExpression = readParameterDefaultExpression(node);
      current.push({
        initializer: defaultExpression && isExpression(defaultExpression)
          ? defaultExpression
          : null,
        start: node.start ?? 0,
        typeAnnotation: identifier.typeAnnotation
          ? readNodeText(identifier.typeAnnotation, contents)
          : null,
      });
      bindings.set(key, current);
    }
  });
  return bindings;
}

function collectParameterBindings(
  sourceFile: Node,
  contents: string,
): Map<string, ParameterBinding[]> {
  const bindings = new Map<string, ParameterBinding[]>();
  traverseFast(sourceFile, (node) => {
    if (!isFunction(node)) {
      return;
    }
    for (const parameter of node.params) {
      const typeAnnotation = readParameterTypeAnnotation(parameter, contents);
      for (const entry of readParameterBindingEntries(parameter)) {
        const current = bindings.get(entry.name) ?? [];
        current.push({
          defaultExpression: entry.defaultExpression,
          name: entry.name,
          ownerName: readCallableName(node),
          propertyPath: entry.propertyPath,
          scopeEnd: node.end ?? Number.MAX_SAFE_INTEGER,
          scopeStart: node.start ?? 0,
          typeAnnotation,
        });
        bindings.set(entry.name, current);
      }
    }
  });
  return bindings;
}

function readParameterTypeAnnotation(
  node: Node,
  contents: string,
): string | null {
  if (node.type === "TSParameterProperty") {
    return readParameterTypeAnnotation(node.parameter, contents);
  }
  if (node.type === "AssignmentPattern") {
    return readParameterTypeAnnotation(node.left, contents);
  }
  if (
    "typeAnnotation" in node &&
    node.typeAnnotation &&
    typeof node.typeAnnotation === "object" &&
    "type" in node.typeAnnotation
  ) {
    return readNodeText(node.typeAnnotation as Node, contents);
  }
  return null;
}

interface ProviderHttpCandidate {
  readonly call: CallExpression | OptionalCallExpression;
  readonly providers: readonly RegisteredProviderBoundary[];
  readonly unresolvedProviderBoundary: boolean;
}

interface ProviderHttpCallShape {
  readonly evidenceNode: Node;
  readonly initArgument: Node | null;
  readonly supportsRegisteredExceptions: boolean;
  readonly transportTarget: Node;
  readonly unresolvedProviderBoundary: boolean;
  readonly urlArgument: Node;
}

interface LocalFunctionRange {
  readonly end: number;
  readonly name: string;
  readonly start: number;
}

function collectRawProviderHttpViolations(input: {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly contents: string;
  readonly relativePath: string;
  readonly sourceFile: Node;
  readonly violationsByKey: Map<string, ProviderRequestBoundaryViolation>;
}): void {
  collectOpaqueProviderTransportMutationViolations(input);
  const candidates: ProviderHttpCandidate[] = [];
  traverseFast(input.sourceFile, (node) => {
    if (
      (!isCallExpression(node) && !isOptionalCallExpression(node)) ||
      !isFetchLikeCallTarget({
        analysis: input.analysis,
        before: node.start ?? Number.MAX_SAFE_INTEGER,
        bindings: input.bindings,
        contents: input.contents,
        node: node.callee,
        resolving: new Set(),
      })
    ) {
      return;
    }
    const callShape = readProviderHttpCallShape({
      analysis: input.analysis,
      bindings: input.bindings,
      call: node,
      contents: input.contents,
    });
    if (!callShape) {
      return;
    }

    const requestFacts = inferProviderExpressionFacts({
      analysis: input.analysis,
      before: node.start ?? Number.MAX_SAFE_INTEGER,
      bindings: input.bindings,
      contents: input.contents,
      node: callShape.evidenceNode,
      resolving: new Set(),
    });
    const exactTransportTarget = isFetchLikeCallTarget({
      analysis: input.analysis,
      before: node.start ?? Number.MAX_SAFE_INTEGER,
      bindings: input.bindings,
      contents: input.contents,
      exact: true,
      node: callShape.transportTarget,
      resolving: new Set(),
    });
    if (exactTransportTarget) {
      mergeProviderExpressionFacts(
        requestFacts,
        inferProviderExpressionFacts({
          analysis: input.analysis,
          before: node.start ?? Number.MAX_SAFE_INTEGER,
          bindings: input.bindings,
          contents: input.contents,
          node: callShape.transportTarget,
          resolving: new Set(),
        }),
      );
    }
    const insideSdkFetchAdapter = isInsideSdkFetchAdapter(
      input.sourceFile,
      node.start ?? 0,
    );
    if (
      requestFacts.providerIds.size === 0 &&
      (
        exactTransportTarget ||
        insideSdkFetchAdapter
      )
    ) {
      addEnclosingProviderContextFacts({
        analysis: input.analysis,
        allowFileFallback: insideSdkFetchAdapter,
        facts: requestFacts,
        position: node.start ?? 0,
        sourceFile: input.sourceFile,
      });
    }
    const providers = providerBoundaryRegistry.filter(
      (provider) =>
        requestFacts.providerIds.has(provider.id) &&
        provider.rawHttpPolicy === "require-official-sdk",
    );
    if (providers.length === 0 && !callShape.unresolvedProviderBoundary) {
      return;
    }
    if (
      !callShape.unresolvedProviderBoundary &&
      callShape.supportsRegisteredExceptions &&
      providers.every((provider) =>
        matchesRegisteredProviderHttpException({
          analysis: input.analysis,
          bindings: input.bindings,
          call: node,
          contents: input.contents,
          provider,
          relativePath: input.relativePath,
          initArgument: callShape.initArgument,
          urlArgument: callShape.urlArgument,
          urlFacts: requestFacts,
        })
      )
    ) {
      return;
    }
    candidates.push({
      call: node,
      providers,
      unresolvedProviderBoundary:
        callShape.unresolvedProviderBoundary && providers.length === 0,
    });
  });

  const localFunctions = collectLocalFunctionRanges(input.sourceFile);
  const localFunctionNameCounts = new Map<string, number>();
  for (const localFunction of localFunctions) {
    localFunctionNameCounts.set(
      localFunction.name,
      (localFunctionNameCounts.get(localFunction.name) ?? 0) + 1,
    );
  }
  const transportOwnerNames = new Set<string>();
  for (const candidate of candidates) {
    const calledName = readCalledName(candidate.call.callee);
    if (calledName && localFunctionNameCounts.has(calledName)) {
      continue;
    }
    const owner = findInnermostLocalFunction(
      localFunctions,
      candidate.call.start ?? 0,
    );
    if (owner && localFunctionNameCounts.get(owner.name) === 1) {
      transportOwnerNames.add(owner.name);
    }
  }

  for (const candidate of candidates) {
    const calledName = readCalledName(candidate.call.callee);
    if (calledName && transportOwnerNames.has(calledName)) {
      continue;
    }
    recordViolation(
      {
        boundary: candidate.unresolvedProviderBoundary
          ? `Unresolved external-provider raw HTTP via ${readNodeText(candidate.call.callee, input.contents)}`
          : `${candidate.providers.map((provider) => provider.label).join("/")} raw HTTP via ${readNodeText(candidate.call.callee, input.contents)}`,
        contents: input.contents,
        relativePath: input.relativePath,
        violationsByKey: input.violationsByKey,
      },
      candidate.call.callee,
      "raw-provider-http",
    );
  }
}

function collectOpaqueProviderTransportMutationViolations(input: {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly contents: string;
  readonly relativePath: string;
  readonly sourceFile: Node;
  readonly violationsByKey: Map<string, ProviderRequestBoundaryViolation>;
}): void {
  const findBoundProviderFacts = (
    node: Node,
    before: number,
  ): ProviderExpressionFacts | null => {
    let found: ProviderExpressionFacts | null = null;
    traverseFast(node, (candidate) => {
      if (found) {
        return;
      }
      const bound = readBoundTransportCall({
        analysis: input.analysis,
        before,
        bindings: input.bindings,
        contents: input.contents,
        node: candidate,
        resolving: new Set(),
      });
      if (!bound) {
        return;
      }
      const facts = inferProviderExpressionFacts({
        analysis: input.analysis,
        before,
        bindings: input.bindings,
        contents: input.contents,
        node: bound.evidenceNode,
        resolving: new Set(),
      });
      if (
        providerBoundaryRegistry.some(
          (provider) =>
            provider.rawHttpPolicy === "require-official-sdk" &&
            facts.providerIds.has(provider.id),
        )
      ) {
        found = facts;
      }
    });
    return found;
  };

  for (const mutation of collectStaticMemberMutationCandidates(
    input.sourceFile,
  )) {
    const before = mutation.start ?? Number.MAX_SAFE_INTEGER;
    let target: Node | null = null;
    let targetMayBeRootOnly = false;
    const values: Node[] = [];
    if (isAssignmentExpression(mutation)) {
      target = mutation.left;
      values.push(mutation.right);
    } else if (
      (isCallExpression(mutation) || isOptionalCallExpression(mutation)) &&
      readMemberPath(mutation.callee)?.join(".") === "Object.assign"
    ) {
      targetMayBeRootOnly = true;
      const [assigned, ...sources] = mutation.arguments;
      if (
        assigned &&
        assigned.type !== "ArgumentPlaceholder" &&
        assigned.type !== "SpreadElement"
      ) {
        target = assigned;
      }
      values.push(
        ...sources.filter(
          (source): source is Exclude<typeof source, { type: "ArgumentPlaceholder" | "SpreadElement" }> =>
            source.type !== "ArgumentPlaceholder" &&
            source.type !== "SpreadElement",
        ),
      );
    }
    if (
      !target ||
      !resolvePossibleStaticMemberMutationTargets(
        target,
        input.bindings,
        before,
        input.sourceFile,
        targetMayBeRootOnly,
      ).opaque
    ) {
      continue;
    }
    const facts = values
      .map((value) => findBoundProviderFacts(value, before))
      .find((candidate) => candidate !== null);
    if (!facts) {
      continue;
    }
    const providers = providerBoundaryRegistry.filter(
      (provider) =>
        provider.rawHttpPolicy === "require-official-sdk" &&
        facts.providerIds.has(provider.id),
    );
    recordViolation(
      {
        boundary:
          `${providers.map((provider) => provider.label).join("/")} provider transport stored through an opaque member alias`,
        contents: input.contents,
        relativePath: input.relativePath,
        violationsByKey: input.violationsByKey,
      },
      target,
      "raw-provider-http",
    );
  }
}

interface BoundTransportCall {
  readonly arguments: readonly Node[];
  readonly evidenceNode: Node;
  readonly transportTarget: Node;
  readonly unresolved: boolean;
}

function readBoundTransportCall(input: {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly before: number;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly contents: string;
  readonly node: Node;
  readonly resolving: ReadonlySet<string>;
}): BoundTransportCall | null {
  const expression = unwrapExpression(input.node);
  if (isIdentifier(expression)) {
    const possibleBindings = resolvePossibleBindings(
      input.bindings,
      expression.name,
      input.before,
    );
    if (possibleBindings.length === 0) {
      return null;
    }
    const possibleBoundCalls: BoundTransportCall[] = [];
    let possibleValueCount = 0;
    for (const binding of possibleBindings) {
      const key = `bound-transport:${expression.name}:${binding.start}`;
      if (input.resolving.has(key)) {
        continue;
      }
      const resolving = new Set(input.resolving);
      resolving.add(key);
      const values = readVariableBindingPossibleValues(
        binding,
        input.bindings,
        input.analysis.sourceFile,
      );
      possibleValueCount += values.length;
      for (const value of values) {
        const possibleBound = readBoundTransportCall({
          ...input,
          before: binding.start,
          node: value,
          resolving,
        });
        if (possibleBound) {
          possibleBoundCalls.push(possibleBound);
        }
      }
    }
    const [bound] = possibleBoundCalls;
    if (!bound) {
      return null;
    }
    return possibleBindings.length === 1 &&
        possibleValueCount === 1 &&
        possibleBoundCalls.length === 1 &&
        possibleBindings[0]?.definitive &&
        !bound.unresolved
      ? bound
      : { ...bound, arguments: [], unresolved: true };
  }
  if (
    isMemberExpression(expression) ||
    isOptionalMemberExpression(expression)
  ) {
    const path = readMemberPath(expression);
    if (path?.[0] !== "this") {
      const initializer = resolveStaticMemberInitializer(
        expression,
        input.bindings,
        input.before,
        input.analysis.sourceFile,
      );
      if (!initializer) {
        for (const possible of readPossibleStaticMemberInitializers(
          expression,
          input.bindings,
          input.before,
          input.analysis.sourceFile,
        )) {
          const possibleBound = readBoundTransportCall({
            ...input,
            before: possible.start ?? input.before,
            node: possible,
          });
          if (possibleBound) {
            return {
              arguments: [],
              evidenceNode: expression,
              transportTarget: possibleBound.transportTarget,
              unresolved: true,
            };
          }
        }
        return null;
      }
      const key = `bound-static-member:${path?.join(".") ?? expression.start}`;
      if (input.resolving.has(key)) {
        return null;
      }
      const resolving = new Set(input.resolving);
      resolving.add(key);
      return readBoundTransportCall({
        ...input,
        before: initializer.start ?? input.before,
        node: initializer,
        resolving,
      });
    }
    const binding = resolveMemberBinding(
      input.analysis.memberBindings,
      path.join("."),
      input.before,
    );
    if (!binding?.initializer) {
      return null;
    }
    const key = `bound-transport-member:${path.join(".")}:${binding.start}`;
    if (input.resolving.has(key)) {
      return null;
    }
    const resolving = new Set(input.resolving);
    resolving.add(key);
    return readBoundTransportCall({
      ...input,
      before: binding.start,
      node: binding.initializer,
      resolving,
    });
  }
  if (!isCallExpression(expression) && !isOptionalCallExpression(expression)) {
    return null;
  }
  const bindCallee = unwrapExpression(expression.callee);
  if (
    (!isMemberExpression(bindCallee) &&
      !isOptionalMemberExpression(bindCallee)) ||
    readPropertyName(bindCallee.property) !== "bind" ||
    !isFetchLikeCallTarget({
      analysis: input.analysis,
      before: expression.start ?? input.before,
      bindings: input.bindings,
      contents: input.contents,
      node: bindCallee.object,
      resolving: new Set(),
    })
  ) {
    return null;
  }
  const inner = readBoundTransportCall({
    ...input,
    before: expression.start ?? input.before,
    node: bindCallee.object,
  });
  const hasOpaqueArgument = expression.arguments.some(
    (argument) =>
      argument.type === "ArgumentPlaceholder" ||
      argument.type === "SpreadElement",
  );
  if (hasOpaqueArgument || inner?.unresolved) {
    return {
      arguments: [],
      evidenceNode: expression,
      transportTarget: inner?.transportTarget ?? bindCallee.object,
      unresolved: true,
    };
  }
  return {
    arguments: [
      ...(inner?.arguments ?? []),
      ...expression.arguments.slice(1),
    ],
    evidenceNode: expression,
    transportTarget: inner?.transportTarget ?? bindCallee.object,
    unresolved: false,
  };
}

function readProviderHttpCallShape(input: {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly call: CallExpression | OptionalCallExpression;
  readonly contents: string;
}): ProviderHttpCallShape | null {
  const { call } = input;
  const callee = unwrapExpression(call.callee);
  let emptyApplyEvidence: Node | null = null;
  let invocationArguments: readonly Node[];
  let transportTarget: Node = call.callee;
  if (isMemberExpression(callee) || isOptionalMemberExpression(callee)) {
    const method = readPropertyName(callee.property);
    if (method === "call") {
      invocationArguments = call.arguments.slice(1);
      transportTarget = callee.object;
    } else if (method === "apply") {
      transportTarget = callee.object;
      const tuple = call.arguments[1];
      if (!tuple || tuple.type === "ArgumentPlaceholder") {
        return null;
      }
      const tupleExpression = unwrapExpression(
        tuple.type === "SpreadElement" ? tuple.argument : tuple,
      );
      if (
        tuple.type !== "SpreadElement" &&
        tupleExpression.type === "ArrayExpression" &&
        tupleExpression.elements.every(
          (element) => element !== null && element.type !== "SpreadElement",
        )
      ) {
        invocationArguments = tupleExpression.elements.flatMap((element) =>
          element ? [element] : []
        );
        if (invocationArguments.length === 0) {
          emptyApplyEvidence = tupleExpression;
        }
      } else {
        return {
          evidenceNode: tupleExpression,
          initArgument: null,
          supportsRegisteredExceptions: false,
          transportTarget,
          unresolvedProviderBoundary: true,
          urlArgument: tupleExpression,
        };
      }
    } else {
      invocationArguments = call.arguments;
    }
  } else {
    invocationArguments = call.arguments;
  }

  const bound = readBoundTransportCall({
    analysis: input.analysis,
    before: call.start ?? Number.MAX_SAFE_INTEGER,
    bindings: input.bindings,
    contents: input.contents,
    node: transportTarget,
    resolving: new Set(),
  });
  if (bound?.unresolved) {
    return {
      evidenceNode: bound.evidenceNode,
      initArgument: null,
      supportsRegisteredExceptions: false,
      transportTarget: bound.transportTarget,
      unresolvedProviderBoundary: true,
      urlArgument: bound.evidenceNode,
    };
  }
  const effectiveArguments = [
    ...(bound?.arguments ?? []),
    ...invocationArguments,
  ];
  const [urlArgument] = effectiveArguments.filter(
    (argument) => argument.type !== "ArgumentPlaceholder",
  );
  if (!urlArgument && emptyApplyEvidence) {
    return {
      evidenceNode: emptyApplyEvidence,
      initArgument: null,
      supportsRegisteredExceptions: false,
      transportTarget: bound?.transportTarget ?? transportTarget,
      unresolvedProviderBoundary: true,
      urlArgument: emptyApplyEvidence,
    };
  }
  return urlArgument
    ? {
        evidenceNode: urlArgument.type === "SpreadElement"
          ? urlArgument.argument
          : urlArgument,
        initArgument: effectiveArguments[1] ?? null,
        supportsRegisteredExceptions: bound === null,
        transportTarget: bound?.transportTarget ?? transportTarget,
        unresolvedProviderBoundary: false,
        urlArgument: urlArgument.type === "SpreadElement"
          ? urlArgument.argument
          : urlArgument,
      }
    : null;
}

function isInsideSdkFetchAdapter(sourceFile: Node, position: number): boolean {
  return collectLocalFunctionRanges(sourceFile).some(
    (callable) =>
      callable.start <= position &&
      position <= callable.end &&
      /sdkfetch/iu.test(callable.name),
  );
}

function addEnclosingProviderContextFacts(input: {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly allowFileFallback: boolean;
  readonly facts: ProviderExpressionFacts;
  readonly position: number;
  readonly sourceFile: Node;
}): void {
  traverseFast(input.sourceFile, (node) => {
    if (
      (node.type === "ClassDeclaration" || node.type === "ClassExpression") &&
      (node.start ?? 0) <= input.position &&
      input.position <= (node.end ?? Number.MAX_SAFE_INTEGER)
    ) {
      if (node.id) {
        addProviderIds(
          input.facts.providerIds,
          providerIdsFromIdentifier(node.id.name),
        );
      }
      if (node.superClass) {
        addProviderIds(
          input.facts.providerIds,
          providerIdsFromIdentifier(
            readMemberPath(node.superClass)?.join(".") ?? "",
          ),
        );
      }
    }
  });
  for (const callable of collectLocalFunctionRanges(input.sourceFile)) {
    if (callable.start <= input.position && input.position <= callable.end) {
      addProviderIds(
        input.facts.providerIds,
        providerIdsFromIdentifier(callable.name),
      );
    }
  }
  if (
    input.allowFileFallback &&
    input.facts.providerIds.size === 0 &&
    input.analysis.fileProviderIds.size === 1
  ) {
    addProviderIds(input.facts.providerIds, input.analysis.fileProviderIds);
  }
}

function collectLocalFunctionRanges(sourceFile: Node): LocalFunctionRange[] {
  const ranges: LocalFunctionRange[] = [];
  traverseFast(sourceFile, (node) => {
    if (isFunction(node)) {
      const name = readCallableName(node);
      if (name) {
        ranges.push({
          end: node.end ?? Number.MAX_SAFE_INTEGER,
          name,
          start: node.start ?? 0,
        });
      }
      return;
    }
    if (
      isVariableDeclarator(node) &&
      isIdentifier(node.id) &&
      node.init &&
      isFunction(node.init)
    ) {
      ranges.push({
        end: node.init.end ?? Number.MAX_SAFE_INTEGER,
        name: node.id.name,
        start: node.init.start ?? node.start ?? 0,
      });
    }
  });
  return ranges;
}

function findInnermostLocalFunction(
  ranges: readonly LocalFunctionRange[],
  position: number,
): LocalFunctionRange | null {
  let resolved: LocalFunctionRange | null = null;
  for (const range of ranges) {
    if (
      range.start <= position &&
      position <= range.end &&
      (
        !resolved ||
        range.start > resolved.start ||
        (range.start === resolved.start && range.end < resolved.end)
      )
    ) {
      resolved = range;
    }
  }
  return resolved;
}

function readCalledName(node: Node): string | null {
  const expression = unwrapExpression(node);
  return isIdentifier(expression) ? expression.name : null;
}

function collectHandwrittenProviderTransportViolations(input: {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly contents: string;
  readonly relativePath: string;
  readonly sourceFile: Node;
  readonly violationsByKey: Map<string, ProviderRequestBoundaryViolation>;
}): void {
  traverseFast(input.sourceFile, (node) => {
    const declaration = readNamedTransportDeclaration(node);
    if (!declaration) {
      return;
    }
    const declarationText = readNodeText(node, input.contents);
    const providerIds = providerIdsFromIdentifier(declaration.name);
    const providerNamedConcrete = providerIds.size > 0 &&
      isConcreteHandwrittenTransportDeclaration(
        declaration.name,
        declarationText,
      );
    const genericWireConcrete = providerIds.size === 0 &&
      isStrongGenericHttpWireDeclaration(
        declaration.name,
        declarationText,
      );
    if (!providerNamedConcrete && !genericWireConcrete) {
      return;
    }
    if (
      genericWireConcrete &&
      input.analysis.transportEvidenceProviderIds.size === 1
    ) {
      addProviderIds(
        providerIds,
        input.analysis.transportEvidenceProviderIds,
      );
    }
    const providers = providerBoundaryRegistry.filter(
      (provider) =>
        providerIds.has(provider.id) &&
        provider.rawHttpPolicy === "require-official-sdk" &&
        input.analysis.transportEvidenceProviderIds.has(provider.id),
    );
    if (providers.length === 0) {
      return;
    }
    recordViolationAtPosition(
      {
        boundary:
          `${providers.map((provider) => provider.label).join("/")} handwritten transport declaration ${declaration.name}`,
        contents: input.contents,
        relativePath: input.relativePath,
        violationsByKey: input.violationsByKey,
      },
      declaration.start,
      "handwritten-provider-transport",
    );
  });
}

function readProviderCallParameterValues(input: {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly call: CallExpression | OptionalCallExpression;
  readonly callerParameterValues?: ProviderCallParameterValues;
  readonly callable: Node;
}): ProviderCallParameterValues {
  const valuesByName = new Map<string, ProviderCallParameterValue[]>(
    [...(input.callerParameterValues ?? [])].map(([name, values]) => [
      name,
      [...values],
    ]),
  );
  if (!isFunction(input.callable)) {
    return valuesByName;
  }

  for (const [index, parameter] of input.callable.params.entries()) {
    if (parameter.type === "RestElement") {
      continue;
    }
    const argument = input.call.arguments[index];
    const parameterDefault = readParameterDefaultExpression(parameter);
    const roots = readProviderCallPossibleValues({
      analysis: input.analysis,
      before: argument?.start ?? input.call.start ?? 0,
      bindings: input.bindings,
      callParameterValues: input.callerParameterValues,
      defaultExpression: parameterDefault && isExpression(parameterDefault)
        ? parameterDefault
        : null,
      defaultCallParameterValues: valuesByName,
      node: argument &&
          argument.type !== "ArgumentPlaceholder" &&
          argument.type !== "SpreadElement" &&
          isExpression(argument)
        ? argument
        : null,
      propertySteps: [],
      resolving: new Set(),
    });

    for (const entry of readParameterBindingEntries(parameter)) {
      const values: ProviderCallParameterValue[] = [];
      for (const root of roots) {
        values.push(...readProviderCallPossibleValues({
          analysis: input.analysis,
          before: root.before,
          bindings: input.bindings,
          callParameterValues: root.callParameterValues,
          defaultExpression: null,
          defaultCallParameterValues: valuesByName,
          node: root.node,
          projectionBefore: root.projectionBefore,
          projectionReferencePaths: root.projectionReferencePaths,
          propertySteps: entry.propertySteps,
          resolving: new Set(),
        }));
      }
      valuesByName.set(entry.name, dedupeProviderCallValues(values));
    }
  }
  return valuesByName;
}

function readProviderCallPossibleValues(input: {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly before: number;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly callParameterValues?: ProviderCallParameterValues;
  readonly defaultExpression: Expression | null;
  readonly defaultCallParameterValues?: ProviderCallParameterValues;
  readonly lexicalBefore?: number;
  readonly node: Node | null;
  readonly projectionBefore?: number;
  readonly projectionReferencePaths?: readonly (readonly string[])[];
  readonly propertySteps: readonly ProviderCallPropertyStep[];
  readonly resolving: ReadonlySet<string>;
}): ProviderCallParameterValue[] {
  const readDefaultValues = (
    defaultExpression: Expression,
    observationBefore: number,
    callParameterValues: ProviderCallParameterValues | undefined,
    propertySteps: readonly ProviderCallPropertyStep[],
  ): ProviderCallParameterValue[] => readProviderCallPossibleValues({
    ...input,
    before: observationBefore,
    callParameterValues,
    defaultExpression: null,
    lexicalBefore: defaultExpression.start ?? input.lexicalBefore ?? input.before,
    node: defaultExpression,
    projectionBefore: observationBefore,
    projectionReferencePaths: readPossibleReferencePaths(defaultExpression),
    propertySteps,
    resolving: new Set(),
  });
  const [propertyStep, ...remainingPropertySteps] = input.propertySteps;
  if (propertyStep) {
    const values: ProviderCallParameterValue[] = [];
    const alternatives = readProviderCallPossibleValues({
      ...input,
      propertySteps: [],
    });
    for (const alternative of alternatives) {
      if (propertyStep.propertyName === null) {
        values.push(alternative);
        for (const [index, step] of input.propertySteps.entries()) {
          if (!step.defaultExpression) {
            continue;
          }
          values.push(...readDefaultValues(
            step.defaultExpression,
            alternative.projectionBefore,
            input.defaultCallParameterValues,
            input.propertySteps.slice(index + 1),
          ));
        }
        continue;
      }
      const projected = readEffectiveStaticPropertyPathValues(
        alternative.node,
        [propertyStep.propertyName],
        input.bindings,
        alternative.projectionBefore,
        input.analysis.sourceFile,
        alternative.projectionReferencePaths,
      );
      for (const node of projected) {
        values.push(...readProviderCallPossibleValues({
          ...input,
          before: node.start ?? alternative.before,
          callParameterValues: alternative.callParameterValues,
          defaultExpression: propertyStep.defaultExpression,
          lexicalBefore: node.start ?? input.lexicalBefore,
          node,
          projectionBefore: alternative.projectionBefore,
          projectionReferencePaths: dedupeReferencePaths([
            ...alternative.projectionReferencePaths.map((referencePath) => [
              ...referencePath,
              propertyStep.propertyName as string,
            ]),
            ...readPossibleReferencePaths(node),
          ]),
          propertySteps: remainingPropertySteps,
          resolving: new Set(),
        }));
      }
      if (
        propertyStep.defaultExpression &&
        (
          projected.length === 0 ||
          !isProviderCallStaticPropertyDefinitelyDefined({
            analysis: input.analysis,
            before: alternative.before,
            bindings: input.bindings,
            callParameterValues: alternative.callParameterValues,
            node: alternative.node,
            propertyName: propertyStep.propertyName,
          })
        )
      ) {
        values.push(...readDefaultValues(
          propertyStep.defaultExpression,
          alternative.projectionBefore,
          input.defaultCallParameterValues,
          remainingPropertySteps,
        ));
      }
    }
    return dedupeProviderCallValues(values);
  }

  const useDefault = (): ProviderCallParameterValue[] => input.defaultExpression
    ? readDefaultValues(
      input.defaultExpression,
      input.projectionBefore ?? input.before,
      input.defaultCallParameterValues,
      [],
    )
    : [];
  if (!input.node) {
    return useDefault();
  }
  const expression = unwrapExpression(input.node);
  const lexicalBefore = input.lexicalBefore ?? input.before;
  if (
    (isIdentifier(expression, { name: "undefined" }) &&
      !resolveParameterBinding(
        input.analysis.parameterBindings,
        expression.name,
        lexicalBefore,
      ) &&
      resolvePossibleBindings(
        input.bindings,
        expression.name,
        input.before,
        lexicalBefore,
      ).length === 0) ||
    (expression.type === "UnaryExpression" && expression.operator === "void")
  ) {
    return useDefault();
  }
  if (isIdentifier(expression)) {
    const parameter = resolveParameterBinding(
      input.analysis.parameterBindings,
      expression.name,
      lexicalBefore,
    );
    const callable = resolveFunctionBinding(
      input.analysis.functionBindings,
      expression.name,
      lexicalBefore,
    );
    const sameScopeCallables = callable
      ? input.analysis.functionBindings.get(expression.name)?.filter(
        (binding) =>
          binding.scopeStart === callable.scopeStart &&
          binding.scopeEnd === callable.scopeEnd,
      ) ?? []
      : [];
    const functionBinding = callable && sameScopeCallables.length === 1
      ? callable
      : null;
    const lexicalOwner = functionBinding &&
        (!parameter || functionBinding.scopeStart > parameter.scopeStart)
      ? {
        kind: "function" as const,
        scopeEnd: functionBinding.scopeEnd,
        scopeStart: functionBinding.scopeStart,
      }
      : parameter
        ? {
          kind: "parameter" as const,
          scopeEnd: parameter.scopeEnd,
          scopeStart: parameter.scopeStart,
        }
        : null;
    const possibleBindings = resolvePossibleBindings(
      input.bindings,
      expression.name,
      input.before,
      lexicalBefore,
    );
    const possible = lexicalOwner
      ? possibleBindings.filter((binding) =>
        binding.writeScopeStart >= lexicalOwner.scopeStart &&
        binding.writeScopeEnd <= lexicalOwner.scopeEnd
      )
      : possibleBindings;
    const resolved: ProviderCallParameterValue[] = [];
    if (possible.length > 0) {
      resolved.push(...possible.flatMap((binding) => {
        const key = `provider-call-value:${expression.name}:${binding.start}`;
        if (input.resolving.has(key)) {
          return [];
        }
        const resolving = new Set(input.resolving);
        resolving.add(key);
        return readVariableBindingPossibleValues(binding, input.bindings)
          .flatMap((value) => readProviderCallPossibleValues({
            ...input,
            before: binding.start - 1,
            lexicalBefore: value.start ?? binding.start,
            node: value,
            projectionBefore: input.projectionBefore ?? input.before,
            projectionReferencePaths: input.projectionReferencePaths ??
              readPossibleReferencePaths(expression),
            propertySteps: [],
            resolving,
          }));
      }));
    }
    const callParameterValues = input.callParameterValues?.get(
      expression.name,
    ) ?? [];
    const retainLexicalOwner = possible.length === 0 ||
      (
        possible.at(-1)?.definitive === false &&
        possible.at(-1)?.conditionallyExecuted === true
      );
    if (
      lexicalOwner?.kind === "parameter" &&
      callParameterValues.length > 0 &&
      retainLexicalOwner
    ) {
      resolved.push(...callParameterValues.flatMap((value) => {
        const key =
          `provider-call-parameter:${expression.name}:${value.node.start}:${value.before}`;
        if (input.resolving.has(key)) {
          return [];
        }
        const resolving = new Set(input.resolving);
        resolving.add(key);
        return readProviderCallPossibleValues({
          ...input,
          before: value.before,
          callParameterValues: value.callParameterValues,
          lexicalBefore: value.node.start ?? value.before,
          node: value.node,
          projectionBefore: value.projectionBefore,
          projectionReferencePaths: value.projectionReferencePaths,
          propertySteps: [],
          resolving,
        });
      }));
    }
    if (
      lexicalOwner?.kind === "function" &&
      functionBinding &&
      retainLexicalOwner
    ) {
      resolved.push({
        before: input.before,
        callParameterValues: input.callParameterValues,
        node: functionBinding.node,
        projectionBefore: input.projectionBefore ?? input.before,
        projectionReferencePaths: input.projectionReferencePaths ?? [],
      });
    }
    if (possible.length > 0 || resolved.length > 0) {
      return dedupeProviderCallValues(resolved);
    }
  }
  if (
    expression.type === "ConditionalExpression" ||
    expression.type === "LogicalExpression"
  ) {
    const branches = expression.type === "ConditionalExpression"
      ? [expression.consequent, expression.alternate]
      : [expression.left, expression.right];
    return dedupeProviderCallValues(branches.flatMap((branch) =>
      readProviderCallPossibleValues({
        ...input,
        node: branch,
        propertySteps: [],
      })
    ));
  }
  if (expression.type === "SequenceExpression") {
    return readProviderCallPossibleValues({
      ...input,
      node: expression.expressions.at(-1) ?? null,
      propertySteps: [],
    });
  }
  if (expression.type === "AssignmentExpression") {
    return readProviderCallPossibleValues({
      ...input,
      node: expression.right,
      propertySteps: [],
    });
  }
  if (expression.type === "AwaitExpression") {
    return readProviderCallPossibleValues({
      ...input,
      node: expression.argument,
      propertySteps: [],
    });
  }
  const direct = [{
    before: input.before,
    callParameterValues: input.callParameterValues,
    node: expression,
    projectionBefore: input.projectionBefore ?? input.before,
    projectionReferencePaths: input.projectionReferencePaths ??
      readPossibleReferencePaths(expression),
  }];
  return providerCallValueIsDefinitelyDefined(expression)
    ? direct
    : dedupeProviderCallValues([...direct, ...useDefault()]);
}

function isProviderCallStaticPropertyDefinitelyDefined(input: {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly before: number;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly callParameterValues?: ProviderCallParameterValues;
  readonly node: Node;
  readonly propertyName: string;
}): boolean {
  const expression = unwrapExpression(input.node);
  let propertyValue: Node | "defined" | "unknown" | null = null;
  if (isObjectExpression(expression)) {
    for (const property of expression.properties) {
      if (isSpreadElement(property)) {
        propertyValue = "unknown";
        continue;
      }
      if (
        property.computed &&
        !isStringLiteral(property.key) &&
        !isNumericLiteral(property.key)
      ) {
        propertyValue = "unknown";
        continue;
      }
      const propertyName = readPropertyName(property.key) ??
        (isNumericLiteral(property.key) ? String(property.key.value) : null);
      if (propertyName !== input.propertyName) {
        continue;
      }
      propertyValue = isObjectProperty(property)
        ? property.value
        : "defined";
    }
  } else if (
    expression.type === "ArrayExpression" &&
    /^(?:0|[1-9][0-9]*)$/u.test(input.propertyName)
  ) {
    const propertyIndex = Number(input.propertyName);
    if (
      expression.elements.slice(0, propertyIndex + 1).some(
        (element) => element && isSpreadElement(element),
      )
    ) {
      return false;
    }
    propertyValue = expression.elements[propertyIndex] ?? null;
  } else {
    return false;
  }
  if (propertyValue === "defined") {
    return true;
  }
  if (!propertyValue || propertyValue === "unknown") {
    return false;
  }
  const possibleValues = readProviderCallPossibleValues({
    analysis: input.analysis,
    before: input.before,
    bindings: input.bindings,
    callParameterValues: input.callParameterValues,
    defaultExpression: null,
    defaultCallParameterValues: undefined,
    node: propertyValue,
    propertySteps: [],
    resolving: new Set(),
  });
  return possibleValues.length > 0 && possibleValues.every((value) =>
    providerCallValueIsDefinitelyDefined(value.node)
  );
}

function providerCallValueIsDefinitelyDefined(
  node: Node,
): boolean {
  const expression = unwrapExpression(node);
  switch (expression.type) {
    case "ArrayExpression":
    case "ArrowFunctionExpression":
    case "BigIntLiteral":
    case "BinaryExpression":
    case "BooleanLiteral":
    case "ClassExpression":
    case "DecimalLiteral":
    case "FunctionExpression":
    case "NewExpression":
    case "NullLiteral":
    case "NumericLiteral":
    case "ObjectExpression":
    case "RegExpLiteral":
    case "StringLiteral":
    case "TemplateLiteral":
    case "ThisExpression":
    case "UpdateExpression":
      return true;
    case "UnaryExpression":
      return expression.operator !== "void";
    default:
      return false;
  }
}

function dedupeProviderCallValues(
  values: readonly ProviderCallParameterValue[],
): ProviderCallParameterValue[] {
  return values.filter((value, valueIndex) =>
    values.findIndex((candidate) =>
      candidate.node.type === value.node.type &&
      candidate.node.start === value.node.start &&
      candidate.node.end === value.node.end &&
      candidate.before === value.before &&
      candidate.callParameterValues === value.callParameterValues &&
      candidate.projectionBefore === value.projectionBefore &&
      referencePathsEqual(
        candidate.projectionReferencePaths,
        value.projectionReferencePaths,
      )
    ) === valueIndex
  );
}

function inferProviderExpressionFacts(input: {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly before: number;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly callParameterValues?: ProviderCallParameterValues;
  readonly contents: string;
  readonly node: Node;
  readonly resolving: ReadonlySet<string>;
  readonly suppressFileFallback?: boolean;
}): ProviderExpressionFacts {
  const facts = emptyProviderExpressionFacts();
  const node = unwrapExpression(input.node);

  if (isStringLiteral(node)) {
    addExplicitProviderIds(facts, providerIdsFromStaticText(node.value));
    return facts;
  }
  if (isTemplateLiteral(node)) {
    for (const quasi of node.quasis) {
      addExplicitProviderIds(
        facts,
        providerIdsFromStaticText(quasi.value.cooked ?? quasi.value.raw),
      );
    }
    for (const expression of node.expressions) {
      mergeProviderExpressionFacts(
        facts,
        inferProviderExpressionFacts({ ...input, node: expression }),
      );
    }
    return facts;
  }
  if (isIdentifier(node)) {
    addExplicitProviderIds(facts, providerIdsFromIdentifier(node.name));
    const parameter = resolveParameterBinding(
      input.analysis.parameterBindings,
      node.name,
      input.before,
    );
    const callParameterValues = parameter
      ? input.callParameterValues?.get(node.name) ?? []
      : [];
    if (parameter && callParameterValues.length > 0) {
      const bindingKey = `provider-parameter:${node.name}:${parameter.scopeStart}`;
      if (!input.resolving.has(bindingKey)) {
        const resolving = new Set(input.resolving);
        resolving.add(bindingKey);
        for (const value of callParameterValues) {
          mergeProviderExpressionFacts(
            facts,
            inferProviderExpressionFacts({
              ...input,
              before: value.before,
              callParameterValues: value.callParameterValues,
              node: value.node,
              resolving,
            }),
          );
        }
      }
    }
    if (parameter?.propertyPath) {
      for (const property of parameter.propertyPath) {
        addExplicitProviderIds(facts, providerIdsFromIdentifier(property));
      }
      addExplicitProviderIds(
        facts,
        providerIdsFromIdentifier(parameter.propertyPath.join(".")),
      );
    }
    const bindings = resolvePossibleBindings(
      input.bindings,
      node.name,
      input.before,
    );
    for (const binding of bindings) {
      const bindingKey = `variable:${node.name}:${binding.start}`;
      if (input.resolving.has(bindingKey)) {
        continue;
      }
      const resolving = new Set(input.resolving);
      resolving.add(bindingKey);
      for (const value of readVariableBindingPossibleValues(
        binding,
        input.bindings,
        input.analysis.sourceFile,
      )) {
        mergeProviderExpressionFacts(
          facts,
          inferProviderExpressionFacts({
            ...input,
            before: binding.start - 1,
            node: value,
            resolving,
          }),
        );
      }
    }
    if (!input.suppressFileFallback) {
      addSingleProviderFileHint(
        facts.providerIds,
        node.name,
        isInsideSdkFetchAdapter(input.analysis.sourceFile, input.before)
          ? input.analysis.fileProviderIds
          : input.analysis.fileFallbackProviderIds,
      );
    }
    return facts;
  }
  if (isMemberExpression(node) || isOptionalMemberExpression(node)) {
    const pathParts = readMemberPath(node);
    if (pathParts) {
      const key = pathParts.join(".");
      addExplicitProviderIds(facts, providerIdsFromIdentifier(key));
      const bindingKey = `member:${key}`;
      if (!input.resolving.has(bindingKey)) {
        const staticInitializer = resolveStaticMemberInitializer(
          node,
          input.bindings,
          input.before,
          input.analysis.sourceFile,
        );
        const possibleInitializers = staticInitializer
          ? [staticInitializer]
          : readPossibleStaticMemberInitializers(
              node,
              input.bindings,
              input.before,
              input.analysis.sourceFile,
            );
        for (const possibleInitializer of possibleInitializers) {
          const resolving = new Set(input.resolving);
          resolving.add(bindingKey);
          mergeProviderExpressionFacts(
            facts,
            inferProviderExpressionFacts({
              ...input,
              before: node.start ?? input.before,
              node: possibleInitializer,
              resolving,
            }),
          );
        }
        const binding = resolveMemberBinding(
          input.analysis.memberBindings,
          key,
          input.before,
        );
        if (binding?.initializer) {
          const resolving = new Set(input.resolving);
          resolving.add(bindingKey);
          mergeProviderExpressionFacts(
            facts,
            inferProviderExpressionFacts({
              ...input,
              before: node.start ?? input.before,
              node: binding.initializer,
              resolving,
            }),
          );
        }
      }
      if (!input.suppressFileFallback) {
        addSingleProviderFileHint(
          facts.providerIds,
          key,
          isInsideSdkFetchAdapter(input.analysis.sourceFile, input.before)
            ? input.analysis.fileProviderIds
            : input.analysis.fileFallbackProviderIds,
        );
      }
    } else {
      mergeProviderExpressionFacts(
        facts,
        inferProviderExpressionFacts({ ...input, node: node.object }),
      );
      if (node.computed) {
        mergeProviderExpressionFacts(
          facts,
          inferProviderExpressionFacts({ ...input, node: node.property }),
        );
      }
    }
    return facts;
  }
  if (isObjectExpression(node)) {
    for (const property of node.properties) {
      if (isSpreadElement(property)) {
        mergeProviderExpressionFacts(
          facts,
          inferProviderExpressionFacts({ ...input, node: property.argument }),
        );
        continue;
      }
      if (!isObjectProperty(property)) {
        continue;
      }
      const propertyName = readPropertyName(property.key);
      if (propertyName) {
        addExplicitProviderIds(facts, providerIdsFromIdentifier(propertyName));
      }
      mergeProviderExpressionFacts(
        facts,
        inferProviderExpressionFacts({ ...input, node: property.value }),
      );
    }
    return facts;
  }
  if (node.type === "ArrayExpression") {
    for (const element of node.elements) {
      if (!element) {
        continue;
      }
      mergeProviderExpressionFacts(
        facts,
        inferProviderExpressionFacts({
          ...input,
          node: isSpreadElement(element) ? element.argument : element,
        }),
      );
    }
    return facts;
  }
  if (isNewExpression(node)) {
    addExplicitProviderIds(
      facts,
      providerIdsFromIdentifier(readNodeText(node.callee, input.contents)),
    );
    for (const argument of node.arguments) {
      if (argument && argument.type !== "ArgumentPlaceholder" && argument.type !== "SpreadElement") {
        mergeProviderExpressionFacts(
          facts,
          inferProviderExpressionFacts({ ...input, node: argument }),
        );
      }
    }
    return facts;
  }
  if (isCallExpression(node) || isOptionalCallExpression(node)) {
    addExplicitProviderIds(
      facts,
      providerIdsFromIdentifier(readNodeText(node.callee, input.contents)),
    );
    if (isMemberExpression(node.callee) || isOptionalMemberExpression(node.callee)) {
      mergeProviderExpressionFacts(
        facts,
        inferProviderExpressionFacts({ ...input, node: node.callee.object }),
      );
    }
    const callee = unwrapExpression(node.callee);
    if (isIdentifier(callee)) {
      const callableValues = readProviderCallPossibleValues({
        analysis: input.analysis,
        before: input.before,
        bindings: input.bindings,
        callParameterValues: input.callParameterValues,
        defaultCallParameterValues: undefined,
        defaultExpression: null,
        node: callee,
        propertySteps: [],
        resolving: input.resolving,
      });
      for (const callableValue of callableValues) {
        const callable = callableValue.node;
        const returnedExpressions = readDirectFunctionReturnExpressions(
          callable,
        );
        if (returnedExpressions.length === 0) {
          continue;
        }
        const callableStart = callable.start ?? 0;
        const bindingKey =
          `provider-function:${callee.name}:${callableStart}`;
        if (input.resolving.has(bindingKey)) {
          continue;
        }
        const resolving = new Set(input.resolving);
        resolving.add(bindingKey);
        const callParameterValues = readProviderCallParameterValues({
          analysis: input.analysis,
          bindings: input.bindings,
          call: node,
          callerParameterValues: input.callParameterValues,
          callable,
        });
        for (const returned of returnedExpressions) {
          mergeProviderExpressionFacts(
            facts,
            inferProviderExpressionFacts({
              ...input,
              before: returned.start ?? callableStart,
              callParameterValues,
              node: returned,
              resolving,
              suppressFileFallback: true,
            }),
          );
        }
      }
    }
    for (const argument of node.arguments) {
      if (argument.type !== "ArgumentPlaceholder" && argument.type !== "SpreadElement") {
        mergeProviderExpressionFacts(
          facts,
          inferProviderExpressionFacts({ ...input, node: argument }),
        );
      }
    }
    return facts;
  }

  switch (node.type) {
    case "AssignmentExpression":
      return inferProviderExpressionFacts({ ...input, node: node.right });
    case "AwaitExpression":
      return inferProviderExpressionFacts({ ...input, node: node.argument });
    case "BinaryExpression":
    case "LogicalExpression":
      mergeProviderExpressionFacts(
        facts,
        inferProviderExpressionFacts({ ...input, node: node.left }),
      );
      mergeProviderExpressionFacts(
        facts,
        inferProviderExpressionFacts({ ...input, node: node.right }),
      );
      return facts;
    case "ConditionalExpression":
      mergeProviderExpressionFacts(
        facts,
        inferProviderExpressionFacts({ ...input, node: node.consequent }),
      );
      mergeProviderExpressionFacts(
        facts,
        inferProviderExpressionFacts({ ...input, node: node.alternate }),
      );
      return facts;
    case "SequenceExpression":
      for (const expression of node.expressions) {
        mergeProviderExpressionFacts(
          facts,
          inferProviderExpressionFacts({ ...input, node: expression }),
        );
      }
      return facts;
    case "TaggedTemplateExpression":
      addExplicitProviderIds(
        facts,
        providerIdsFromIdentifier(readNodeText(node.tag, input.contents)),
      );
      mergeProviderExpressionFacts(
        facts,
        inferProviderExpressionFacts({ ...input, node: node.quasi }),
      );
      return facts;
    default:
      return facts;
  }
}

function emptyProviderExpressionFacts(): ProviderExpressionFacts {
  return {
    explicitProviderIds: new Set<string>(),
    providerIds: new Set<string>(),
  };
}

function addExplicitProviderIds(
  facts: ProviderExpressionFacts,
  providerIds: Iterable<string>,
): void {
  addProviderIds(facts.explicitProviderIds, providerIds);
  addProviderIds(facts.providerIds, providerIds);
}

function mergeProviderExpressionFacts(
  target: ProviderExpressionFacts,
  source: ProviderExpressionFacts,
): void {
  addProviderIds(target.explicitProviderIds, source.explicitProviderIds);
  addProviderIds(target.providerIds, source.providerIds);
}

interface RegisteredProviderHttpExceptionInput {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly call: CallExpression | OptionalCallExpression;
  readonly contents: string;
  readonly initArgument: Node | null;
  readonly provider: RegisteredProviderBoundary;
  readonly relativePath: string;
  readonly urlArgument: Node;
  readonly urlFacts: ProviderExpressionFacts;
}

function matchesRegisteredProviderHttpException(
  input: RegisteredProviderHttpExceptionInput,
): boolean {
  return providerHttpExceptionRegistry.some((exception) => {
    switch (exception.id) {
      case "presigned-byte-transfer":
        return isPresignedByteTransfer(input);
      case "internal-same-origin":
        return input.urlFacts.explicitProviderIds.size === 0 &&
          isInternalSameOriginRequest({
            analysis: input.analysis,
            before: input.call.start ?? Number.MAX_SAFE_INTEGER,
            bindings: input.bindings,
            contents: input.contents,
            node: input.urlArgument,
            resolving: new Set(),
          });
      case "xai-x-search-responses":
        return isXaiXSearchResponsesRequest(input);
      case "official-sdk-fetch-hook":
        return isOfficialSdkFetchHook(input);
      case "resend-sdk-fetch-request-override":
        return isResendSdkFetchRequestOverride(input);
      case "exa-sdk-request-override":
        return isExaSdkRequestOverride(input);
    }
  });
}

const officialSdkFetchHookApprovals = Object.freeze([
  {
    adapterReferenceMode: "exclusive-sdk-wiring",
    authorityFileSha256: null,
    authorityFunctions: [
      {
        functionName: "mapOperatorLinqSdkUrl",
        implementationSha256:
          "8e0c0f007664e393fde2e077fdb707ee38bbb110ed1380027ee6c06a5161cd72",
      },
      {
        functionName: "encodeOperatorLinqSdkPath",
        implementationSha256:
          "cf853616b399448d143130044cb51b9b975f8042a7821dbd90c08b640bda2efe",
      },
      {
        functionName: "normalizeOperatorLinqApiRoot",
        implementationSha256:
          "a44fd4146acc1fbc513035a6bef13bfa82bcb3c4a8da9a52bc101fcf3608c869",
      },
    ],
    functionName: "createOperatorLinqFetch",
    implementationSha256:
      "db8252a4862fc54c7992ef719a4dedddcfc250e34a8ad6a9b77e1081cab8ce18",
    moduleName: "@linqapp/sdk",
    providerId: "linq",
    relativePath: "apps/cloudflare/src/operator-alert/linq.ts",
    sdkBindingName: "LinqAPIV3",
    transportPath: "fetchImplementation",
    wiringFunctionName: "createOperatorLinqClient",
    wiringImplementationSha256:
      "48f6cde07d60d37abe5a9c18f34d9f91bc39e028688c33b535181bc63fd8a48f",
  },
  {
    adapterReferenceMode: "exclusive-sdk-wiring",
    authorityFileSha256: null,
    authorityFunctions: [
      {
        functionName: "preserveRepeatedComposioListQueryParams",
        implementationSha256:
          "83f9d9242cfd7cce27b9e6058dd0e85b04c20b2e293888e4b88e0ac5336f1c2d",
      },
    ],
    functionName: "createBoundedComposioFetch",
    implementationSha256:
      "34d29361fbc5bf27dc4d91b00da6bdae98b4d32f18fd43da3eed21abccf56c28",
    moduleName: "@composio/client",
    providerId: "composio",
    relativePath: "apps/web/src/lib/connected-apps/composio.ts",
    sdkBindingName: "Composio",
    transportPath: "fetchImpl",
    wiringFunctionName: "createComposioConnectedAppsClient",
    wiringImplementationSha256:
      "48e86be84700a2922eb1c06d954178c7138405d1e9185bff9c9a7036f3962276",
  },
  {
    adapterReferenceMode: "exclusive-sdk-wiring",
    authorityFileSha256: null,
    authorityFunctions: [],
    functionName: "createHostedFirstContactAdmissionOpenAiFetch",
    implementationSha256:
      "3961d54845bd37ca2638f9294bd1a063a15376c3a1e07117a650c2b380c27d27",
    moduleName: "openai",
    providerId: "openai",
    relativePath:
      "apps/web/src/lib/hosted-onboarding/linq-first-contact-admission.ts",
    sdkBindingName: "OpenAI",
    transportPath: "fetchImpl.call",
    wiringFunctionName: "classifyHostedLinqFirstContactAdmission",
    wiringImplementationSha256:
      "c03d60638053bf2cb07fc2afb8b5b9c6753fad2c32078acad5c1b3c55fac4096",
  },
  {
    adapterReferenceMode: "same-owner",
    authorityFileSha256: "69eb35e89271588cbfa8d1866aecd4371ab53297ccbe29cbbdbde524ff74efc9",
    authorityFunctions: [],
    functionName: "requestJunctionResource",
    implementationSha256:
      "6a19d0dd8cf5de40b16c918065d523a2389cbcf1c1f8e2e7b1b9ebba5be2755d",
    moduleName: "@junction-api/sdk",
    providerId: "junction",
    relativePath: "apps/web/src/lib/labs/junction.ts",
    sdkBindingName: "JunctionSdkClient",
    transportPath: "runtime.fetchImpl",
    wiringFunctionName: "requestJunctionResource",
    wiringImplementationSha256:
      "6a19d0dd8cf5de40b16c918065d523a2389cbcf1c1f8e2e7b1b9ebba5be2755d",
  },
  {
    adapterReferenceMode: "exclusive-sdk-wiring",
    authorityFileSha256: null,
    authorityFunctions: [
      {
        functionName: "normalizeLinqApiRoot",
        implementationSha256:
          "a46bfdb41fcd63b5521b0ab8d74dfc6acc74b0dec9709d7bce890618d6e2138b",
      },
      {
        functionName: "mapLinqSdkRequestUrl",
        implementationSha256:
          "ac0ee287824aef5e1ff1418192d15f57c726c0eac8a96ce01d7d76bdddfd31e8",
      },
      {
        functionName: "encodeLinqSdkPath",
        implementationSha256:
          "0ef44b1e5f588c490c6212999330cfa85acad4b35e1c854ac8b779994ecec0c3",
      },
      {
        functionName: "normalizeLinqSdkRequestHeaders",
        implementationSha256:
          "f67e562891bc67f7a5996b5542d0dcf11c64031c017a9f4afd45feca2c6e5ecb",
      },
    ],
    functionName: "createBoundedLinqApiFetch",
    implementationSha256:
      "2ba9401aa75e438bd9ac8ff084ddecd5072c9eb2e801f2334537f6f071c43818",
    moduleName: "@linqapp/sdk",
    providerId: "linq",
    relativePath: "apps/web/src/lib/linq/api.ts",
    sdkBindingName: "LinqAPIV3",
    transportPath: "fetchImplementation.call",
    wiringFunctionName: "createLinqApiClientWithState",
    wiringImplementationSha256:
      "a6621c48e90cce711fdb7f3c20b57c9822e411f7982e1bfd5006e855127c26f0",
  },
  {
    adapterReferenceMode: "exclusive-sdk-wiring",
    authorityFileSha256: null,
    authorityFunctions: [
      {
        functionName: "readLobRequestUrl",
        implementationSha256:
          "aa96a348761c2a8289634856768a83b9b17a1e6f612ff79b8c8d2849a8bc3784",
      },
      {
        functionName: "appendLobRequestParams",
        implementationSha256:
          "5e27e58bdd901c33fa612e6238dd1fea7bfc2bfcfb72187667ba1dfb14176ae2",
      },
      {
        functionName: "readLobRequestHeaders",
        implementationSha256:
          "079bb55a8a666ccafb2d01863654c176602577c90b2d208e8f53c23af05069e7",
      },
      {
        functionName: "readLobRequestBody",
        implementationSha256:
          "6b0238b1207b54b62725a8e51599d6aea2f64e54bd37b8776021b594856568e9",
      },
      {
        functionName: "requireValue",
        implementationSha256:
          "7e40229d02805d134ec334284dc265fb0501799d5b1faa9d60a13ae275766f54",
      },
    ],
    functionName: "createLobFetchAdapter",
    implementationSha256:
      "df849b52e90d331b52e2e913b030dd85ece18652e1a8302971698f29bbfb48fe",
    moduleName: "@lob/lob-typescript-sdk",
    providerId: "lob",
    relativePath: "apps/web/src/lib/physical-notes/lob-runtime.ts",
    sdkBindingName: "Configuration",
    transportPath: "fetchImpl",
    wiringFunctionName: "createLobLettersApi",
    wiringImplementationSha256:
      "1b015ed2300bc58c6f45255a1de5db6a976d148cc6cc6604698c0cbb9a9a9260",
  },
  {
    adapterReferenceMode: "exclusive-sdk-wiring",
    authorityFileSha256: null,
    authorityFunctions: [],
    functionName: "createTelegramElevenLabsSdkFetchAdapter",
    implementationSha256:
      "00c46bb135d79635b9a71c5282042f8fa92f92226beab6f8d249fc0de63d950e",
    moduleName: "@murphai/operator-config/elevenlabs-runtime",
    providerId: "elevenlabs",
    relativePath: "packages/assistant-engine/src/assistant/channels/runtime.ts",
    sdkBindingName: "generateElevenLabsVoiceMemoAudio",
    transportPath: "fetchImplementation",
    wiringFunctionName: "prepareTelegramVoiceMemoMessage",
    wiringImplementationSha256:
      "0e77b3d385280e9c07b3d1a3d9990031f3503dce9d13c32c85946e00a2d67342",
  },
  {
    adapterReferenceMode: "exclusive-sdk-wiring",
    authorityFileSha256: null,
    authorityFunctions: [],
    functionName: "createOpenAiImageSdkFetch",
    implementationSha256:
      "b0d6c3b84cf1868b281e9f264ec2269345fab23c22972329ecbcdd3cf8d0d3a0",
    moduleName: "openai",
    providerId: "openai",
    relativePath:
      "packages/assistant-engine/src/assistant-codex/openai-image-generation.ts",
    sdkBindingName: "OpenAI",
    transportPath: "fetchImpl.call",
    wiringFunctionName: "requestOpenAiImage",
    wiringImplementationSha256:
      "af0552a002f890cd69cd0d32bebc04f176d651acf504f45b03398518006fc48f",
  },
  {
    adapterReferenceMode: "same-owner",
    authorityFileSha256: "ed96eb5527c8bc10bd77653f1fcd5ad0bd7e2edced7737e5a859c7fb4d661929",
    authorityFunctions: [],
    functionName: "requestSdkResource",
    implementationSha256:
      "d2b290aebff0879e53a88d61e9ebc573a6fa0e102d69a0116b2b746adc5efcab",
    moduleName: "@junction-api/sdk/activity",
    providerId: "junction",
    relativePath: "packages/device-syncd/src/providers/junction-client.ts",
    sdkBindingName: "ActivityClient",
    transportPath: "this.fetchImpl",
    wiringFunctionName: "requestSdkResource",
    wiringImplementationSha256:
      "d2b290aebff0879e53a88d61e9ebc573a6fa0e102d69a0116b2b746adc5efcab",
  },
  {
    adapterReferenceMode: "exclusive-sdk-wiring",
    authorityFileSha256: null,
    authorityFunctions: [
      {
        functionName: "readRequestInput",
        implementationSha256:
          "69a164a38ce63d1ea9a2a52e7184ab36d0e19439ef9af68c8210b5e7111f6c8c",
      },
      {
        functionName: "mergeFetchHeaders",
        implementationSha256:
          "4b68fcdb12bffeb4facb17dc8030f2f0423150a7c8555f740cfc86583947c0e2",
      },
      {
        functionName: "readSdkRequestBody",
        implementationSha256:
          "6ac5ad48125ed41df6d7e8d13d353b38ee8375c5dbd4447cf7f5cdf750b8e6ee",
      },
    ],
    functionName: "createElevenLabsSdkFetch",
    implementationSha256:
      "7cb128bcd93285b69daac64e5e85660d7fce775c940095c22f3efaf5d9930f7b",
    moduleName: "@elevenlabs/elevenlabs-js",
    providerId: "elevenlabs",
    relativePath: "packages/operator-config/src/elevenlabs-runtime.ts",
    sdkBindingName: "ElevenLabsClient",
    transportPath: "fetchImplementation",
    wiringFunctionName: "requestElevenLabsAudio",
    wiringImplementationSha256:
      "19d13521b2450550504a1bff4c5c13f3524280481ecc0bdf3fdecdb63f630c82",
  },
  {
    adapterReferenceMode: "exclusive-sdk-wiring",
    authorityFileSha256: null,
    authorityFunctions: [
      {
        functionName: "mapLinqSdkRequestUrl",
        implementationSha256:
          "88586ecbb4297525633f73bd1a9e287cc6f812fbe71ed475b4f3bb4f7ed02be3",
      },
      {
        functionName: "encodeLinqSdkPath",
        implementationSha256:
          "4195abfebfa4b4021361da9bd74cd32aa8485f6276ab0ccf1641a65d0fb9dd91",
      },
      {
        functionName: "normalizeLinqSdkRequestBody",
        implementationSha256:
          "4335dd261a3b8ed15a42d561a32ab61a6c9c615247dda1077c6358f80f5d2a9c",
      },
      {
        functionName: "normalizeLinqSdkRequestHeaders",
        implementationSha256:
          "06a9c99b8ab65647756bcd936a035793d83aa49a17ae8ae67dab22d7cdad972e",
      },
      {
        functionName: "normalizeLinqBaseUrl",
        implementationSha256:
          "3411305d54133d6338da4a9b9fa4c64cb41f6717396fbac1b1736550a4716b94",
      },
      {
        functionName: "buildLinqRequestUrl",
        implementationSha256:
          "44d1e5bbf008220258181aca60d0b4b934dc0317cf0992cfa9b687779f456a2f",
      },
    ],
    functionName: "createLinqSdkFetch",
    implementationSha256:
      "b34861eaad1627d9b3de85dcc276a8488eab49bb73b6f45c54907497d0b38a84",
    moduleName: "@linqapp/sdk",
    providerId: "linq",
    relativePath: "packages/operator-config/src/linq-runtime.ts",
    sdkBindingName: "LinqAPIV3",
    transportPath: "input.fetchImplementation.call",
    wiringFunctionName: "createLinqSdkClient",
    wiringImplementationSha256:
      "ad6858d90043a7253d5c37a66f4346479739a0ba8b32a2fc0a391134ad712b56",
  },
] as const);

function isOfficialSdkFetchHook(
  input: RegisteredProviderHttpExceptionInput,
): boolean {
  const approval = officialSdkFetchHookApprovals.find(
    (candidate) =>
      candidate.providerId === input.provider.id &&
      candidate.relativePath === normalizeRepoPath(input.relativePath),
  );
  if (
    !approval ||
    !hasExactRuntimeProviderImport(
      input.analysis.sourceFile,
      approval.moduleName,
      approval.sdkBindingName,
    ) ||
    readMemberPath(input.call.callee)?.join(".") !== approval.transportPath
  ) {
    return false;
  }
  const owner = findExactApprovedFunctionRange({
    functionName: approval.functionName,
    position: input.call.start ?? Number.MAX_SAFE_INTEGER,
    sourceFile: input.analysis.sourceFile,
  });
  const wiringOwner = findExactApprovedFunctionRange({
    functionName: approval.wiringFunctionName,
    sourceFile: input.analysis.sourceFile,
  });
  return Boolean(
    owner &&
    hasExactSourceHash(input.contents, owner, approval.implementationSha256) &&
    wiringOwner &&
    hasExactSourceHash(
      input.contents,
      wiringOwner,
      approval.wiringImplementationSha256,
    ) &&
    (
      approval.authorityFileSha256 === null
        ? hasExactApprovedAuthorityFunctions({
            approvals: approval.authorityFunctions,
            contents: input.contents,
            sourceFile: input.analysis.sourceFile,
          })
        : hasExactContentsHash(
            input.contents,
            approval.authorityFileSha256,
          )
    ) &&
    (
      approval.authorityFileSha256 !== null ||
      hasIdentifierInsideRange(
        input.analysis.sourceFile,
        approval.sdkBindingName,
        wiringOwner,
      )
    ) &&
    (
      approval.adapterReferenceMode === "same-owner"
        ? owner.start === wiringOwner.start && owner.end === wiringOwner.end
        : hasExclusiveAdapterWiringReference({
            functionName: approval.functionName,
            owner,
            sourceFile: input.analysis.sourceFile,
            wiringOwner,
          })
    ),
  );
}

function hasExactApprovedAuthorityFunctions(input: {
  readonly approvals: readonly {
    readonly functionName: string;
    readonly implementationSha256: string;
  }[];
  readonly contents: string;
  readonly sourceFile: Node;
}): boolean {
  return input.approvals.every((approval) => {
    const range = findExactApprovedFunctionRange({
      functionName: approval.functionName,
      sourceFile: input.sourceFile,
    });
    return Boolean(
      range &&
      hasExactSourceHash(
        input.contents,
        range,
        approval.implementationSha256,
      ),
    );
  });
}

function hasExclusiveAdapterWiringReference(input: {
  readonly functionName: string;
  readonly owner: LocalFunctionRange;
  readonly sourceFile: Node;
  readonly wiringOwner: LocalFunctionRange;
}): boolean {
  const outsideOwnerReferences: Node[] = [];
  traverseFast(input.sourceFile, (node) => {
    if (
      isIdentifier(node, { name: input.functionName }) &&
      (
        (node.start ?? 0) < input.owner.start ||
        (node.end ?? Number.MAX_SAFE_INTEGER) > input.owner.end
      )
    ) {
      outsideOwnerReferences.push(node);
    }
  });
  const [reference] = outsideOwnerReferences;
  return outsideOwnerReferences.length === 1 &&
    Boolean(
      reference &&
      input.wiringOwner.start <= (reference.start ?? 0) &&
      (reference.end ?? Number.MAX_SAFE_INTEGER) <= input.wiringOwner.end,
    );
}

function hasIdentifierInsideRange(
  sourceFile: Node,
  name: string,
  range: LocalFunctionRange,
): boolean {
  let matches = 0;
  traverseFast(sourceFile, (node) => {
    if (
      isIdentifier(node, { name }) &&
      range.start <= (node.start ?? 0) &&
      (node.end ?? Number.MAX_SAFE_INTEGER) <= range.end
    ) {
      matches += 1;
    }
  });
  return matches >= 1;
}

function findExactApprovedFunctionRange(input: {
  readonly functionName: string;
  readonly position?: number;
  readonly sourceFile: Node;
}): LocalFunctionRange | null {
  const matches = collectLocalFunctionRanges(input.sourceFile).filter(
    (range) => range.name === input.functionName,
  );
  const owner = matches.length === 1 ? matches[0] ?? null : null;
  return owner && input.position !== undefined &&
      !(owner.start <= input.position && input.position <= owner.end)
    ? null
    : owner;
}

function hasExactSourceHash(
  contents: string,
  range: LocalFunctionRange,
  expectedSha256: string,
): boolean {
  return createHash("sha256")
    .update(contents.slice(range.start, range.end))
    .digest("hex") === expectedSha256;
}

function hasExactContentsHash(
  contents: string,
  expectedSha256: string,
): boolean {
  return createHash("sha256").update(contents).digest("hex") ===
    expectedSha256;
}

function isResendSdkFetchRequestOverride(
  input: RegisteredProviderHttpExceptionInput,
): boolean {
  if (
    input.provider.id !== "resend" ||
    normalizeRepoPath(input.relativePath) !==
      "apps/web/src/lib/hosted-onboarding/resend-plain-text-email.ts" ||
    readMemberPath(input.call.callee)?.join(".") !== "this.fetchImpl" ||
    !isInsideExactSdkSubclassMethod({
      analysis: input.analysis,
      baseClassName: "Resend",
      call: input.call,
      className: "HostedResendClient",
      methodName: "fetchRequest",
      moduleName: "resend",
    }) ||
    !isApprovedResendRequestUrl(input)
  ) {
    return false;
  }
  const initArgument = input.initArgument;
  if (
    !initArgument ||
    initArgument.type === "SpreadElement"
  ) {
    return false;
  }
  return isApprovedResendRequestInit(input);
}

function isApprovedResendRequestUrl(
  input: RegisteredProviderHttpExceptionInput,
): boolean {
  const url = unwrapExpression(input.urlArgument);
  if (
    !isTemplateLiteral(url) ||
    url.expressions.length !== 2 ||
    url.quasis.some((quasi) => (quasi.value.cooked ?? "") !== "") ||
    readMemberPath(url.expressions[0] ?? ({ type: "NullLiteral" } as Node))
      ?.join(".") !== "this.baseUrl"
  ) {
    return false;
  }
  const requestPath = url.expressions[1];
  if (!requestPath || !isIdentifier(requestPath, { name: "requestPath" })) {
    return false;
  }
  const binding = resolveBinding(
    input.bindings,
    requestPath.name,
    input.call.start ?? Number.MAX_SAFE_INTEGER,
  );
  if (!binding?.definitive) {
    return false;
  }
  const initializer = unwrapExpression(binding.initializer);
  if (
    initializer.type !== "ConditionalExpression" ||
    !isIdentifier(initializer.consequent, { name: "path" }) ||
    initializer.alternate.type !== "NullLiteral"
  ) {
    return false;
  }
  const test = unwrapExpression(initializer.test);
  if (test.type !== "LogicalExpression" || test.operator !== "||") {
    return false;
  }
  return isExactIdentifierConstantComparison({
    bindings: input.bindings,
    before: binding.start,
    constantName: "RESEND_EMAILS_PATH",
    identifierName: "path",
    node: test.left,
    value: "/emails",
  }) && isExactIdentifierConstantComparison({
    bindings: input.bindings,
    before: binding.start,
    constantName: "RESEND_BATCH_EMAILS_PATH",
    identifierName: "path",
    node: test.right,
    value: "/emails/batch",
  });
}

function isApprovedResendRequestInit(
  input: RegisteredProviderHttpExceptionInput,
): boolean {
  const initArgument = input.initArgument;
  if (!initArgument || initArgument.type === "SpreadElement") {
    return false;
  }
  const properties = readClosedObjectProperties(unwrapExpression(initArgument));
  return Boolean(
    properties &&
    properties.size === 5 &&
    readMemberPath(properties.get("body")?.value ?? ({
      type: "NullLiteral",
    } as Node))?.join(".") === "options.body" &&
    isExactCallWithMemberArgument(
      properties.get("headers")?.value ?? ({ type: "NullLiteral" } as Node),
      "normalizeResendRequestHeaders",
      "options.headers",
    ) &&
    readMemberPath(properties.get("method")?.value ?? ({
      type: "NullLiteral",
    } as Node))?.join(".") === "options.method" &&
    isStringLiteral(properties.get("redirect")?.value, { value: "error" }) &&
    readMemberPath(properties.get("signal")?.value ?? ({
      type: "NullLiteral",
    } as Node))?.join(".") === "this.requestSignal",
  );
}

function isExaSdkRequestOverride(
  input: RegisteredProviderHttpExceptionInput,
): boolean {
  if (
    input.provider.id !== "exa" ||
    normalizeRepoPath(input.relativePath) !==
      "packages/cli/src/research-scout-client.ts" ||
    readMemberPath(input.call.callee)?.join(".") !== "this.fetchImpl" ||
    !isInsideExactSdkSubclassMethod({
      analysis: input.analysis,
      baseClassName: "Exa",
      call: input.call,
      className: "RunnerScopedExaClient",
      methodName: "request",
      moduleName: "exa-js",
    }) ||
    !isApprovedExaRequestUrl(input)
  ) {
    return false;
  }
  const initArgument = input.initArgument;
  if (!initArgument || initArgument.type === "SpreadElement") {
    return false;
  }
  const properties = readClosedObjectProperties(unwrapExpression(initArgument));
  if (!properties || properties.size !== 5) {
    return false;
  }
  const before = input.call.start ?? Number.MAX_SAFE_INTEGER;
  const headers = properties.get("headers")?.value;
  const headerProperties = headers ? readClosedObjectProperties(headers) : null;
  return Boolean(
    properties.get("method") &&
    isStringLiteral(properties.get("method")!.value, { value: "POST" }),
  ) &&
    Boolean(
      headerProperties &&
      headerProperties.size === 3 &&
      isStringLiteral(headerProperties.get("accept")?.value, {
        value: "application/json",
      }) &&
      isStringLiteral(headerProperties.get("content-type")?.value, {
        value: "application/json; charset=utf-8",
      }) &&
      readMemberPath(headerProperties.get("x-api-key")?.value ?? ({
        type: "NullLiteral",
      } as Node))?.join(".") === "this.apiKey",
    ) &&
    isExactJsonStringifyOfParameter({
      analysis: input.analysis,
      before,
      bindings: input.bindings,
      node: properties.get("body")?.value,
      parameterName: "body",
    }) &&
    isStringLiteral(properties.get("redirect")?.value, { value: "error" }) &&
    isIdentifier(properties.get("signal")?.value, { name: "requestSignal" });
}

function isApprovedExaRequestUrl(
  input: RegisteredProviderHttpExceptionInput,
): boolean {
  const url = unwrapExpression(input.urlArgument);
  return isStringLiteral(url, { value: "https://api.exa.ai/search" });
}

function isInsideExactSdkSubclassMethod(input: {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly baseClassName: string;
  readonly call: CallExpression | OptionalCallExpression;
  readonly className: string;
  readonly methodName: string;
  readonly moduleName: string;
}): boolean {
  if (!hasExactNamedProviderImport(
    input.analysis.sourceFile,
    input.moduleName,
    input.baseClassName,
  )) {
    return false;
  }
  const position = input.call.start ?? 0;
  let matches = 0;
  traverseFast(input.analysis.sourceFile, (node) => {
    if (
      node.type !== "ClassDeclaration" ||
      node.id?.name !== input.className ||
      !isIdentifier(node.superClass, { name: input.baseClassName }) ||
      (node.start ?? 0) > position ||
      position > (node.end ?? Number.MAX_SAFE_INTEGER)
    ) {
      return;
    }
    for (const member of node.body.body) {
      if (
        member.type === "ClassMethod" &&
        readPropertyName(member.key) === input.methodName &&
        (member.start ?? 0) <= position &&
        position <= (member.end ?? Number.MAX_SAFE_INTEGER)
      ) {
        matches += 1;
      }
    }
  });
  return matches === 1;
}

function hasExactRuntimeProviderImport(
  sourceFile: Node,
  moduleName: string,
  localName: string,
): boolean {
  let matches = 0;
  traverseFast(sourceFile, (node) => {
    if (
      isImportDeclaration(node) &&
      node.importKind !== "type" &&
      node.source.value === moduleName
    ) {
      for (const specifier of node.specifiers) {
        if (
          specifier.local.name === localName &&
          (!isImportSpecifier(specifier) || specifier.importKind !== "type")
        ) {
          matches += 1;
        }
      }
    }
  });
  return matches === 1;
}

function hasExactNamedProviderImport(
  sourceFile: Node,
  moduleName: string,
  importedName: string,
): boolean {
  let matches = 0;
  traverseFast(sourceFile, (node) => {
    if (!isImportDeclaration(node) || node.source.value !== moduleName) {
      return;
    }
    for (const specifier of node.specifiers) {
      if (
        isImportSpecifier(specifier) &&
        readImportedName(specifier) === importedName &&
        specifier.local.name === importedName
      ) {
        matches += 1;
      }
    }
  });
  return matches === 1;
}

function isExactFunctionParameter(
  analysis: ProviderHttpSourceAnalysis,
  node: Node,
  before: number,
  name: string,
): boolean {
  const expression = unwrapExpression(node);
  if (!isIdentifier(expression, { name })) {
    return false;
  }
  const binding = resolveParameterBinding(
    analysis.parameterBindings,
    name,
    before,
  );
  return Boolean(
    binding &&
    binding.defaultExpression === null &&
    binding.propertyPath === null,
  );
}

function isExactIdentifierConstantComparison(input: {
  readonly before: number;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly constantName: string;
  readonly identifierName: string;
  readonly node: Node;
  readonly value: string;
}): boolean {
  const comparison = unwrapExpression(input.node);
  if (comparison.type !== "BinaryExpression" || comparison.operator !== "===") {
    return false;
  }
  return isIdentifier(comparison.left, { name: input.identifierName }) &&
    isExactConstantIdentifier({
      bindings: input.bindings,
      before: input.before,
      name: input.constantName,
      node: comparison.right,
      value: input.value,
    });
}

function isExactConstantIdentifier(input: {
  readonly before: number;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly name: string;
  readonly node: Node | undefined;
  readonly value: string;
}): boolean {
  if (!input.node || !isIdentifier(unwrapExpression(input.node), {
    name: input.name,
  })) {
    return false;
  }
  const binding = resolveBinding(input.bindings, input.name, input.before);
  return Boolean(
    binding?.definitive &&
    isStringLiteral(unwrapExpression(binding.initializer), {
      value: input.value,
    }),
  );
}

function isExactCallWithMemberArgument(
  node: Node,
  calleeName: string,
  argumentPath: string,
): boolean {
  const expression = unwrapExpression(node);
  if (
    !isCallExpression(expression) ||
    !isIdentifier(unwrapExpression(expression.callee), { name: calleeName }) ||
    expression.arguments.length !== 1
  ) {
    return false;
  }
  const argument = expression.arguments[0];
  return Boolean(
    argument &&
    argument.type !== "ArgumentPlaceholder" &&
    argument.type !== "SpreadElement" &&
    readMemberPath(argument)?.join(".") === argumentPath,
  );
}

function isExactJsonStringifyOfParameter(input: {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly before: number;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly node: Node | undefined;
  readonly parameterName: string;
}): boolean {
  if (!input.node || !isUnshadowedGlobalIdentifier({
    analysis: input.analysis,
    before: input.before,
    bindings: input.bindings,
    name: "JSON",
  })) {
    return false;
  }
  const expression = unwrapExpression(input.node);
  if (
    !isCallExpression(expression) ||
    readMemberPath(expression.callee)?.join(".") !== "JSON.stringify" ||
    expression.arguments.length !== 1
  ) {
    return false;
  }
  const argument = expression.arguments[0];
  return Boolean(
    argument &&
    argument.type !== "ArgumentPlaceholder" &&
    argument.type !== "SpreadElement" &&
    isExactFunctionParameter(
      input.analysis,
      argument,
      input.before,
      input.parameterName,
    ),
  );
}

function isInternalSameOriginRequest(input: {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly before: number;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly contents: string;
  readonly node: Node;
  readonly resolving: ReadonlySet<string>;
}): boolean {
  const expression = unwrapExpression(input.node);
  if (isAssignmentExpression(expression) && expression.operator === "=") {
    return isInternalSameOriginRequest({ ...input, node: expression.right });
  }
  if (isStringLiteral(expression)) {
    return isInternalUrlText(expression.value);
  }
  if (isTemplateLiteral(expression)) {
    return expression.expressions.length === 0 &&
      isInternalUrlText(expression.quasis[0]?.value.cooked ?? "");
  }
  if (isIdentifier(expression)) {
    const key = `internal:${expression.name}`;
    if (input.resolving.has(key)) {
      return false;
    }
    const binding = resolveBinding(input.bindings, expression.name, input.before);
    if (!binding?.definitive) {
      return false;
    }
    const resolving = new Set(input.resolving);
    resolving.add(key);
    return isInternalSameOriginRequest({
      ...input,
      before: expression.start ?? input.before,
      node: binding.initializer,
      resolving,
    });
  }
  if (isNewExpression(expression)) {
    const callee = readNodeText(expression.callee, input.contents);
    if (
      callee !== "URL" ||
      !isUnshadowedGlobalIdentifier({
        analysis: input.analysis,
        before: input.before,
        bindings: input.bindings,
        name: "URL",
      })
    ) {
      return false;
    }
    const firstArgument = expression.arguments[0];
    const secondArgument = expression.arguments[1];
    if (
      !firstArgument ||
      firstArgument.type === "ArgumentPlaceholder" ||
      firstArgument.type === "SpreadElement"
    ) {
      return false;
    }
    if (
      isInternalSameOriginRequest({ ...input, node: firstArgument }) &&
      secondArgument &&
      secondArgument.type !== "ArgumentPlaceholder" &&
      secondArgument.type !== "SpreadElement"
    ) {
      const baseText = readNodeText(secondArgument, input.contents);
      return baseText === "location.origin" &&
        isUnshadowedGlobalIdentifier({
          analysis: input.analysis,
          before: input.before,
          bindings: input.bindings,
          name: "location",
        });
    }
    return false;
  }
  const text = readNodeText(expression, input.contents);
  return text === "location.origin" &&
    isUnshadowedGlobalIdentifier({
      analysis: input.analysis,
      before: input.before,
      bindings: input.bindings,
      name: "location",
    });
}

function isUnshadowedGlobalIdentifier(input: {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly before: number;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly name: string;
}): boolean {
  const variableInScope = input.bindings.get(input.name)?.some(
    (binding) =>
      binding.scopeStart <= input.before && input.before <= binding.scopeEnd,
  ) ?? false;
  const lexicalBindingInScope = input.analysis.transportBindings.get(input.name)?.some(
    (binding) =>
      binding.scopeStart <= input.before && input.before <= binding.scopeEnd,
  ) ?? false;
  return !resolveParameterBinding(
    input.analysis.parameterBindings,
    input.name,
    input.before,
  ) &&
    !variableInScope &&
    !resolveFunctionBinding(
      input.analysis.functionBindings,
      input.name,
      input.before,
    ) &&
    !lexicalBindingInScope;
}

function isInternalUrlText(value: string): boolean {
  return /^\/(?![\\/])/u.test(value) ||
    /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::[0-9]+)?(?:\/|$)/u.test(
      value,
    );
}

function isXaiXSearchResponsesRequest(input: {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly call: CallExpression | OptionalCallExpression;
  readonly initArgument: Node | null;
  readonly provider: RegisteredProviderBoundary;
  readonly relativePath: string;
  readonly urlArgument: Node;
}): boolean {
  if (
    input.provider.id !== "xai" ||
    normalizeRepoPath(input.relativePath) !==
      "packages/assistant-engine/src/assistant-codex/ask-grok-tool.ts" ||
    !isStringLiteral(input.urlArgument, {
      value: "https://api.x.ai/v1/responses",
    })
  ) {
    return false;
  }

  const before = input.call.start ?? Number.MAX_SAFE_INTEGER;
  if (!isUnshadowedGlobalIdentifier({
    analysis: input.analysis,
    before,
    bindings: input.bindings,
    name: "JSON",
  })) {
    return false;
  }

  const initArgument = input.initArgument;
  if (!initArgument || initArgument.type === "SpreadElement") {
    return false;
  }
  const init = unwrapExpression(initArgument);
  if (!isObjectExpression(init)) {
    return false;
  }
  const initProperties = readClosedObjectProperties(init);
  const method = initProperties?.get("method")?.value;
  const body = initProperties?.get("body")?.value;
  if (!method || !isStringLiteral(method, { value: "POST" }) || !body) {
    return false;
  }
  const bodyExpression = unwrapExpression(body);
  if (
    !isCallExpression(bodyExpression) ||
    readMemberPath(bodyExpression.callee)?.join(".") !== "JSON.stringify" ||
    bodyExpression.arguments.length !== 1
  ) {
    return false;
  }
  const payload = bodyExpression.arguments[0];
  if (!payload || payload.type === "SpreadElement" || !isObjectExpression(payload)) {
    return false;
  }
  const payloadProperties = readClosedObjectProperties(payload);
  const tools = payloadProperties?.get("tools")?.value;
  const store = payloadProperties?.get("store")?.value;
  if (
    !tools ||
    tools.type !== "ArrayExpression" ||
    tools.elements.length !== 1 ||
    !store ||
    store.type !== "BooleanLiteral" ||
    store.value !== false
  ) {
    return false;
  }
  const tool = tools.elements[0];
  if (!tool || tool.type === "SpreadElement" || !isObjectExpression(tool)) {
    return false;
  }
  const type = readClosedObjectProperties(tool)?.get("type")?.value;
  return Boolean(type && isStringLiteral(type, { value: "x_search" }));
}

function readClosedObjectProperties(
  object: Node,
): ReadonlyMap<string, Node & { readonly value: Node }> | null {
  if (!isObjectExpression(object)) {
    return null;
  }
  const properties = new Map<string, Node & { readonly value: Node }>();
  for (const property of object.properties) {
    if (!isObjectProperty(property) || property.computed) {
      return null;
    }
    const key = readPropertyName(property.key);
    if (
      !key ||
      key === "__proto__" ||
      key === "toJSON" ||
      properties.has(key)
    ) {
      return null;
    }
    properties.set(key, property);
  }
  return properties;
}

function isPresignedByteTransfer(input: {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly call: CallExpression | OptionalCallExpression;
  readonly contents: string;
  readonly initArgument: Node | null;
  readonly relativePath: string;
  readonly urlArgument: Node;
  readonly urlFacts: ProviderExpressionFacts;
}): boolean {
  const before = input.call.start ?? Number.MAX_SAFE_INTEGER;
  const approvedProviderNamedUrl = isApprovedPresignedTransferUrlOwner(
    input.relativePath,
    readMemberPath(input.urlArgument)?.at(-1) ?? "",
    { analysis: input.analysis, before },
  );
  if (
    (input.urlFacts.explicitProviderIds.size > 0 && !approvedProviderNamedUrl) ||
    !isOpaqueTransferUrlShape({
      analysis: input.analysis,
      before,
      bindings: input.bindings,
      contents: input.contents,
      node: input.urlArgument,
      relativePath: input.relativePath,
      resolving: new Set(),
    })
  ) {
    return false;
  }
  const initArgument = input.initArgument;
  if (!initArgument) {
    return true;
  }
  if (initArgument.type === "SpreadElement") {
    return false;
  }
  const init = unwrapExpression(initArgument);
  if (
    !isObjectExpression(init) ||
    init.properties.some(
      (property) =>
        isSpreadElement(property)
          ? !isProvablySafeTransferInitSpread(property.argument)
          : !isObjectProperty(property) || property.computed,
    ) ||
    !hasApprovedTransferHeaders({
      analysis: input.analysis,
      before,
      bindings: input.bindings,
      contents: input.contents,
      init,
      relativePath: input.relativePath,
    })
  ) {
    return false;
  }
  const credentialsProperty = readObjectProperty(init, "credentials");
  if (
    credentialsProperty &&
    (
      !isStringLiteral(credentialsProperty.value) ||
      credentialsProperty.value.value !== "omit"
    )
  ) {
    return false;
  }
  const initText = readNodeText(init, input.contents);
  if (
    /(?:authorization|api[-_]?key|bearer|cookie|proxy-authorization|xi-api-key)/iu
      .test(initText) ||
    /\bcredentials\s*:\s*["'](?!omit["'])/iu.test(initText)
  ) {
    return false;
  }
  const methodProperty = readObjectProperty(init, "method");
  const method = methodProperty
    ? isStringLiteral(methodProperty.value)
      ? methodProperty.value.value.toUpperCase()
      : null
    : "GET";
  if (method === "GET" || method === "HEAD") {
    return readObjectProperty(init, "body") === null;
  }
  if (method !== "PUT") {
    return false;
  }
  const body = readObjectProperty(init, "body");
  if (!body) {
    return isApprovedStreamedTransferBody({
      analysis: input.analysis,
      before,
      bindings: input.bindings,
      call: input.call,
      relativePath: input.relativePath,
      urlArgument: input.urlArgument,
    });
  }
  return Boolean(
    isProvablyBinaryTransferBody({
      analysis: input.analysis,
      before,
      bindings: input.bindings,
      contents: input.contents,
      node: body.value,
      resolving: new Set(),
    }),
  );
}

function isProvablySafeTransferInitSpread(node: Node): boolean {
  const expression = unwrapExpression(node);
  if (isObjectExpression(expression)) {
    return expression.properties.every((property) => {
      if (!isObjectProperty(property) || property.computed) {
        return false;
      }
      const key = isIdentifier(property.key)
        ? property.key.name
        : isStringLiteral(property.key)
          ? property.key.value
          : null;
      return key === "ca";
    });
  }
  if (expression.type === "ConditionalExpression") {
    return isProvablySafeTransferInitSpread(expression.consequent) &&
      isProvablySafeTransferInitSpread(expression.alternate);
  }
  if (expression.type === "LogicalExpression") {
    return expression.operator === "&&" &&
      isProvablySafeTransferInitSpread(expression.right);
  }
  return false;
}

function isApprovedStreamedTransferBody(input: {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly before: number;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly call: CallExpression | OptionalCallExpression;
  readonly relativePath: string;
  readonly urlArgument: Node;
}): boolean {
  if (
    !isApprovedPresignedTransferUrlOwner(
      input.relativePath,
      readMemberPath(input.urlArgument)?.at(-1) ?? "",
      { analysis: input.analysis, before: input.before },
    )
  ) {
    return false;
  }
  const owner = findInnermostLocalFunction(
    collectLocalFunctionRanges(input.analysis.sourceFile),
    input.before,
  );
  if (owner?.name !== "putHostedContainerDirectR2SmokePayload") {
    return false;
  }
  let requestName: string | null = null;
  for (const [name, candidates] of input.bindings) {
    if (
      candidates.some(
        (candidate) =>
          candidate.initializer.start === input.call.start &&
          candidate.scopeStart <= input.before &&
          input.before <= candidate.scopeEnd,
      )
    ) {
      requestName = name;
      break;
    }
  }
  if (!requestName) {
    return false;
  }
  let hasExactPipe = false;
  traverseFast(input.analysis.sourceFile, (node) => {
    if (
      hasExactPipe ||
      (node.start ?? 0) < owner.start ||
      (node.end ?? Number.MAX_SAFE_INTEGER) > owner.end ||
      (!isCallExpression(node) && !isOptionalCallExpression(node))
    ) {
      return;
    }
    const calleePath = readMemberPath(node.callee);
    if (calleePath?.join(".") !== "input.payload.pipe") {
      return;
    }
    const target = node.arguments[0];
    if (!target || !isIdentifier(target, { name: requestName })) {
      return;
    }
    hasExactPipe = resolveBinding(
      input.bindings,
      requestName,
      node.start ?? Number.MAX_SAFE_INTEGER,
    )?.initializer.start === input.call.start;
  });
  return hasExactPipe;
}

function hasApprovedTransferHeaders(input: {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly before: number;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly contents: string;
  readonly init: Node;
  readonly relativePath: string;
}): boolean {
  if (!isObjectExpression(input.init)) {
    return false;
  }
  for (const property of input.init.properties) {
    if (!isObjectProperty(property)) {
      continue;
    }
    const key = isIdentifier(property.key)
      ? property.key.name
      : isStringLiteral(property.key)
        ? property.key.value
        : null;
    if (key?.toLowerCase() !== "headers") {
      continue;
    }
    const headers = unwrapExpression(property.value);
    if (isObjectExpression(headers)) {
      for (const header of headers.properties) {
        if (!isObjectProperty(header) || header.computed) {
          return false;
        }
        const headerName = isIdentifier(header.key)
          ? header.key.name
          : isStringLiteral(header.key)
            ? header.key.value
            : null;
        if (
          !headerName ||
          !safeLiteralTransferHeaderNames.has(headerName.toLowerCase())
        ) {
          return false;
        }
      }
      continue;
    }
    if (
      !isApprovedPresignedTransferHeaderFactoryCall(
        headers,
        input.analysis,
        input.bindings,
        input.before,
        input.relativePath,
      )
    ) {
      return false;
    }
  }
  return true;
}

function isApprovedPresignedTransferHeaderFactoryCall(
  node: Node,
  analysis: ProviderHttpSourceAnalysis,
  bindings: ReadonlyMap<string, readonly VariableBinding[]>,
  before: number,
  relativePath: string,
): boolean {
  const expression = unwrapExpression(node);
  if (!isCallExpression(expression) && !isOptionalCallExpression(expression)) {
    return false;
  }
  const callee = unwrapExpression(expression.callee);
  if (!isIdentifier(callee)) {
    return false;
  }
  if (
    resolveParameterBinding(analysis.parameterBindings, callee.name, before) ||
    resolveBinding(bindings, callee.name, before)
  ) {
    return false;
  }
  const functionBinding = resolveFunctionBinding(
    analysis.functionBindings,
    callee.name,
    before,
  );
  if (!functionBinding || functionBinding.scopeStart !== 0) {
    return false;
  }
  return approvedPresignedTransferHeaderFactories.some((factory) => {
    if (
      factory.relativePath !== normalizeRepoPath(relativePath) ||
      factory.name !== callee.name ||
      analysis.functionBindings.get(callee.name)?.filter(
        (binding) => binding.scopeStart === 0,
      ).length !== 1
    ) {
      return false;
    }
    const range = findExactApprovedFunctionRange({
      functionName: factory.name,
      sourceFile: analysis.sourceFile,
    });
    return Boolean(
      range &&
      hasExactSourceHash(
        analysis.contents,
        range,
        factory.implementationSha256,
      ),
    );
  });
}

function isOpaqueTransferUrlShape(input: {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly before: number;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly contents: string;
  readonly node: Node;
  readonly relativePath: string;
  readonly resolving: ReadonlySet<string>;
}): boolean {
  const node = unwrapExpression(input.node);
  if (isStringLiteral(node) || isTemplateLiteral(node)) {
    return false;
  }
  if (isNewExpression(node)) {
    const firstArgument = node.arguments[0];
    return readNodeText(node.callee, input.contents) === "URL" &&
      Boolean(
        firstArgument &&
        firstArgument.type !== "ArgumentPlaceholder" &&
        firstArgument.type !== "SpreadElement" &&
        node.arguments.length === 1 &&
        isOpaqueTransferUrlShape({ ...input, node: firstArgument }),
      );
  }
  if (isIdentifier(node)) {
    const key = `transfer:${node.name}`;
    if (input.resolving.has(key)) {
      return false;
    }
    const binding = resolveBinding(input.bindings, node.name, input.before);
    if (binding?.definitive) {
      const resolving = new Set(input.resolving);
      resolving.add(key);
      if (
        isOpaqueTransferUrlShape({
          ...input,
          before: node.start ?? input.before,
          node: binding.initializer,
          resolving,
        })
      ) {
        return true;
      }
      return isApprovedPresignedTransferUrlOwner(input.relativePath, node.name, {
        analysis: input.analysis,
        before: input.before,
      });
    }
    return isApprovedPresignedTransferUrlOwner(input.relativePath, node.name, {
      analysis: input.analysis,
      before: input.before,
    });
  }
  if (isMemberExpression(node) || isOptionalMemberExpression(node)) {
    const pathParts = readMemberPath(node);
    const terminal = pathParts?.at(-1);
    return Boolean(
      terminal &&
      isApprovedPresignedTransferUrlOwner(input.relativePath, terminal, {
        analysis: input.analysis,
        before: input.before,
      }),
    );
  }
  return false;
}

function isApprovedPresignedTransferUrlOwner(
  relativePath: string,
  name: string,
  input: {
    readonly analysis: ProviderHttpSourceAnalysis;
    readonly before: number;
  },
): boolean {
  const owner = findInnermostLocalFunction(
    collectLocalFunctionRanges(input.analysis.sourceFile),
    input.before,
  );
  const matchingOwnerCount = collectLocalFunctionRanges(
    input.analysis.sourceFile,
  ).filter((candidate) => candidate.name === owner?.name).length;
  if (!owner || matchingOwnerCount !== 1) {
    return false;
  }
  return approvedPresignedTransferUrlOwners.some((approved) => {
    if (
      approved.relativePath !== normalizeRepoPath(relativePath) ||
      approved.ownerName !== owner.name ||
      !approved.names.some((candidate) => candidate === name) ||
      !hasExactSourceHash(
        input.analysis.contents,
        owner,
        approved.implementationSha256,
      )
    ) {
      return false;
    }
    if (!("urlFactoryName" in approved)) {
      return true;
    }
    const factoryRange = findExactApprovedFunctionRange({
      functionName: approved.urlFactoryName,
      sourceFile: input.analysis.sourceFile,
    });
    return Boolean(
      factoryRange &&
      input.analysis.functionBindings.get(approved.urlFactoryName)?.filter(
        (binding) => binding.scopeStart === 0,
      ).length === 1 &&
      hasExactSourceHash(
        input.analysis.contents,
        factoryRange,
        approved.urlFactoryImplementationSha256,
      ),
    );
  });
}

function readObjectProperty(
  object: Node,
  propertyName: string,
): (Node & { readonly value: Node }) | null {
  if (!isObjectExpression(object)) {
    return null;
  }
  for (const property of object.properties) {
    if (!isObjectProperty(property) || property.computed) {
      continue;
    }
    const key = isIdentifier(property.key)
      ? property.key.name
      : isStringLiteral(property.key)
        ? property.key.value
        : null;
    if (key === propertyName) {
      return property;
    }
  }
  return null;
}

function resolveStaticMemberInitializer(
  node: Node,
  bindings: ReadonlyMap<string, readonly VariableBinding[]>,
  before: number,
  sourceFile: Node,
): Node | null {
  const pathParts = readMemberPath(node);
  const root = pathParts?.[0];
  if (!pathParts || pathParts.length < 2 || !root || root === "this") {
    return null;
  }
  const binding = resolveBinding(bindings, root, before);
  if (
    !binding?.definitive ||
    readStaticMemberMutationInitializers(
      node,
      bindings,
      before,
      sourceFile,
    ).length > 0
  ) {
    return null;
  }
  const bindingValues = readVariableBindingPossibleValues(
    binding,
    bindings,
    sourceFile,
  );
  if (bindingValues.length !== 1) {
    return null;
  }
  let current = unwrapExpression(bindingValues[0] ?? binding.initializer);
  const resolving = new Set([`${root}:${binding.start}`]);
  for (const propertyName of pathParts.slice(1)) {
    while (isIdentifier(current)) {
      const currentBinding = resolveBinding(
        bindings,
        current.name,
        current.start ?? before,
      );
      const key = currentBinding
        ? `${current.name}:${currentBinding.start}`
        : "";
      if (!currentBinding?.definitive || resolving.has(key)) {
        return null;
      }
      const currentValues = readVariableBindingPossibleValues(
        currentBinding,
        bindings,
        sourceFile,
      );
      if (currentValues.length !== 1) {
        return null;
      }
      resolving.add(key);
      current = unwrapExpression(
        currentValues[0] ?? currentBinding.initializer,
      );
    }
    if (isObjectExpression(current)) {
      const property = readClosedObjectProperties(current)?.get(propertyName);
      if (!property) {
        return null;
      }
      current = unwrapExpression(property.value);
      continue;
    }
    if (
      current.type === "ArrayExpression" &&
      current.elements.every((element) => !element || !isSpreadElement(element)) &&
      /^\d+$/u.test(propertyName)
    ) {
      const element = current.elements[Number(propertyName)];
      if (!element || isSpreadElement(element)) {
        return null;
      }
      current = unwrapExpression(element);
      continue;
    }
    return null;
  }
  return current;
}

function readPossibleStaticPropertyValues(
  node: Node,
  propertyName: string,
  bindings: ReadonlyMap<string, readonly VariableBinding[]>,
  before: number,
  resolving: ReadonlySet<string>,
): Node[] {
  const current = unwrapExpression(node);
  if (isIdentifier(current)) {
    const values: Node[] = [];
    for (const binding of resolvePossibleBindings(
      bindings,
      current.name,
      current.start ?? before,
    )) {
      const key = `${current.name}:${binding.start}`;
      if (resolving.has(key)) {
        continue;
      }
      const nextResolving = new Set(resolving);
      nextResolving.add(key);
      for (const bindingValue of readVariableBindingPossibleValues(
        binding,
        bindings,
      )) {
        values.push(
          ...readPossibleStaticPropertyValues(
            bindingValue,
            propertyName,
            bindings,
            binding.start,
            nextResolving,
          ),
        );
      }
    }
    return values;
  }
  if (current.type === "ConditionalExpression") {
    return [current.consequent, current.alternate].flatMap((branch) =>
      readPossibleStaticPropertyValues(
        branch,
        propertyName,
        bindings,
        before,
        resolving,
      )
    );
  }
  if (current.type === "LogicalExpression") {
    return [current.left, current.right].flatMap((branch) =>
      readPossibleStaticPropertyValues(
        branch,
        propertyName,
        bindings,
        before,
        resolving,
      )
    );
  }
  if (current.type === "SequenceExpression") {
    return current.expressions.flatMap((branch) =>
      readPossibleStaticPropertyValues(
        branch,
        propertyName,
        bindings,
        before,
        resolving,
      )
    );
  }
  if (isObjectExpression(current)) {
    const values: Node[] = [];
    for (const property of current.properties) {
      if (isSpreadElement(property)) {
        values.push(
          ...readPossibleStaticPropertyValues(
            property.argument,
            propertyName,
            bindings,
            property.start ?? before,
            resolving,
          ),
        );
        continue;
      }
      if (!isObjectProperty(property)) {
        continue;
      }
      const key = !property.computed && isIdentifier(property.key)
        ? property.key.name
        : isStringLiteral(property.key)
          ? property.key.value
          : isNumericLiteral(property.key)
            ? String(property.key.value)
            : null;
      if (key === propertyName) {
        values.push(unwrapExpression(property.value));
      }
    }
    return values;
  }
  if (
    current.type === "ArrayExpression" &&
    /^\d+$/u.test(propertyName)
  ) {
    const index = Number(propertyName);
    const element = current.elements[index];
    const values = element && !isSpreadElement(element)
      ? [unwrapExpression(element)]
      : [];
    for (const candidate of current.elements) {
      if (candidate && isSpreadElement(candidate)) {
        values.push(
          ...readPossibleStaticPropertyValues(
            candidate.argument,
            propertyName,
            bindings,
            candidate.start ?? before,
            resolving,
          ),
        );
      }
    }
    return values;
  }
  return [];
}

function readEffectiveStaticPropertyPathValues(
  node: Node,
  propertyPath: readonly string[],
  bindings: ReadonlyMap<string, readonly VariableBinding[]>,
  before: number,
  sourceFile: Node,
  referencePaths: readonly (readonly string[])[] = readPossibleReferencePaths(
    node,
  ),
): Node[] {
  let values: Node[] = [unwrapExpression(node)];
  for (const propertyName of propertyPath) {
    values = values.flatMap((candidate) =>
      readPossibleStaticPropertyValues(
        candidate,
        propertyName,
        bindings,
        before,
        new Set(),
      )
    );
  }
  if (propertyPath.length > 0) {
    for (const referencePath of referencePaths) {
      values.push(
        ...readStaticMemberMutationInitializersForPath(
          [...referencePath, ...propertyPath],
          bindings,
          before,
          sourceFile,
          false,
        ),
      );
    }
  }
  return values.filter((value, index) =>
    values.findIndex((candidate) =>
      candidate.type === value.type &&
      candidate.start === value.start &&
      candidate.end === value.end
    ) === index
  );
}

function readVariableBindingPossibleValues(
  binding: VariableBinding,
  bindings: ReadonlyMap<string, readonly VariableBinding[]>,
  sourceFile?: Node,
): Node[] {
  const propertyPath = binding.propertyPath ?? [];
  let values = sourceFile
    ? readEffectiveStaticPropertyPathValues(
        binding.initializer,
        propertyPath,
        bindings,
        binding.start,
        sourceFile,
      )
    : [unwrapExpression(binding.initializer)];
  if (!sourceFile) {
    for (const propertyName of propertyPath) {
      values = values.flatMap((candidate) =>
        readPossibleStaticPropertyValues(
          candidate,
          propertyName,
          bindings,
          binding.start - 1,
          new Set(),
        )
      );
    }
  }
  if (binding.defaultExpression) {
    values.push(unwrapExpression(binding.defaultExpression));
  }
  return values;
}

function readPossibleStaticMemberInitializers(
  node: Node,
  bindings: ReadonlyMap<string, readonly VariableBinding[]>,
  before: number,
  sourceFile: Node,
): Node[] {
  const pathParts = readMemberPath(node);
  const root = pathParts?.[0];
  if (!pathParts || pathParts.length < 2 || !root || root === "this") {
    return [];
  }

  let current = resolvePossibleBindings(bindings, root, before).flatMap(
    (binding) => readVariableBindingPossibleValues(
      binding,
      bindings,
      sourceFile,
    ),
  );
  for (const propertyName of pathParts.slice(1)) {
    current = current.flatMap((candidate) =>
      readPossibleStaticPropertyValues(
        candidate,
        propertyName,
        bindings,
        before,
        new Set(),
      )
    );
  }
  return [
    ...current,
    ...readStaticMemberMutationInitializers(
      node,
      bindings,
      before,
      sourceFile,
    ),
  ];
}

const staticMemberMutationCandidatesBySource = new WeakMap<
  Node,
  readonly Node[]
>();

function collectStaticMemberMutationCandidates(sourceFile: Node): readonly Node[] {
  const cached = staticMemberMutationCandidatesBySource.get(sourceFile);
  if (cached) {
    return cached;
  }
  const candidates: Node[] = [];
  traverseFast(sourceFile, (candidate) => {
    if (
      isAssignmentExpression(candidate) ||
      (
        (isCallExpression(candidate) || isOptionalCallExpression(candidate)) &&
        readMemberPath(candidate.callee)?.join(".") === "Object.assign"
      )
    ) {
      candidates.push(candidate);
    }
  });
  staticMemberMutationCandidatesBySource.set(sourceFile, candidates);
  return candidates;
}

interface StaticMemberPathResolution {
  readonly opaque: boolean;
  readonly path: readonly string[];
  readonly rootBinding: VariableBinding;
}

interface StaticMemberMutationTargetResolution {
  readonly path: readonly (string | null)[];
  readonly rootBinding: VariableBinding;
}

interface StaticMemberMutationTargets {
  readonly opaque: boolean;
  readonly resolutions: readonly StaticMemberMutationTargetResolution[];
}

function resolvePossibleStaticMemberMutationTargets(
  node: Node,
  bindings: ReadonlyMap<string, readonly VariableBinding[]>,
  before: number,
  sourceFile: Node,
  allowRootOnly: boolean,
  includeMemberMutations = true,
): StaticMemberMutationTargets {
  const target = unwrapExpression(node);
  if (
    !allowRootOnly &&
    !isMemberExpression(target) &&
    !isOptionalMemberExpression(target)
  ) {
    return { opaque: false, resolutions: [] };
  }

  const syntaxPaths: Array<readonly (string | null)[]> = [];
  let opaque = false;
  const visit = (
    candidate: Node,
    suffix: readonly (string | null)[],
  ): void => {
    const value = unwrapExpression(candidate);
    if (isIdentifier(value)) {
      if (allowRootOnly || suffix.length > 0) {
        syntaxPaths.push([value.name, ...suffix]);
      }
      return;
    }
    if (value.type === "ThisExpression") {
      opaque = true;
      return;
    }
    if (isMemberExpression(value) || isOptionalMemberExpression(value)) {
      const propertyName = !value.computed && isIdentifier(value.property)
        ? value.property.name
        : value.computed && isStringLiteral(value.property)
          ? value.property.value
          : value.computed && isNumericLiteral(value.property)
            ? String(value.property.value)
            : null;
      if (propertyName === null) {
        opaque = true;
      }
      visit(value.object, [propertyName, ...suffix]);
      return;
    }
    if (value.type === "ConditionalExpression") {
      visit(value.consequent, suffix);
      visit(value.alternate, suffix);
      return;
    }
    if (value.type === "LogicalExpression") {
      visit(value.left, suffix);
      visit(value.right, suffix);
      return;
    }
    if (value.type === "SequenceExpression") {
      for (const expression of value.expressions) {
        visit(expression, suffix);
      }
      return;
    }
    opaque = true;
  };
  visit(target, []);

  const resolutions: StaticMemberMutationTargetResolution[] = [];
  for (const syntaxPath of syntaxPaths) {
    const wildcardIndex = syntaxPath.indexOf(null);
    const staticPrefix = syntaxPath.slice(
      0,
      wildcardIndex < 0 ? syntaxPath.length : wildcardIndex,
    );
    const staticPath = staticPrefix.filter(
      (part): part is string => part !== null,
    );
    if (staticPath.length === 0 || staticPath.length !== staticPrefix.length) {
      opaque = true;
      continue;
    }
    const staticResolutions = resolvePossibleStaticMemberPaths(
      staticPath,
      bindings,
      before,
      sourceFile,
      includeMemberMutations,
    );
    if (staticResolutions.length === 0) {
      opaque = true;
      continue;
    }
    for (const resolution of staticResolutions) {
      opaque ||= resolution.opaque;
      resolutions.push({
        path: wildcardIndex < 0
          ? resolution.path
          : [...resolution.path, ...syntaxPath.slice(wildcardIndex)],
        rootBinding: resolution.rootBinding,
      });
    }
  }

  return {
    opaque,
    resolutions: resolutions.filter((resolution, index) =>
      resolutions.findIndex((candidate) =>
        candidate.path.length === resolution.path.length &&
        candidate.path.every(
          (part, partIndex) => part === resolution.path[partIndex],
        ) &&
        candidate.rootBinding.start === resolution.rootBinding.start &&
        candidate.rootBinding.scopeStart === resolution.rootBinding.scopeStart &&
        candidate.rootBinding.scopeEnd === resolution.rootBinding.scopeEnd
      ) === index
    ),
  };
}

function readPossibleReferencePaths(node: Node): readonly string[][] {
  const value = unwrapExpression(node);
  const direct = isIdentifier(value) ||
      isMemberExpression(value) ||
      isOptionalMemberExpression(value)
    ? readMemberPath(value)
    : null;
  if (direct) {
    return [direct];
  }
  if (value.type === "ConditionalExpression") {
    return [value.consequent, value.alternate].flatMap((branch) =>
      readPossibleReferencePaths(branch)
    );
  }
  if (value.type === "LogicalExpression") {
    return [value.left, value.right].flatMap((branch) =>
      readPossibleReferencePaths(branch)
    );
  }
  if (value.type === "SequenceExpression") {
    return value.expressions.flatMap((expression) =>
      readPossibleReferencePaths(expression)
    );
  }
  return [];
}

function referencePathsEqual(
  left: readonly (readonly string[])[],
  right: readonly (readonly string[])[],
): boolean {
  return left.length === right.length && left.every((path, pathIndex) =>
    path.length === right[pathIndex]?.length &&
    path.every((part, partIndex) => part === right[pathIndex]?.[partIndex])
  );
}

function dedupeReferencePaths(
  paths: readonly (readonly string[])[],
): readonly (readonly string[])[] {
  return paths.filter((path, pathIndex) =>
    paths.findIndex((candidate) =>
      candidate.length === path.length &&
      candidate.every((part, partIndex) => part === path[partIndex])
    ) === pathIndex
  );
}

function isClosedNonAliasValue(node: Node): boolean {
  const value = unwrapExpression(node);
  return isObjectExpression(value) ||
    value.type === "ArrayExpression" ||
    isFunction(value) ||
    isStringLiteral(value) ||
    value.type === "NumericLiteral" ||
    value.type === "BooleanLiteral" ||
    value.type === "NullLiteral" ||
    value.type === "BigIntLiteral" ||
    value.type === "RegExpLiteral";
}

function hasPossibleStaticMemberMutationForPath(input: {
  readonly before: number;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly memberPath: readonly string[];
  readonly rootBinding: VariableBinding;
  readonly sourceFile: Node;
}): boolean {
  const hasSameRootBinding = (candidate: VariableBinding): boolean =>
    candidate.start === input.rootBinding.start &&
    candidate.scopeStart === input.rootBinding.scopeStart &&
    candidate.scopeEnd === input.rootBinding.scopeEnd;
  for (const candidate of collectStaticMemberMutationCandidates(
    input.sourceFile,
  )) {
    const position = candidate.start ?? Number.MAX_SAFE_INTEGER;
    if (position >= input.before) {
      continue;
    }
    let target: Node | null = null;
    let allowRootOnly = false;
    if (isAssignmentExpression(candidate)) {
      if (
        !isMemberExpression(candidate.left) &&
        !isOptionalMemberExpression(candidate.left)
      ) {
        continue;
      }
      target = candidate.left;
    } else if (
      (isCallExpression(candidate) || isOptionalCallExpression(candidate)) &&
      readMemberPath(candidate.callee)?.join(".") === "Object.assign"
    ) {
      const assigned = candidate.arguments[0];
      if (
        assigned &&
        assigned.type !== "ArgumentPlaceholder" &&
        assigned.type !== "SpreadElement"
      ) {
        target = assigned;
        allowRootOnly = true;
      }
    }
    if (!target) {
      continue;
    }
    const mutationTargets = resolvePossibleStaticMemberMutationTargets(
      target,
      input.bindings,
      position,
      input.sourceFile,
      allowRootOnly,
      false,
    );
    for (const mutationTarget of mutationTargets.resolutions) {
      if (!hasSameRootBinding(mutationTarget.rootBinding)) {
        continue;
      }
      const targetMemberPath = mutationTarget.path.slice(1);
      if (
        targetMemberPath.length <= input.memberPath.length &&
        targetMemberPath.every(
          (part, index) =>
            part === null || input.memberPath[index] === part,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function resolvePossibleStaticMemberPaths(
  path: readonly string[],
  bindings: ReadonlyMap<string, readonly VariableBinding[]>,
  before: number,
  sourceFile: Node,
  includeMemberMutations = true,
  memberBefore = before,
  resolving: ReadonlySet<string> = new Set(),
): StaticMemberPathResolution[] {
  const root = path[0];
  if (!root || root === "this") {
    return [];
  }
  const possibleBindings = resolvePossibleBindings(bindings, root, before);
  const resolutions: StaticMemberPathResolution[] = [];
  for (const binding of possibleBindings) {
    const key = `${root}:${binding.start}`;
    if (resolving.has(key)) {
      continue;
    }
    const nextResolving = new Set(resolving);
    nextResolving.add(key);
    const values = readVariableBindingPossibleValues(binding, bindings);
    let retainedLocalRoot = false;
    for (const value of values) {
      const closedValue = unwrapExpression(value);
      const referencePaths = readPossibleReferencePaths(value);
      if (referencePaths.length === 0) {
        resolutions.push({
          opaque: !isClosedNonAliasValue(value),
          path,
          rootBinding: binding,
        });
        retainedLocalRoot = true;
        if (
          (isObjectExpression(closedValue) ||
            closedValue.type === "ArrayExpression") &&
          path.length > 1
        ) {
          for (
            let prefixLength = 1;
            prefixLength < path.length;
            prefixLength += 1
          ) {
            const projectedValues = readEffectiveStaticPropertyPathValues(
              value,
              path.slice(1, prefixLength + 1),
              bindings,
              memberBefore,
              sourceFile,
              includeMemberMutations &&
                  hasPossibleStaticMemberMutationForPath({
                    before: memberBefore,
                    bindings,
                    memberPath: path.slice(1, prefixLength + 1),
                    rootBinding: binding,
                    sourceFile,
                  })
                ? [[root]]
                : [],
            );
            for (const projectedValue of projectedValues) {
              for (const projectedReferencePath of readPossibleReferencePaths(
                projectedValue,
              )) {
                resolutions.push(
                  ...resolvePossibleStaticMemberPaths(
                    [
                      ...projectedReferencePath,
                      ...path.slice(prefixLength + 1),
                    ],
                    bindings,
                    projectedValue.start ?? before,
                    sourceFile,
                    includeMemberMutations,
                    memberBefore,
                    nextResolving,
                  ),
                );
              }
            }
          }
        }
        continue;
      }
      for (const referencePath of referencePaths) {
        resolutions.push(
          ...resolvePossibleStaticMemberPaths(
            [...referencePath, ...path.slice(1)],
            bindings,
            binding.start - 1,
            sourceFile,
            includeMemberMutations,
            memberBefore,
            nextResolving,
          ),
        );
      }
    }
    if (values.length === 0 && !retainedLocalRoot) {
      resolutions.push({ opaque: true, path, rootBinding: binding });
    }
  }
  return resolutions.filter((resolution, index) =>
    resolutions.findIndex((candidate) =>
      candidate.opaque === resolution.opaque &&
      candidate.path.join(".") === resolution.path.join(".") &&
      candidate.rootBinding.start === resolution.rootBinding.start &&
      candidate.rootBinding.scopeStart === resolution.rootBinding.scopeStart &&
      candidate.rootBinding.scopeEnd === resolution.rootBinding.scopeEnd
    ) === index
  );
}

function readStaticMemberMutationInitializers(
  node: Node,
  bindings: ReadonlyMap<string, readonly VariableBinding[]>,
  before: number,
  sourceFile: Node,
): Node[] {
  const initialTargetPath = readMemberPath(node);
  if (!initialTargetPath || initialTargetPath.length < 2) {
    return [];
  }
  return readStaticMemberMutationInitializersForPath(
    initialTargetPath,
    bindings,
    before,
    sourceFile,
  );
}

function readStaticMemberMutationInitializersForPath(
  initialTargetPath: readonly string[],
  bindings: ReadonlyMap<string, readonly VariableBinding[]>,
  before: number,
  sourceFile: Node,
  includeTargetMemberMutations = true,
): Node[] {
  const targets = resolvePossibleStaticMemberPaths(
    initialTargetPath,
    bindings,
    before,
    sourceFile,
    includeTargetMemberMutations,
    before,
  );
  if (targets.length === 0) {
    return [];
  }
  const hasSameRootBinding = (
    left: VariableBinding,
    right: VariableBinding,
  ): boolean =>
    left.start === right.start &&
    left.scopeStart === right.scopeStart &&
    left.scopeEnd === right.scopeEnd;
  const isMutationPrefix = (
    mutation: StaticMemberMutationTargetResolution,
    target: StaticMemberPathResolution,
  ): boolean =>
    hasSameRootBinding(mutation.rootBinding, target.rootBinding) &&
    mutation.path.length >= 1 &&
    mutation.path.length <= target.path.length &&
    mutation.path.every(
      (part, index) => part === null || target.path[index] === part,
    );
  const readNestedValues = (
    value: Node,
    remainingPath: readonly string[],
    position: number,
  ): Node[] =>
    readEffectiveStaticPropertyPathValues(
      value,
      remainingPath,
      bindings,
      position,
      sourceFile,
    );

  const values: Node[] = [];
  for (const candidate of collectStaticMemberMutationCandidates(sourceFile)) {
    const position = candidate.start ?? Number.MAX_SAFE_INTEGER;
    if (position >= before) {
      continue;
    }
    if (isAssignmentExpression(candidate)) {
      const assignedResolutions = resolvePossibleStaticMemberMutationTargets(
        candidate.left,
        bindings,
        position,
        sourceFile,
        false,
      ).resolutions;
      for (const target of targets) {
        for (const assignedResolution of assignedResolutions) {
          if (!isMutationPrefix(assignedResolution, target)) {
            continue;
          }
          values.push(
            ...readNestedValues(
              candidate.right,
              target.path.slice(assignedResolution.path.length),
              position,
            ),
          );
        }
      }
      continue;
    }
    if (
      (isCallExpression(candidate) || isOptionalCallExpression(candidate)) &&
      readMemberPath(candidate.callee)?.join(".") === "Object.assign"
    ) {
      const [assigned, ...sources] = candidate.arguments;
      if (
        !assigned ||
        assigned.type === "ArgumentPlaceholder" ||
        assigned.type === "SpreadElement"
      ) {
        continue;
      }
      const assignedResolutions = resolvePossibleStaticMemberMutationTargets(
        assigned,
        bindings,
        position,
        sourceFile,
        true,
      ).resolutions;
      for (const target of targets) {
        for (const assignedResolution of assignedResolutions) {
          if (!isMutationPrefix(assignedResolution, target)) {
            continue;
          }
          for (const source of sources) {
            if (
              source.type === "ArgumentPlaceholder" ||
              source.type === "SpreadElement"
            ) {
              continue;
            }
            values.push(
              ...readNestedValues(
                source,
                target.path.slice(assignedResolution.path.length),
                position,
              ),
            );
          }
        }
      }
    }
  }
  return values;
}

function isProvablyBinaryTransferBody(input: {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly before: number;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly contents: string;
  readonly node: Node;
  readonly resolving: ReadonlySet<string>;
}): boolean {
  const node = unwrapExpression(input.node);
  if (isNewExpression(node) && isIdentifier(node.callee)) {
    return binaryTransferConstructorNames.has(node.callee.name) &&
      isUnshadowedGlobalIdentifier({
        analysis: input.analysis,
        before: input.before,
        bindings: input.bindings,
        name: node.callee.name,
      });
  }
  if (
    (isMemberExpression(node) || isOptionalMemberExpression(node)) &&
    readPropertyName(node.property) === "buffer"
  ) {
    return isProvablyBinaryTransferBody({ ...input, node: node.object });
  }
  if (
    (isCallExpression(node) || isOptionalCallExpression(node)) &&
    node.arguments.length === 0 &&
    (isMemberExpression(node.callee) || isOptionalMemberExpression(node.callee)) &&
    readPropertyName(node.callee.property) === "arrayBuffer"
  ) {
    return isProvablyBinaryTransferBody({ ...input, node: node.callee.object });
  }
  if (isIdentifier(node)) {
    const parameter = resolveParameterBinding(
      input.analysis.parameterBindings,
      node.name,
      input.before,
    );
    if (
      parameter?.typeAnnotation &&
      typeTextIsBinaryTransferBody(parameter.typeAnnotation)
    ) {
      return true;
    }
    const key = `binary-body:${node.name}`;
    if (input.resolving.has(key)) {
      return false;
    }
    const binding = resolveBinding(input.bindings, node.name, input.before);
    if (!binding) {
      return false;
    }
    const resolving = new Set(input.resolving);
    resolving.add(key);
    return isProvablyBinaryTransferBody({
      ...input,
      before: node.start ?? input.before,
      node: binding.initializer,
      resolving,
    });
  }
  if (isMemberExpression(node) || isOptionalMemberExpression(node)) {
    const pathParts = readMemberPath(node);
    const root = pathParts?.[0];
    const property = pathParts?.at(-1);
    const parameter = root
      ? resolveParameterBinding(
          input.analysis.parameterBindings,
          root,
          input.before,
        )
      : null;
    return Boolean(
      property &&
      parameter?.typeAnnotation &&
      typeTextHasBinaryProperty(parameter.typeAnnotation, property),
    );
  }
  return false;
}

function typeTextIsBinaryTransferBody(typeText: string): boolean {
  const members = stripLeadingTypeAnnotation(typeText)
    .split("|")
    .map((member) => member.trim().replace(/^\(([^()]*)\)$/u, "$1").trim());
  let includesBinary = false;
  for (const member of members) {
    if (/^(?:globalThis\.)?(?:ArrayBuffer|ArrayBufferView|Blob|Buffer|DataView|Readable|ReadableStream|Uint8Array)$/u.test(member)) {
      includesBinary = true;
      continue;
    }
    if (member === "null" || member === "undefined") {
      continue;
    }
    return false;
  }
  return includesBinary;
}

function typeTextHasBinaryProperty(typeText: string, propertyName: string): boolean {
  return new RegExp(
    `\\b${escapeRegExp(propertyName)}\\??\\s*:\\s*[^;,}]*(?:ArrayBuffer|ArrayBufferView|Blob|Buffer|DataView|Readable|ReadableStream|Uint8Array)\\b`,
    "u",
  ).test(typeText);
}

function readNamedTransportDeclaration(
  node: Node,
): { readonly name: string; readonly start: number } | null {
  if (
    node.type !== "TSInterfaceDeclaration" &&
    node.type !== "TSTypeAliasDeclaration"
  ) {
    return null;
  }
  if (!node.id) {
    return null;
  }
  return {
    name: node.id.name,
    start: node.id.start ?? node.start ?? 0,
  };
}

function isConcreteHandwrittenTransportDeclaration(
  name: string,
  declarationText: string,
): boolean {
  const normalizedName = normalizeIdentifierForMatch(name);
  if (
    /(?:domain|event|normalized|parsed|projection|report|result|state|summary)(?:request|response)$/u
      .test(normalizedName)
  ) {
    return false;
  }
  if (/(?:fetch|transport)$/u.test(normalizedName)) {
    return looksLikeFetchCallableSignature(declarationText);
  }
  if (/(?:client|driver|runtime)$/u.test(normalizedName)) {
    return hasLowLevelHttpClientContract(declarationText);
  }
  if (
    /(?:request(?:body|input|options|params)?|requestoptions)$/u.test(
      normalizedName,
    )
  ) {
    const declaresObjectShape = /(?:interface|type)\s+[A-Za-z0-9_$]+/u.test(
      declarationText,
    );
    if (normalizedName.endsWith("requestbody")) {
      return declaresObjectShape && /\b[A-Za-z_$][A-Za-z0-9_$]*\??\s*:/u.test(
        declarationText,
      );
    }
    return declaresObjectShape &&
      /(?:\bbody\??\s*:|\bheaders\??\s*:|\bmethod\??\s*:|\bpath\??\s*:|\burl\??\s*:|\b[a-z][a-z0-9]*_[a-z0-9_]+\??\s*:)/u
        .test(declarationText);
  }
  if (/(?:response|responsebody)$/u.test(normalizedName)) {
    return /(?:interface|type)\s+[A-Za-z0-9_$]+/u.test(declarationText) &&
      /(?:(?:arrayBuffer|json|text)\s*\(|\b[a-z][a-z0-9]*_[a-z0-9_]+\??\s*:|\b(?:accessToken|ciphertext|expireTime|mac|plaintext|signature)\??\s*:)/u
        .test(declarationText);
  }
  return false;
}

function isStrongGenericHttpWireDeclaration(
  name: string,
  declarationText: string,
): boolean {
  const normalizedName = normalizeIdentifierForMatch(name);
  if (
    /(?:domain|event|normalized|parsed|projection|report|result|state|summary)(?:request|response)$/u
      .test(normalizedName) ||
    !/(?:interface|type)\s+[A-Za-z0-9_$]+/u.test(declarationText)
  ) {
    return false;
  }
  const requestSignals = ["body", "headers", "method", "path", "url"]
    .filter((property) =>
      new RegExp(`\\b${property}\\??\\s*:`, "u").test(declarationText)
    );
  if (
    requestSignals.length >= 2 &&
    requestSignals.some((property) =>
      property === "headers" || property === "method"
    )
  ) {
    return true;
  }
  return /\b(?:arrayBuffer|json|text)\s*\(/u.test(declarationText) &&
    /\b(?:headers|ok|status)\??\s*:/u.test(declarationText);
}

function hasLowLevelHttpClientContract(declarationText: string): boolean {
  const member = /(?:^|[;{]\s*)(?:readonly\s+)?(?:fetch|request)\s*(?:\??\s*:|\()/imu
    .exec(declarationText);
  if (!member) {
    return false;
  }
  const memberText = declarationText.slice(member.index);
  return looksLikeFetchCallableSignature(memberText) ||
    /(?:fetch|request)\s*\??\s*:\s*(?:typeof\s+(?:(?:globalThis|self|window)\.)?fetch|[A-Za-z_$][A-Za-z0-9_$]*Fetch)\b/iu
      .test(memberText);
}

function providerIdsFromModule(moduleName: string): Set<string> {
  const providerIds = new Set<string>();
  for (const provider of providerBoundaryRegistry) {
    if (
      provider.sdkModules.some(
        (modulePrefix) =>
          moduleName === modulePrefix || moduleName.startsWith(`${modulePrefix}/`),
      )
    ) {
      providerIds.add(provider.id);
    }
  }
  return providerIds;
}

function providerIdsFromStaticText(text: string): Set<string> {
  const providerIds = new Set<string>();
  for (const provider of providerBoundaryRegistry) {
    if (provider.hosts.some((host) => staticTextContainsHost(text, host))) {
      providerIds.add(provider.id);
    }
  }
  return providerIds;
}

function staticTextContainsHost(text: string, host: string): boolean {
  return new RegExp(
    `(?:^|[^A-Za-z0-9.-])${escapeRegExp(host)}(?::[0-9]+)?(?:[/?#]|$)`,
    "iu",
  ).test(text);
}

function providerIdsFromIdentifier(value: string): Set<string> {
  const providerIds = new Set<string>();
  for (const provider of providerBoundaryRegistry) {
    if (
      provider.identifiers.some((identifier) =>
        identifierMatchesProvider(value, identifier)
      )
    ) {
      providerIds.add(provider.id);
    }
  }
  return providerIds;
}

function addSingleProviderFileHint(
  providerIds: Set<string>,
  value: string,
  fileProviderIds: ReadonlySet<string>,
): void {
  if (
    providerIds.size === 0 &&
    fileProviderIds.size === 1 &&
    isGenericProviderUrlName(value)
  ) {
    addProviderIds(providerIds, fileProviderIds);
  }
}

function identifierMatchesProvider(value: string, providerIdentifier: string): boolean {
  const words = normalizeIdentifierWords(value);
  const identifierWords = normalizeIdentifierWords(providerIdentifier);
  if (identifierWords.length === 0) {
    return false;
  }
  if (identifierWords.length === 1 && (identifierWords[0]?.length ?? 0) <= 3) {
    return words.includes(identifierWords[0] ?? "");
  }
  const compactValue = words.join("");
  const compactIdentifier = identifierWords.join("");
  return compactIdentifier.length > 0 && compactValue.includes(compactIdentifier);
}

function normalizeIdentifierWords(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[^A-Za-z0-9]+/gu, " ")
    .toLowerCase()
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

function normalizeIdentifierForMatch(value: string): string {
  return normalizeIdentifierWords(value).join("");
}

function isGenericProviderUrlName(value: string): boolean {
  const terminal = normalizeIdentifierWords(value).at(-1) ?? "";
  const compact = normalizeIdentifierForMatch(value);
  return [
    "apiBaseUrl",
    "apiRoot",
    "baseUrl",
    "endpoint",
    "endpointUrl",
    "origin",
    "providerBase",
    "tokenUri",
    "url",
  ].some((candidate) => compact.endsWith(candidate.toLowerCase())) ||
    terminal === "url" || terminal === "endpoint" || terminal === "origin";
}

function addProviderIds(target: Set<string>, source: Iterable<string>): void {
  for (const providerId of source) {
    target.add(providerId);
  }
}

function resolveMemberBinding(
  bindings: ReadonlyMap<string, readonly MemberBinding[]>,
  name: string,
  before: number,
): MemberBinding | null {
  const candidates = bindings.get(name);
  if (!candidates) {
    return null;
  }
  let resolved: MemberBinding | null = null;
  for (const candidate of candidates) {
    if (
      candidate.start <= before &&
      (!resolved || candidate.start > resolved.start)
    ) {
      resolved = candidate;
    }
  }
  return resolved;
}

function resolveParameterBinding(
  bindings: ReadonlyMap<string, readonly ParameterBinding[]>,
  name: string,
  position: number,
): ParameterBinding | null {
  const candidates = bindings.get(name);
  if (!candidates) {
    return null;
  }
  let resolved: ParameterBinding | null = null;
  for (const candidate of candidates) {
    if (
      candidate.scopeStart <= position &&
      position <= candidate.scopeEnd &&
      (!resolved || candidate.scopeStart > resolved.scopeStart)
    ) {
      resolved = candidate;
    }
  }
  return resolved;
}

function resolveFunctionBinding(
  bindings: ReadonlyMap<string, readonly FunctionBinding[]>,
  name: string,
  position: number,
): FunctionBinding | null {
  const candidates = bindings.get(name);
  if (!candidates) {
    return null;
  }
  let resolved: FunctionBinding | null = null;
  for (const candidate of candidates) {
    if (
      candidate.scopeStart <= position &&
      position <= candidate.scopeEnd &&
      (
        !resolved ||
        candidate.scopeStart > resolved.scopeStart ||
        (
          candidate.scopeStart === resolved.scopeStart &&
          candidate.start > resolved.start
        )
      )
    ) {
      resolved = candidate;
    }
  }
  return resolved;
}

function resolveTransportBinding(
  bindings: ReadonlyMap<string, readonly TransportBinding[]>,
  name: string,
  position: number,
): TransportBinding | null {
  return resolvePossibleTransportBindings(bindings, name, position)[0] ?? null;
}

function resolvePossibleTransportBindings(
  bindings: ReadonlyMap<string, readonly TransportBinding[]>,
  name: string,
  position: number,
): readonly TransportBinding[] {
  const candidates = bindings.get(name);
  if (!candidates) {
    return [];
  }
  let scopeStart = -1;
  let start = -1;
  for (const candidate of candidates) {
    if (
      candidate.start <= position &&
      candidate.scopeStart <= position &&
      position <= candidate.scopeEnd &&
      (
        candidate.scopeStart > scopeStart ||
        (
          candidate.scopeStart === scopeStart &&
          candidate.start > start
        )
      )
    ) {
      scopeStart = candidate.scopeStart;
      start = candidate.start;
    }
  }
  return candidates.filter((candidate) =>
    candidate.start === start &&
    candidate.scopeStart === scopeStart &&
    candidate.scopeStart <= position &&
    position <= candidate.scopeEnd
  );
}

function readParameterIdentifier(node: Node): (Node & {
  readonly name: string;
  readonly typeAnnotation?: Node | null;
}) | null {
  if (isIdentifier(node)) {
    return node;
  }
  if (node.type === "AssignmentPattern" && isIdentifier(node.left)) {
    return node.left;
  }
  if (node.type === "TSParameterProperty") {
    return readParameterIdentifier(node.parameter);
  }
  return null;
}

function readParameterDefaultExpression(node: Node): Node | null {
  if (node.type === "AssignmentPattern") {
    return node.right;
  }
  if (node.type === "TSParameterProperty") {
    return readParameterDefaultExpression(node.parameter);
  }
  return null;
}

function looksLikeFetchFunctionType(typeText: string): boolean {
  const normalized = stripLeadingTypeAnnotation(typeText);
  const signature = readFetchCallableSignature(normalized);
  return normalized.startsWith("(") && signature?.separator === "=>" &&
    isFetchTargetParameter(signature.name, signature.type);
}

function looksLikeStandardFetchDerivedBivariantType(
  typeText: string,
): boolean {
  const normalized = stripLeadingTypeAnnotation(typeText).replace(/\s+/gu, "");
  return normalized.startsWith("{bivarianceHack(") &&
    /\}\[(['"])bivarianceHack\1\]$/u.test(normalized) &&
    normalized.includes("Parameters<typeoffetch>[0]") &&
    normalized.includes("Parameters<typeoffetch>[1]");
}

function looksLikeExactFetchFunctionType(typeText: string): boolean {
  const normalized = stripLeadingTypeAnnotation(typeText);
  const signature = readFetchCallableSignature(normalized);
  return normalized.startsWith("(") && signature?.separator === "=>" &&
    isExactFetchTargetParameter(signature.name, signature.type);
}

function looksLikeFetchCallableSignature(text: string): boolean {
  const signature = readFetchCallableSignature(text);
  return Boolean(
    signature && isFetchTargetParameter(signature.name, signature.type),
  );
}

function looksLikeExactFetchCallableSignature(text: string): boolean {
  const signature = readFetchCallableSignature(text);
  return Boolean(
    signature && isExactFetchTargetParameter(signature.name, signature.type),
  );
}

function readFetchCallableSignature(text: string): {
  readonly name: string;
  readonly separator: ":" | "=>";
  readonly type: string;
} | null {
  const openParenthesis = text.indexOf("(");
  if (openParenthesis < 0) {
    return null;
  }
  const match = /^\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\??\s*:\s*([^,\n)]+)(?:,[\s\S]*?)?\)\s*(=>|:)\s*Promise\s*<\s*(?:(?:globalThis\.)?Response|[A-Za-z_$][A-Za-z0-9_$]*(?:Fetch|Http)Response)\s*>/u
    .exec(text.slice(openParenthesis));
  if (!match?.[1] || !match[2] || (match[3] !== ":" && match[3] !== "=>")) {
    return null;
  }
  return {
    name: match[1],
    separator: match[3],
    type: match[2].trim(),
  };
}

function isFetchTargetParameter(name: string, typeText: string): boolean {
  const targetType = typeText.replace(/^\((.*)\)$/u, "$1").trim();
  if (
    !/^(?:(?:globalThis\.)?(?:RequestInfo|Request|URL)|string)(?:\s*\|\s*(?:(?:globalThis\.)?(?:RequestInfo|Request|URL)|string))*$/u
      .test(targetType)
  ) {
    return false;
  }
  return /(?:RequestInfo|Request|URL)/u.test(targetType) ||
    /^(?:endpoint|input|request|uri|url)$/iu.test(name);
}

function isExactFetchTargetParameter(name: string, typeText: string): boolean {
  return isFetchTargetParameter(name, typeText) &&
    /(?:RequestInfo|URL|string)/u.test(typeText);
}

function functionHasFetchCallSignature(
  node: Node,
  contents: string,
  exact = false,
): boolean {
  if (!isFunction(node)) {
    return false;
  }
  const firstParameter = node.params[0];
  if (!firstParameter) {
    return false;
  }
  const returnType = node.returnType
    ? readNodeText(node.returnType, contents)
    : "";
  const signature = `(${readNodeText(firstParameter, contents)}) ${returnType}`;
  return exact
    ? looksLikeExactFetchCallableSignature(signature)
    : looksLikeFetchCallableSignature(signature);
}

function functionDirectlyForwardsToFetch(input: {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly before: number;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly contents: string;
  readonly exact?: boolean;
  readonly node: Node;
  readonly resolving: ReadonlySet<string>;
}): boolean {
  if (!isFunction(input.node)) {
    return false;
  }
  const parameters = input.node.params.map(readParameterIdentifier);
  if (parameters.length === 0 || parameters.some((parameter) => !parameter)) {
    return false;
  }
  let returned: Node | null = null;
  if (input.node.body.type === "BlockStatement") {
    const statement = input.node.body.body[0];
    if (
      input.node.body.body.length !== 1 ||
      !statement ||
      !isReturnStatement(statement)
    ) {
      return false;
    }
    returned = statement.argument ?? null;
  } else {
    returned = input.node.body;
  }
  if (!returned) {
    return false;
  }
  const expression = unwrapExpression(returned);
  const call = expression.type === "AwaitExpression"
    ? unwrapExpression(expression.argument)
    : expression;
  if (
    (!isCallExpression(call) && !isOptionalCallExpression(call)) ||
    !isFetchLikeCallTarget({
      ...input,
      before: call.start ?? input.before,
      node: call.callee,
    })
  ) {
    return false;
  }
  const callArguments = call.arguments.filter(
    (argument) => argument.type !== "ArgumentPlaceholder",
  );
  if (callArguments.length === 0 || callArguments.length > parameters.length) {
    return false;
  }
  return callArguments.every((argument, index) => {
    if (argument.type === "SpreadElement") {
      return false;
    }
    const forwarded = unwrapExpression(argument);
    return isIdentifier(forwarded) &&
      forwarded.name === parameters[index]?.name;
  });
}

function readCallableName(node: Node): string | null {
  if ("id" in node && node.id && isIdentifier(node.id)) {
    return node.id.name;
  }
  if ("key" in node && node.key) {
    return readPropertyName(node.key as Node);
  }
  return null;
}

function readPropertyName(node: Node): string | null {
  if (isIdentifier(node)) {
    return node.name;
  }
  if (isStringLiteral(node)) {
    return node.value;
  }
  return null;
}

function typeTextIsFetchCallable(
  typeText: string,
  fetchTypeNames: ReadonlySet<string>,
): boolean {
  const members = stripLeadingTypeAnnotation(typeText)
    .split("|")
    .map((member) => member.trim().replace(/^\(([^()]*)\)$/u, "$1").trim());
  if (members.length === 0 || members.some((member) => member.length === 0)) {
    return false;
  }
  let includesFetchType = false;
  for (const member of members) {
    if (
      /^typeof\s+(?:(?:globalThis|self|window)\.)?fetch$/u.test(member) ||
      fetchTypeNames.has(member)
    ) {
      includesFetchType = true;
      continue;
    }
    if (member === "null" || member === "undefined") {
      continue;
    }
    return false;
  }
  return includesFetchType;
}

function isFetchLikeCallTarget(input: {
  readonly analysis: ProviderHttpSourceAnalysis;
  readonly before: number;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly contents: string;
  readonly exact?: boolean;
  readonly node: Node;
  readonly resolving: ReadonlySet<string>;
}): boolean {
  const expression = unwrapExpression(input.node);
  const fetchTypeNames = input.exact
    ? input.analysis.exactFetchTypeNames
    : input.analysis.fetchTypeNames;
  if (isIdentifier(expression)) {
    const latestTransports = resolvePossibleTransportBindings(
      input.analysis.transportBindings,
      expression.name,
      input.before,
    );
    const parameter = resolveParameterBinding(
      input.analysis.parameterBindings,
      expression.name,
      input.before,
    );
    if (parameter) {
      const typedFetch = Boolean(
        parameter.typeAnnotation &&
        (
          parameter.propertyPath?.length
            ? typeTextHasFetchProperty(
                parameter.typeAnnotation,
                parameter.propertyPath.at(-1) ?? "",
                fetchTypeNames,
                input.exact,
              )
            : typeTextIsFetchCallable(
                parameter.typeAnnotation,
                fetchTypeNames,
              ) || (input.exact
                ? looksLikeExactFetchFunctionType(parameter.typeAnnotation)
                : looksLikeFetchFunctionType(parameter.typeAnnotation))
        ),
      );
      const opaqueNamedFetch = Boolean(
        !input.exact &&
        /^fetch(?:er|Impl|Implementation)?$/u.test(expression.name) &&
        parameter.typeAnnotation &&
        typeTextIsOpaqueNamedReference(parameter.typeAnnotation),
      );
      if (typedFetch || opaqueNamedFetch || !parameter.defaultExpression) {
        return typedFetch || opaqueNamedFetch;
      }
      const key = `${input.exact ? "exact-" : ""}fetch-parameter-default:${expression.name}:${parameter.scopeStart}`;
      if (input.resolving.has(key)) {
        return false;
      }
      const resolving = new Set(input.resolving);
      resolving.add(key);
      return isFetchLikeCallTarget({
        ...input,
        before: parameter.defaultExpression.start ?? parameter.scopeStart,
        node: parameter.defaultExpression,
        resolving,
      });
    }

    const variables = resolvePossibleBindings(
      input.bindings,
      expression.name,
      input.before,
    );
    if (variables.length > 0) {
      for (const variable of variables) {
        const transports = resolvePossibleTransportBindings(
          input.analysis.transportBindings,
          expression.name,
          variable.start,
        );
        if (
          transports.some((transport) =>
            transport.kind === "call" && transport.start === variable.start
          )
        ) {
          return true;
        }
        if (
          variable.typeAnnotation &&
          (
            typeTextIsFetchCallable(
              variable.typeAnnotation,
              fetchTypeNames,
            ) ||
            (input.exact
              ? looksLikeExactFetchFunctionType(variable.typeAnnotation)
              : looksLikeFetchFunctionType(variable.typeAnnotation))
          )
        ) {
          return true;
        }
        if (
          !input.exact &&
          /^fetch(?:er|Impl|Implementation)?$/u.test(expression.name) &&
          variable.typeAnnotation &&
          typeTextIsOpaqueNamedReference(variable.typeAnnotation)
        ) {
          return true;
        }
        const key = `${input.exact ? "exact-" : ""}fetch-variable:${expression.name}:${variable.start}`;
        if (input.resolving.has(key)) {
          continue;
        }
        const resolving = new Set(input.resolving);
        resolving.add(key);
        if (
          readVariableBindingPossibleValues(
            variable,
            input.bindings,
            input.analysis.sourceFile,
          ).some(
            (value) =>
              isFetchLikeCallTarget({
                ...input,
                before: variable.start,
                node: value,
                resolving,
              }) ||
              functionHasFetchCallSignature(
                value,
                input.contents,
                input.exact,
              ) ||
              functionDirectlyForwardsToFetch({
                ...input,
                before: variable.start,
                node: value,
                resolving,
              }),
          )
        ) {
          return true;
        }
      }
      return false;
    }

    const callable = resolveFunctionBinding(
      input.analysis.functionBindings,
      expression.name,
      input.before,
    );
    if (callable) {
      const key = `${input.exact ? "exact-" : ""}fetch-function:${expression.name}:${callable.start}`;
      if (input.resolving.has(key)) {
        return false;
      }
      const resolving = new Set(input.resolving);
      resolving.add(key);
      return functionHasFetchCallSignature(
        callable.node,
        input.contents,
        input.exact,
      ) || functionDirectlyForwardsToFetch({
        ...input,
        before: callable.start,
        node: callable.node,
        resolving,
      });
    }

    const latestExpression = latestTransports.find(
      (transport) => transport.kind === "expression" && transport.initializer,
    );
    if (latestExpression?.initializer) {
      const key = `${input.exact ? "exact-" : ""}fetch-unbound-assignment:${expression.name}:${latestExpression.start}`;
      if (input.resolving.has(key)) {
        return false;
      }
      const resolving = new Set(input.resolving);
      resolving.add(key);
      return isFetchLikeCallTarget({
        ...input,
        before: latestExpression.start,
        node: latestExpression.initializer,
        resolving,
      });
    }
    return latestTransports.length > 0
      ? latestTransports.some((transport) => transport.kind === "call")
      : expression.name === "fetch";
  }

  if (isMemberExpression(expression) || isOptionalMemberExpression(expression)) {
    const fetchInvocationMethod = readPropertyName(expression.property);
    if (["call", "apply"].includes(fetchInvocationMethod ?? "")) {
      return isFetchLikeCallTarget({
        ...input,
        node: expression.object,
      });
    }
    const directStaticModule = readStaticTransportModule(expression.object);
    if (directStaticModule) {
      if (
        directStaticModule.source === "require" &&
        !isUnshadowedGlobalIdentifier({
          analysis: input.analysis,
          before: input.before,
          bindings: input.bindings,
          name: "require",
        })
      ) {
        return false;
      }
      const directTransport = classifyHttpTransportModule(
        directStaticModule.moduleName,
      );
      const directMethod = readPropertyName(expression.property);
      return Boolean(
        directTransport &&
        directMethod &&
        isHttpTransportMethod(directTransport, directMethod),
      );
    }
    const pathParts = readMemberPath(expression);
    if (!pathParts) {
      return false;
    }
    const pathText = pathParts.join(".");
    if (/^(?:globalThis|self|window)\.fetch$/u.test(pathText)) {
      return true;
    }
    const terminal = pathParts.at(-1) ?? "";
    const root = pathParts[0];
    const effectiveNamespaceTransports = readTransportNamespaceKinds(
      expression.object,
      input.analysis.transportBindings,
      input.bindings,
      input.before,
      input.analysis.sourceFile,
    );
    if (
      effectiveNamespaceTransports.some((transport) =>
        isHttpTransportMethod(transport, terminal)
      ) &&
      !resolveParameterBinding(
        input.analysis.parameterBindings,
        root ?? "",
        input.before,
      )
    ) {
      return true;
    }
    const transportBindings = root
      ? resolvePossibleTransportBindings(
          input.analysis.transportBindings,
          root,
          input.before,
        )
      : [];
    const variableBinding = root
      ? resolveBinding(input.bindings, root, input.before)
      : null;
    if (
      root &&
      transportBindings.some((transportBinding) =>
        transportBinding.kind === "namespace" &&
        transportBinding.transport !== null &&
        isHttpTransportMethod(transportBinding.transport, terminal) &&
        (
          !variableBinding || variableBinding.start === transportBinding.start
        )
      ) &&
      !resolveParameterBinding(
        input.analysis.parameterBindings,
        root,
        input.before,
      )
    ) {
      return true;
    }
    if (!input.exact && /^fetch(?:er|Impl|Implementation)?$/u.test(terminal)) {
      return true;
    }
    if (pathParts[0] === "this") {
      const binding = resolveMemberBinding(
        input.analysis.memberBindings,
        pathText,
        input.before,
      );
      if (!binding) {
        return false;
      }
      if (
        binding.typeAnnotation &&
        (
          typeTextIsFetchCallable(
            binding.typeAnnotation,
            fetchTypeNames,
          ) ||
          (input.exact
            ? looksLikeExactFetchFunctionType(binding.typeAnnotation)
            : looksLikeFetchFunctionType(binding.typeAnnotation))
        )
      ) {
        return true;
      }
      if (!binding.initializer) {
        return false;
      }
      const key = `fetch-member:${pathText}:${binding.start}`;
      if (input.resolving.has(key)) {
        return false;
      }
      const resolving = new Set(input.resolving);
      resolving.add(key);
      return isFetchLikeCallTarget({
        ...input,
        before: binding.start,
        node: binding.initializer,
        resolving,
      });
    }
    const staticInitializer = resolveStaticMemberInitializer(
      expression,
      input.bindings,
      input.before,
      input.analysis.sourceFile,
    );
    if (staticInitializer) {
      const key = `${input.exact ? "exact-" : ""}fetch-static-member:${pathText}:${staticInitializer.start ?? 0}`;
      if (input.resolving.has(key)) {
        return false;
      }
      const resolving = new Set(input.resolving);
      resolving.add(key);
      return isFetchLikeCallTarget({
        ...input,
        before: staticInitializer.start ?? input.before,
        node: staticInitializer,
        resolving,
      });
    }
    for (const possible of readPossibleStaticMemberInitializers(
      expression,
      input.bindings,
      input.before,
      input.analysis.sourceFile,
    )) {
      const key = `${input.exact ? "exact-" : ""}fetch-possible-static-member:${pathText}:${possible.start ?? 0}`;
      if (input.resolving.has(key)) {
        continue;
      }
      const resolving = new Set(input.resolving);
      resolving.add(key);
      if (
        isFetchLikeCallTarget({
          ...input,
          before: possible.start ?? input.before,
          node: possible,
          resolving,
        })
      ) {
        return true;
      }
    }
    const parameter = root
      ? resolveParameterBinding(
          input.analysis.parameterBindings,
          root,
          input.before,
        )
      : null;
    return Boolean(
      parameter?.typeAnnotation &&
      (
        typeTextHasFetchProperty(
          parameter.typeAnnotation,
          terminal,
          fetchTypeNames,
          input.exact,
        ) ||
        (
          !input.exact &&
          /^fetch(?:er|Impl|Implementation)?$/u.test(terminal) &&
          typeTextIsOpaqueNamedReference(parameter.typeAnnotation)
        )
      ),
    );
  }

  if (expression.type === "LogicalExpression") {
    return isFetchLikeCallTarget({ ...input, node: expression.left }) ||
      isFetchLikeCallTarget({ ...input, node: expression.right });
  }
  if (expression.type === "ConditionalExpression") {
    return isFetchLikeCallTarget({ ...input, node: expression.consequent }) ||
      isFetchLikeCallTarget({ ...input, node: expression.alternate });
  }
  if (expression.type === "SequenceExpression") {
    return expression.expressions.some((child) =>
      isFetchLikeCallTarget({ ...input, node: child })
    );
  }
  if (isCallExpression(expression) || isOptionalCallExpression(expression)) {
    const requiredModule = readRequiredModuleName(expression);
    if (requiredModule) {
      if (!isUnshadowedGlobalIdentifier({
        analysis: input.analysis,
        before: input.before,
        bindings: input.bindings,
        name: "require",
      })) {
        return false;
      }
      return classifyHttpTransportModule(requiredModule) === "fetch-package";
    }
    const pathParts = readMemberPath(expression.callee);
    return pathParts?.at(-1) === "bind" &&
      (isMemberExpression(expression.callee) ||
        isOptionalMemberExpression(expression.callee)) &&
      isFetchLikeCallTarget({ ...input, node: expression.callee.object });
  }
  return false;
}

function typeTextHasFetchProperty(
  typeText: string,
  propertyName: string,
  fetchTypeNames: ReadonlySet<string>,
  exact = false,
): boolean {
  const property = escapeRegExp(propertyName);
  const declaration = new RegExp(
    `\\b${property}\\??\\s*:\\s*([^;,}]+)`,
    "u",
  ).exec(typeText)?.[1];
  if (declaration) {
    return typeTextIsFetchCallable(declaration, fetchTypeNames) ||
      (exact
        ? looksLikeExactFetchFunctionType(declaration)
        : looksLikeFetchFunctionType(declaration));
  }
  return new RegExp(`\\b${property}\\s*\\(`, "u").test(typeText) &&
    (exact
      ? looksLikeExactFetchCallableSignature(typeText.slice(typeText.search(
          new RegExp(`\\b${property}\\s*\\(`, "u"),
        )))
      : looksLikeFetchCallableSignature(typeText.slice(typeText.search(
          new RegExp(`\\b${property}\\s*\\(`, "u"),
        ))));
}

function stripLeadingTypeAnnotation(typeText: string): string {
  return typeText.trim().replace(/^:\s*/u, "");
}

function typeTextIsOpaqueNamedReference(typeText: string): boolean {
  return /^(?:[A-Z_$][A-Za-z0-9_$]*\.)*[A-Z_$][A-Za-z0-9_$]*(?:<[^{};]+>)?$/u
    .test(stripLeadingTypeAnnotation(typeText).replace(/\s+/gu, ""));
}

function compareViolations(
  left: ProviderRequestBoundaryViolation,
  right: ProviderRequestBoundaryViolation,
): number {
  return left.filePath.localeCompare(right.filePath) ||
    left.line - right.line ||
    left.column - right.column ||
    left.kind.localeCompare(right.kind) ||
    left.boundary.localeCompare(right.boundary);
}

function collectVariableBindings(
  sourceFile: Node,
  contents: string,
): Map<string, VariableBinding[]> {
  const scopes = collectLexicalScopes(sourceFile);
  const conditionalAssignmentStarts = collectConditionalAssignmentStarts(
    sourceFile,
  );
  const bindings = new Map<string, VariableBinding[]>();

  const addPatternBindings = (input: {
    readonly assignment: boolean;
    readonly definitive: boolean;
    readonly initializer: Expression;
    readonly node: Node;
    readonly pattern: Node;
  }): void => {
    const lexicalScope = findInnermostLexicalScope(
      scopes,
      input.node.start ?? 0,
    );
    for (const entry of readVariablePatternEntries(input.pattern, contents)) {
      const current = bindings.get(entry.name) ?? [];
      const previous = resolveBinding(
        bindings,
        entry.name,
        input.node.start ?? 0,
      );
      current.push({
        conditionallyExecuted: !input.definitive,
        defaultExpression: entry.defaultExpression,
        definitive:
          input.definitive &&
          (
            !input.assignment ||
            previous === null ||
            previous.scopeStart === lexicalScope.start
          ),
        identifierStart: entry.identifierStart,
        initializer: input.initializer,
        propertyPath: entry.propertyPath.length > 0
          ? entry.propertyPath
          : null,
        scopeEnd: input.assignment
          ? previous?.scopeEnd ?? lexicalScope.end
          : lexicalScope.end,
        scopeStart: input.assignment
          ? previous?.scopeStart ?? lexicalScope.start
          : lexicalScope.start,
        start: input.node.start ?? 0,
        typeAnnotation: entry.typeAnnotation ??
          (input.assignment ? previous?.typeAnnotation ?? null : null),
        writeScopeEnd: lexicalScope.end,
        writeScopeStart: lexicalScope.start,
      });
      bindings.set(entry.name, current);
    }
  };

  traverseFast(sourceFile, (node) => {
    if (
      isAssignmentExpression(node) &&
      node.operator === "=" &&
      isExpression(node.right)
    ) {
      addPatternBindings({
        assignment: true,
        definitive: !conditionalAssignmentStarts.has(node.start ?? 0),
        initializer: node.right,
        node,
        pattern: node.left,
      });
      return;
    }
    if (!isVariableDeclarator(node) || !node.init) {
      return;
    }
    addPatternBindings({
      assignment: false,
      definitive: true,
      initializer: node.init,
      node,
      pattern: node.id,
    });
  });
  return bindings;
}

function readVariablePatternEntries(
  node: Node,
  contents: string,
  propertyPath: readonly string[] = [],
  defaultExpression: Expression | null = null,
): Array<{
  readonly defaultExpression: Expression | null;
  readonly identifierStart: number;
  readonly name: string;
  readonly propertyPath: readonly string[];
  readonly typeAnnotation: string | null;
}> {
  if (isIdentifier(node)) {
    return [{
      defaultExpression,
      identifierStart: node.start ?? 0,
      name: node.name,
      propertyPath,
      typeAnnotation: node.typeAnnotation
        ? readNodeText(node.typeAnnotation, contents)
        : null,
    }];
  }
  if (node.type === "AssignmentPattern") {
    return readVariablePatternEntries(
      node.left,
      contents,
      propertyPath,
      node.right,
    );
  }
  if (node.type === "RestElement") {
    return readVariablePatternEntries(
      node.argument,
      contents,
      propertyPath,
      defaultExpression,
    );
  }
  if (node.type === "ObjectPattern") {
    return node.properties.flatMap((property) => {
      if (property.type === "RestElement") {
        return readVariablePatternEntries(
          property.argument,
          contents,
          propertyPath,
          defaultExpression,
        );
      }
      if (!isObjectProperty(property)) {
        return [];
      }
      const propertyName = readPropertyName(property.key);
      return propertyName
        ? readVariablePatternEntries(
            property.value,
            contents,
            [...propertyPath, propertyName],
            defaultExpression,
          )
        : [];
    });
  }
  if (node.type === "ArrayPattern") {
    return node.elements.flatMap((element, index) =>
      element
        ? readVariablePatternEntries(
            element,
            contents,
            [...propertyPath, String(index)],
            defaultExpression,
          )
        : []
    );
  }
  return [];
}

function collectConditionalAssignmentStarts(sourceFile: Node): Set<number> {
  const starts = new Set<number>();
  const visit = (node: Node, conditional: boolean): void => {
    if (conditional && isAssignmentExpression(node)) {
      starts.add(node.start ?? 0);
    }
    for (const key of VISITOR_KEYS[node.type] ?? []) {
      const value: unknown = Reflect.get(node, key);
      const childConditional = isConditionallyExecutedChild(node, key);
      for (const child of Array.isArray(value) ? value : [value]) {
        if (!isBabelNode(child)) {
          continue;
        }
        visit(
          child,
          isFunction(node) && key === "body"
            ? false
            : conditional || childConditional,
        );
      }
    }
  };

  visit(sourceFile, false);

  return starts;
}

function isBabelNode(value: unknown): value is Node {
  return value !== null &&
    typeof value === "object" &&
    "type" in value &&
    typeof value.type === "string";
}

function isConditionallyExecutedChild(node: Node, key: string): boolean {
  switch (node.type) {
    case "ConditionalExpression":
      return key === "consequent" || key === "alternate";
    case "DoWhileStatement":
    case "WhileStatement":
      return key === "body";
    case "ForInStatement":
    case "ForOfStatement":
      return key === "left" || key === "body";
    case "ForStatement":
      return key === "test" || key === "update" || key === "body";
    case "IfStatement":
      return key === "consequent" || key === "alternate";
    case "LogicalExpression":
      return key === "right";
    case "SwitchCase":
      return key === "test" || key === "consequent";
    case "CatchClause":
      return key === "body";
    case "TryStatement":
      return key === "block" || key === "handler";
    default:
      return false;
  }
}

function collectLexicalScopes(sourceFile: Node): LexicalScope[] {
  const scopes: LexicalScope[] = [];
  traverseFast(sourceFile, (node) => {
    if (
      node.type === "Program" ||
      node.type === "BlockStatement" ||
      node.type === "CatchClause" ||
      node.type === "ForInStatement" ||
      node.type === "ForOfStatement" ||
      node.type === "ForStatement" ||
      node.type === "StaticBlock" ||
      node.type === "SwitchStatement" ||
      node.type === "TSModuleBlock"
    ) {
      scopes.push({
        end: node.end ?? Number.MAX_SAFE_INTEGER,
        start: node.start ?? 0,
      });
    }
  });
  return scopes;
}

function findInnermostLexicalScope(
  scopes: readonly LexicalScope[],
  position: number,
): LexicalScope {
  let resolved: LexicalScope = {
    end: Number.MAX_SAFE_INTEGER,
    start: 0,
  };
  for (const scope of scopes) {
    if (
      scope.start <= position &&
      position <= scope.end &&
      scope.start >= resolved.start &&
      scope.end <= resolved.end
    ) {
      resolved = scope;
    }
  }
  return resolved;
}

function collectUnsafeProviderRequestComposition(input: {
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly boundary: string;
  readonly contents: string;
  readonly node: Node;
  readonly relativePath: string;
  readonly resolvingBindings: ReadonlySet<string>;
  readonly violationsByKey: Map<string, ProviderRequestBoundaryViolation>;
}): void {
  const { node } = input;

  if (isIdentifier(node)) {
    const binding = resolveBinding(input.bindings, node.name, node.start ?? Number.MAX_SAFE_INTEGER);
    if (!binding || input.resolvingBindings.has(node.name)) {
      return;
    }
    const resolvingBindings = new Set(input.resolvingBindings);
    resolvingBindings.add(node.name);
    collectUnsafeProviderRequestComposition({
      ...input,
      node: binding.initializer,
      resolvingBindings,
    });
    return;
  }

  if (isObjectExpression(node)) {
    for (const property of node.properties) {
      if (isSpreadElement(property)) {
        recordViolation(input, property, "object-spread");
        collectUnsafeProviderRequestComposition({ ...input, node: property.argument });
        continue;
      }
      if (isObjectProperty(property)) {
        collectUnsafeProviderRequestComposition({ ...input, node: property.value });
      }
    }
    return;
  }

  if (
    (isCallExpression(node) || isOptionalCallExpression(node)) &&
    isObjectAssignCall(node)
  ) {
    recordViolation(input, node, "object-assign");
    for (const argument of node.arguments) {
      if (argument.type !== "ArgumentPlaceholder") {
        collectUnsafeProviderRequestComposition({ ...input, node: argument });
      }
    }
    return;
  }

  switch (node.type) {
    case "ArrayExpression":
      for (const element of node.elements) {
        if (element) {
          collectUnsafeProviderRequestComposition({
            ...input,
            node: isSpreadElement(element) ? element.argument : element,
          });
        }
      }
      return;
    case "AssignmentExpression":
      collectUnsafeProviderRequestComposition({ ...input, node: node.right });
      return;
    case "ConditionalExpression":
      collectUnsafeProviderRequestComposition({ ...input, node: node.consequent });
      collectUnsafeProviderRequestComposition({ ...input, node: node.alternate });
      return;
    case "LogicalExpression":
      collectUnsafeProviderRequestComposition({ ...input, node: node.left });
      collectUnsafeProviderRequestComposition({ ...input, node: node.right });
      return;
    case "SequenceExpression":
      for (const expression of node.expressions) {
        collectUnsafeProviderRequestComposition({ ...input, node: expression });
      }
      return;
    case "TSAsExpression":
    case "TSInstantiationExpression":
    case "TSNonNullExpression":
    case "TSSatisfiesExpression":
    case "TypeCastExpression":
      collectUnsafeProviderRequestComposition({ ...input, node: node.expression });
      return;
    default:
      return;
  }
}

function recordUntypedRequestObject(input: {
  readonly argument: Node;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly boundary: string;
  readonly contents: string;
  readonly relativePath: string;
  readonly violationsByKey: Map<string, ProviderRequestBoundaryViolation>;
}): void {
  const argument = unwrapExpression(input.argument);
  if (!isIdentifier(argument)) {
    return;
  }
  const binding = resolveBinding(
    input.bindings,
    argument.name,
    argument.start ?? Number.MAX_SAFE_INTEGER,
  );
  if (
    !binding ||
    binding.typeAnnotation !== null ||
    !isInlineObjectConstruction(binding.initializer)
  ) {
    return;
  }
  recordViolationAtPosition(
    input,
    binding.identifierStart,
    "untyped-request-object",
  );
}

function recordViolation(
  input: {
    readonly boundary: string;
    readonly contents: string;
    readonly relativePath: string;
    readonly violationsByKey: Map<string, ProviderRequestBoundaryViolation>;
  },
  node: Node,
  kind: ProviderRequestBoundaryViolationKind,
): void {
  recordViolationAtPosition(input, node.start ?? 0, kind);
}

function recordViolationAtPosition(
  input: {
    readonly boundary: string;
    readonly contents: string;
    readonly relativePath: string;
    readonly violationsByKey: Map<string, ProviderRequestBoundaryViolation>;
  },
  start: number,
  kind: ProviderRequestBoundaryViolationKind,
): void {
  const key = `${kind}:${start}`;
  if (input.violationsByKey.has(key)) {
    return;
  }
  const position = readLineAndColumn(input.contents, start);
  input.violationsByKey.set(key, {
    boundary: input.boundary,
    column: position.column,
    filePath: normalizeRepoPath(input.relativePath),
    kind,
    line: position.line,
  });
}

function resolveBinding(
  bindings: ReadonlyMap<string, readonly VariableBinding[]>,
  name: string,
  before: number,
  scopePosition = before,
): VariableBinding | null {
  const candidates = bindings.get(name);
  if (!candidates) {
    return null;
  }
  let resolved: VariableBinding | null = null;
  for (const candidate of candidates) {
    if (
      candidate.start <= before &&
      candidate.scopeStart <= scopePosition &&
      scopePosition <= candidate.scopeEnd &&
      (
        !resolved ||
        candidate.scopeStart > resolved.scopeStart ||
        (
          candidate.scopeStart === resolved.scopeStart &&
          candidate.start > resolved.start
        )
      )
    ) {
      resolved = candidate;
    }
  }
  return resolved;
}

function resolvePossibleBindings(
  bindings: ReadonlyMap<string, readonly VariableBinding[]>,
  name: string,
  before: number,
  scopePosition = before,
): VariableBinding[] {
  const possible: VariableBinding[] = [];
  let position = before;
  while (true) {
    const binding = resolveBinding(bindings, name, position, scopePosition);
    if (!binding || possible.some((candidate) => candidate.start === binding.start)) {
      return possible;
    }
    possible.push(binding);
    if (binding.definitive) {
      return possible;
    }
    position = binding.start - 1;
  }
}

function isProviderRequestCall(
  node: Node,
  analysis: ProviderSourceAnalysis,
): node is CallExpression | OptionalCallExpression {
  if (!isCallExpression(node) && !isOptionalCallExpression(node)) {
    return false;
  }
  if (isIdentifier(node.callee) && analysis.methodAliases.has(node.callee.name)) {
    return true;
  }
  const pathParts = readMemberPath(node.callee);
  return Boolean(pathParts && isProviderMemberPath(pathParts, analysis.clientNames));
}

function isProviderMemberPath(
  pathParts: readonly string[],
  clientNames: ReadonlySet<string>,
): boolean {
  const clientIndex = pathParts.findIndex(
    (part) =>
      clientNames.has(part) ||
      providerClientFactoryNames.has(part) ||
      part.toLowerCase() === "stripe",
  );
  return clientIndex >= 0 && pathParts.length > clientIndex + 1;
}

function readProviderBoundaryName(
  node: CallExpression | OptionalCallExpression,
  analysis: ProviderSourceAnalysis,
  contents: string,
): string {
  if (isIdentifier(node.callee)) {
    return analysis.methodAliases.get(node.callee.name) ?? node.callee.name;
  }
  return readNodeText(node.callee, contents);
}

function isProviderRequestTypeText(
  typeText: string,
  analysis: Pick<ProviderSourceAnalysis, "requestTypeNames" | "typeRoots">,
): boolean {
  for (const name of analysis.requestTypeNames) {
    if (containsIdentifier(typeText, name)) {
      return true;
    }
  }
  for (const root of analysis.typeRoots) {
    if (
      new RegExp(`\\b${escapeRegExp(root)}\\b[\\s\\S]*(?:Params?|RequestOptions)\\b`, "u")
        .test(typeText) ||
      (
        /\bParameters\s*</u.test(typeText) &&
        containsIdentifier(typeText, root)
      )
    ) {
      return true;
    }
  }
  return false;
}

function typeTextIsProviderClient(
  typeText: string,
  typeRoots: ReadonlySet<string>,
): boolean {
  const normalized = typeText.replace(/^\s*:\s*/u, "").trim();
  for (const root of typeRoots) {
    if (
      new RegExp(
        `^(?:(?:Pick|Readonly|Required)\\s*<\\s*)?${escapeRegExp(root)}\\b`,
        "u",
      ).test(normalized)
    ) {
      return true;
    }
  }
  return false;
}

function textReferencesProviderClient(
  text: string,
  clientNames: ReadonlySet<string>,
): boolean {
  if (/(?:JunctionClient|StripeApi|StripeClient)\b/u.test(text)) {
    return true;
  }
  for (const name of clientNames) {
    if (containsIdentifier(text, name)) {
      return true;
    }
  }
  return false;
}

function containsProviderSourceMarker(contents: string): boolean {
  const lowerContents = contents.toLowerCase();
  return providerSourceMarkers.some((marker) => lowerContents.includes(marker));
}

function isProviderModule(moduleName: string): boolean {
  return providerModulePrefixes.some(
    (prefix) => moduleName === prefix || moduleName.startsWith(`${prefix}/`),
  );
}

function readImportedName(specifier: Node & { imported?: Node }): string {
  if (!specifier.imported) {
    return "";
  }
  if (isIdentifier(specifier.imported)) {
    return specifier.imported.name;
  }
  if (isStringLiteral(specifier.imported)) {
    return specifier.imported.value;
  }
  return "";
}

function isObjectAssignCall(node: CallExpression | OptionalCallExpression): boolean {
  const pathParts = readMemberPath(node.callee);
  return pathParts?.join(".") === "Object.assign";
}

function isInlineObjectConstruction(node: Node): boolean {
  const expression = unwrapExpression(node);
  if (isObjectExpression(expression)) {
    return true;
  }
  if (expression.type === "ConditionalExpression") {
    return isInlineObjectConstruction(expression.consequent) ||
      isInlineObjectConstruction(expression.alternate);
  }
  if (expression.type === "LogicalExpression") {
    return isInlineObjectConstruction(expression.left) ||
      isInlineObjectConstruction(expression.right);
  }
  return false;
}

function unwrapExpression(node: Node): Node {
  switch (node.type) {
    case "TSAsExpression":
    case "TSInstantiationExpression":
    case "TSNonNullExpression":
    case "TSSatisfiesExpression":
    case "TypeCastExpression":
      return unwrapExpression(node.expression);
    default:
      return node;
  }
}

function readMemberPath(node: Node): string[] | null {
  if (isIdentifier(node)) {
    return [node.name];
  }
  if (node.type === "ThisExpression") {
    return ["this"];
  }
  if (isMemberExpression(node) || isOptionalMemberExpression(node)) {
    const property = node.property;
    const propertyName = !node.computed && isIdentifier(property)
      ? property.name
      : node.computed && isStringLiteral(property)
        ? property.value
        : node.computed && isNumericLiteral(property)
          ? String(property.value)
        : null;
    if (!propertyName) {
      return null;
    }
    const objectPath = readMemberPath(node.object);
    return objectPath ? [...objectPath, propertyName] : null;
  }
  if (isCallExpression(node) || isOptionalCallExpression(node)) {
    return readMemberPath(node.callee);
  }
  return null;
}

function readFunctionName(node: Node): string {
  if ("id" in node && node.id && isIdentifier(node.id)) {
    return node.id.name;
  }
  return "<anonymous>";
}

async function scanDirectory(
  relativePath: string,
  violations: ProviderRequestBoundaryViolation[],
): Promise<void> {
  const entries = await readdir(path.join(repoRoot, relativePath), { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const entryRelativePath = path.posix.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipProviderRequestDirectory(entry.name)) {
        await scanDirectory(entryRelativePath, violations);
      }
      continue;
    }
    if (!entry.isFile() || !shouldScanProviderRequestSourceFile(entryRelativePath)) {
      continue;
    }
    const contents = await readFile(path.join(repoRoot, entryRelativePath), "utf8");
    violations.push(
      ...findProviderRequestBoundaryViolations(entryRelativePath, contents),
    );
  }
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

function formatViolationKind(kind: ProviderRequestBoundaryViolationKind): string {
  switch (kind) {
    case "handwritten-provider-transport":
      return "declares a handwritten provider transport contract";
    case "object-assign":
      return "uses Object.assign";
    case "object-spread":
      return "contains an object spread";
    case "raw-provider-http":
      return "uses raw provider HTTP";
    case "untyped-request-object":
      return "passes an untyped object-literal variable";
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

function containsIdentifier(text: string, identifier: string): boolean {
  return new RegExp(`\\b${escapeRegExp(identifier)}\\b`, "u").test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function lowercaseInitial(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toLowerCase()}${value.slice(1)}`;
}

if (isProviderRequestGuardEntrypoint(process.argv[1], import.meta.url)) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
