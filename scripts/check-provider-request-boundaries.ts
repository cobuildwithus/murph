import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse, type ParserPlugin } from "@babel/parser";
import {
  isCallExpression,
  isClassProperty,
  isFunction,
  isIdentifier,
  isImportDeclaration,
  isImportDefaultSpecifier,
  isImportNamespaceSpecifier,
  isImportSpecifier,
  isMemberExpression,
  isObjectExpression,
  isObjectProperty,
  isOptionalCallExpression,
  isOptionalMemberExpression,
  isReturnStatement,
  isSpreadElement,
  isStringLiteral,
  isTSTypeAliasDeclaration,
  isVariableDeclarator,
  traverseFast,
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
  "coverage",
  "dist",
  "e2e",
  "fixtures",
  "generated",
  "node_modules",
  "test",
  "tests",
]);
const providerModulePrefixes = [
  "@composio/client",
  "@elevenlabs/elevenlabs-js",
  "@google-cloud/kms",
  "@junction-api/sdk",
  "@linqapp/sdk",
  "@lob/lob-typescript-sdk",
  "@onkernel/sdk",
  "@temporalio/client",
  "exa-js",
  "google-auth-library",
  "openai",
  "resend",
  "retell-sdk",
  "stripe",
] as const;
const providerSourceMarkers = [
  "@composio/client",
  "@elevenlabs/elevenlabs-js",
  "@google-cloud/kms",
  "@junction-api/sdk",
  "@linqapp/sdk",
  "@lob/lob-typescript-sdk",
  "@onkernel/sdk",
  "@temporalio/client",
  "exa-js",
  "google-auth-library",
  "openai",
  "resend",
  "retell-sdk",
  "stripe",
] as const;
const knownProviderApiOrigins = [
  {
    originPattern: /https:\/\/api\.elevenlabs\.io(?=[:/?#]|$)/iu,
    provider: "ElevenLabs",
  },
  {
    originPattern: /https:\/\/api\.exa\.ai(?=[:/?#]|$)/iu,
    provider: "Exa",
  },
  {
    originPattern: /https:\/\/api(?:\.sandbox)?\.(?:eu|us)\.junction\.com(?=[:/?#]|$)/iu,
    provider: "Junction",
  },
  {
    originPattern: /https:\/\/api\.linqapp\.com(?=[:/?#]|$)/iu,
    provider: "Linq",
  },
  {
    originPattern: /https:\/\/api\.lob\.com(?=[:/?#]|$)/iu,
    provider: "Lob",
  },
  {
    originPattern: /https:\/\/api\.openai\.com(?=[:/?#]|$)/iu,
    provider: "OpenAI",
  },
  {
    originPattern: /https:\/\/api\.resend\.com(?=[:/?#]|$)/iu,
    provider: "Resend",
  },
  {
    originPattern: /https:\/\/cloudkms\.googleapis\.com(?=[:/?#]|$)/iu,
    provider: "Google Cloud KMS",
  },
  {
    originPattern: /https:\/\/iamcredentials\.googleapis\.com(?=[:/?#]|$)/iu,
    provider: "Google Cloud IAM Credentials",
  },
  {
    originPattern: /https:\/\/sts\.googleapis\.com(?=[:/?#]|$)/iu,
    provider: "Google Cloud STS",
  },
] as const;
const knownProviderApiHostMarkers = [
  "api.elevenlabs.io",
  "api.exa.ai",
  "api.eu.junction.com",
  "api.linqapp.com",
  "api.lob.com",
  "api.openai.com",
  "api.resend.com",
  "api.sandbox.eu.junction.com",
  "api.sandbox.us.junction.com",
  "api.us.junction.com",
  "cloudkms.googleapis.com",
  "iamcredentials.googleapis.com",
  "sts.googleapis.com",
] as const;
const providerSdkModulePrefixesByProvider: Readonly<Record<string, readonly string[]>> = {
  ElevenLabs: ["@elevenlabs/elevenlabs-js"],
  Exa: ["exa-js"],
  Junction: ["@junction-api/sdk"],
  Linq: ["@linqapp/sdk"],
  Lob: ["@lob/lob-typescript-sdk"],
  OpenAI: ["openai"],
  Resend: ["resend"],
  "Google Cloud IAM Credentials": ["google-auth-library"],
  "Google Cloud KMS": ["@google-cloud/kms", "google-auth-library"],
  "Google Cloud STS": ["google-auth-library"],
};
const rawProviderHttpAllowlistReasons = new Set([
  "linq-presigned-bytes",
  "sdk-transport-adapter",
]);
const rawProviderHttpAllowlistPattern =
  /^\s*\/\/\s*provider-request-boundary-allow-next-line:\s*([a-z0-9-]+)\s*$/u;
const providerClientFactoryNames = new Set([
  "requireHostedStripeApi",
]);
const providerRequestTypeNamePattern =
  /(?:ConnectionOptions|Create(?:Batch|Email)(?:Request)?Options|MediaPart|MessageContent|Params?(?:NonStreaming|Streaming)?|RequestOptions|TextPart)$/u;

type ProviderRequestBoundaryViolationKind =
  | "object-assign"
  | "object-spread"
  | "raw-provider-http"
  | "untyped-request-object";

interface VariableBinding {
  readonly identifierStart: number;
  readonly initializer: Expression;
  readonly scopeEnd: number;
  readonly scopeStart: number;
  readonly start: number;
  readonly typeAnnotation: string | null;
}

interface LexicalScope {
  readonly end: number;
  readonly start: number;
}

interface ProviderSourceAnalysis {
  readonly clientNames: ReadonlySet<string>;
  readonly methodAliases: ReadonlyMap<string, string>;
  readonly providerModules: ReadonlySet<string>;
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
  return violations;
}

export function findProviderRequestBoundaryViolations(
  relativePath: string,
  contents: string,
): ProviderRequestBoundaryViolation[] {
  if (
    !containsProviderSourceMarker(contents) &&
    !containsKnownProviderApiOrigin(contents)
  ) {
    return [];
  }

  const sourceFile = parse(contents, {
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    allowUndeclaredExports: true,
    attachComment: false,
    plugins: parserPlugins(relativePath),
    sourceFilename: relativePath,
    sourceType: "unambiguous",
  });
  const analysis = analyzeProviderSource(sourceFile, contents);
  if (
    analysis.clientNames.size === 0 &&
    analysis.requestTypeNames.size === 0 &&
    analysis.typeRoots.size === 0
  ) {
    return [];
  }

  const bindings = collectVariableBindings(sourceFile, contents);
  const violationsByKey = new Map<string, ProviderRequestBoundaryViolation>();

  traverseFast(sourceFile, (node) => {
    const target = readRawProviderHttpTarget(node);
    if (!target) {
      return;
    }
    const allowlistReason = readRawProviderHttpAllowlistReason(
      contents,
      node.start ?? 0,
    );
    const provider = resolveKnownProviderApiOrigin({
      before: node.start ?? Number.MAX_SAFE_INTEGER,
      bindings,
      node: target,
      resolvingBindings: new Set(),
    });
    if (allowlistReason) {
      if (isAllowedRawProviderHttp({
        analysis,
        reason: allowlistReason,
        provider,
        target,
      })) {
        return;
      }
      recordViolation(
        {
          boundary: `Invalid provider HTTP exception ${allowlistReason}`,
          contents,
          relativePath,
          violationsByKey,
        },
        node,
        "raw-provider-http",
      );
      return;
    }
    if (!provider) {
      return;
    }
    recordViolation(
      {
        boundary: `Direct ${provider} provider HTTP`,
        contents,
        relativePath,
        violationsByKey,
      },
      node,
      "raw-provider-http",
    );
  });

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

  return [...violationsByKey.values()].sort((left, right) =>
    left.line - right.line || left.column - right.column ||
    left.kind.localeCompare(right.kind)
  );
}

export async function main(): Promise<void> {
  const violations = await collectProviderRequestBoundaryViolations();
  if (violations.length === 0) {
    console.log("Provider request boundaries use explicit typed object construction.");
    return;
  }

  throw new Error([
    "Found unsafe provider request object construction.",
    "Use an official SDK request type, initialize visible fields directly, and assign optional fields individually.",
    ...violations.map(
      (violation) =>
        `- ${violation.filePath}:${violation.line}:${violation.column} ${formatViolationKind(violation.kind)} at \`${violation.boundary}\``,
    ),
  ].join("\n"));
}

function analyzeProviderSource(sourceFile: Node, contents: string): ProviderSourceAnalysis {
  const clientNames = new Set<string>();
  const providerModules = new Set<string>();
  const requestTypeNames = new Set<string>();
  const typeRoots = new Set<string>();

  traverseFast(sourceFile, (node) => {
    if (!isImportDeclaration(node) || !isProviderModule(node.source.value)) {
      return;
    }
    providerModules.add(node.source.value);
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
    providerModules,
    requestTypeNames,
    typeRoots,
  };
}

function collectVariableBindings(
  sourceFile: Node,
  contents: string,
): Map<string, VariableBinding[]> {
  const scopes = collectLexicalScopes(sourceFile);
  const bindings = new Map<string, VariableBinding[]>();
  traverseFast(sourceFile, (node) => {
    if (!isVariableDeclarator(node) || !isIdentifier(node.id) || !node.init) {
      return;
    }
    const current = bindings.get(node.id.name) ?? [];
    const scope = findInnermostLexicalScope(scopes, node.start ?? 0);
    current.push({
      identifierStart: node.id.start ?? node.start ?? 0,
      initializer: node.init,
      scopeEnd: scope.end,
      scopeStart: scope.start,
      start: node.start ?? 0,
      typeAnnotation: node.id.typeAnnotation
        ? readNodeText(node.id.typeAnnotation, contents)
        : null,
    });
    bindings.set(node.id.name, current);
  });
  return bindings;
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
): VariableBinding | null {
  const candidates = bindings.get(name);
  if (!candidates) {
    return null;
  }
  let resolved: VariableBinding | null = null;
  for (const candidate of candidates) {
    if (
      candidate.start <= before &&
      candidate.scopeStart <= before &&
      before <= candidate.scopeEnd &&
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

function readRawProviderHttpTarget(node: Node): Node | null {
  if (node.type === "NewExpression") {
    const calleePath = readMemberPath(node.callee);
    if (calleePath?.at(-1) !== "Request") {
      return null;
    }
    const target = node.arguments[0];
    return target && target.type !== "ArgumentPlaceholder" && target.type !== "SpreadElement"
      ? target
      : null;
  }
  if (!isCallExpression(node) && !isOptionalCallExpression(node)) {
    return null;
  }
  const calleePath = readMemberPath(node.callee);
  const calleeName = calleePath?.at(-1);
  if (!calleeName || !/fetch(?:implementation|impl)?$/iu.test(calleeName)) {
    return null;
  }
  const target = node.arguments[0];
  return target && target.type !== "ArgumentPlaceholder" && target.type !== "SpreadElement"
    ? target
    : null;
}

function resolveKnownProviderApiOrigin(input: {
  readonly before: number;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly node: Node;
  readonly resolvingBindings: ReadonlySet<string>;
}): string | null {
  for (const candidate of collectStaticUrlTexts(input)) {
    for (const origin of knownProviderApiOrigins) {
      if (origin.originPattern.test(candidate)) {
        return origin.provider;
      }
    }
  }
  return null;
}

function collectStaticUrlTexts(input: {
  readonly before: number;
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly node: Node;
  readonly resolvingBindings: ReadonlySet<string>;
}): string[] {
  const node = unwrapExpression(input.node);
  if (isStringLiteral(node)) {
    return [node.value];
  }
  if (isIdentifier(node)) {
    if (input.resolvingBindings.has(node.name)) {
      return [];
    }
    const binding = resolveBinding(input.bindings, node.name, input.before);
    if (!binding) {
      return [];
    }
    const resolvingBindings = new Set(input.resolvingBindings);
    resolvingBindings.add(node.name);
    return collectStaticUrlTexts({
      ...input,
      before: binding.start,
      node: binding.initializer,
      resolvingBindings,
    });
  }
  if (node.type === "TemplateLiteral") {
    let candidates = [node.quasis[0]?.value.cooked ?? ""];
    for (const [index, expression] of node.expressions.entries()) {
      const expressionCandidates = collectStaticUrlTexts({
        ...input,
        node: expression,
      });
      candidates = combineStaticTextCandidates(
        candidates,
        expressionCandidates.length > 0 ? expressionCandidates : [""],
        node.quasis[index + 1]?.value.cooked ?? "",
      );
    }
    return candidates;
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = collectStaticUrlTexts({ ...input, node: node.left });
    const right = collectStaticUrlTexts({ ...input, node: node.right });
    if (left.length === 0 && right.length === 0) {
      return [];
    }
    return combineStaticTextCandidates(
      left.length > 0 ? left : [""],
      right.length > 0 ? right : [""],
      "",
    );
  }
  if (node.type === "ConditionalExpression") {
    return [
      ...collectStaticUrlTexts({ ...input, node: node.consequent }),
      ...collectStaticUrlTexts({ ...input, node: node.alternate }),
    ];
  }
  if (node.type === "LogicalExpression") {
    return [
      ...collectStaticUrlTexts({ ...input, node: node.left }),
      ...collectStaticUrlTexts({ ...input, node: node.right }),
    ];
  }
  if (node.type === "SequenceExpression") {
    const last = node.expressions.at(-1);
    return last ? collectStaticUrlTexts({ ...input, node: last }) : [];
  }
  if (isMemberExpression(node) || isOptionalMemberExpression(node)) {
    const memberPath = readMemberPath(node);
    if (["href", "origin"].includes(memberPath?.at(-1) ?? "")) {
      return collectStaticUrlTexts({ ...input, node: node.object });
    }
    return [];
  }
  if (
    node.type === "NewExpression" ||
    isCallExpression(node) ||
    isOptionalCallExpression(node)
  ) {
    const calleePath = readMemberPath(node.callee);
    const calleeName = calleePath?.at(-1);
    if (["toJSON", "toString"].includes(calleeName ?? "")) {
      if (isMemberExpression(node.callee) || isOptionalMemberExpression(node.callee)) {
        return collectStaticUrlTexts({ ...input, node: node.callee.object });
      }
      return [];
    }
    if (calleeName !== "Request" && calleeName !== "URL") {
      return [];
    }
    const target = node.arguments[0];
    if (!target || target.type === "ArgumentPlaceholder" || target.type === "SpreadElement") {
      return [];
    }
    const targetCandidates = collectStaticUrlTexts({ ...input, node: target });
    if (calleeName === "Request") {
      return targetCandidates;
    }
    const base = node.arguments[1];
    if (!base || base.type === "ArgumentPlaceholder" || base.type === "SpreadElement") {
      return targetCandidates;
    }
    const baseCandidates = collectStaticUrlTexts({ ...input, node: base });
    if (baseCandidates.length === 0) {
      return targetCandidates;
    }
    const relativeCandidates = targetCandidates.length > 0 ? targetCandidates : [""];
    return combineStaticTextCandidates(baseCandidates, relativeCandidates, "");
  }
  return [];
}

function combineStaticTextCandidates(
  prefixes: readonly string[],
  values: readonly string[],
  suffix: string,
): string[] {
  const combined: string[] = [];
  for (const prefix of prefixes) {
    for (const value of values) {
      combined.push(`${prefix}${value}${suffix}`);
      if (combined.length >= 32) {
        return combined;
      }
    }
  }
  return combined;
}

function isAllowedRawProviderHttp(input: {
  readonly analysis: ProviderSourceAnalysis;
  readonly reason: string;
  readonly provider: string | null;
  readonly target: Node;
}): boolean {
  if (!rawProviderHttpAllowlistReasons.has(input.reason)) {
    return false;
  }
  if (input.reason === "sdk-transport-adapter") {
    if (!input.provider) {
      return false;
    }
    const modulePrefixes = providerSdkModulePrefixesByProvider[input.provider] ?? [];
    return hasImportedProviderModule(input.analysis.providerModules, modulePrefixes);
  }
  if (input.reason !== "linq-presigned-bytes" || input.provider !== null) {
    return false;
  }
  if (!hasImportedProviderModule(input.analysis.providerModules, ["@linqapp/sdk"])) {
    return false;
  }
  const target = unwrapExpression(input.target);
  return isIdentifier(target) && /^(?:download|upload)Url$/u.test(target.name);
}

function hasImportedProviderModule(
  providerModules: ReadonlySet<string>,
  prefixes: readonly string[],
): boolean {
  for (const moduleName of providerModules) {
    if (prefixes.some(
      (prefix) => moduleName === prefix || moduleName.startsWith(`${prefix}/`),
    )) {
      return true;
    }
  }
  return false;
}

function readRawProviderHttpAllowlistReason(
  contents: string,
  nodeStart: number,
): string | null {
  const currentLineStart = contents.lastIndexOf("\n", Math.max(0, nodeStart - 1));
  if (currentLineStart < 0) {
    return null;
  }
  const previousLineEnd = currentLineStart;
  const previousLineStart = contents.lastIndexOf("\n", previousLineEnd - 1) + 1;
  const previousLine = contents.slice(previousLineStart, previousLineEnd);
  return rawProviderHttpAllowlistPattern.exec(previousLine)?.[1] ?? null;
}

function containsProviderSourceMarker(contents: string): boolean {
  const lowerContents = contents.toLowerCase();
  return providerSourceMarkers.some((marker) => lowerContents.includes(marker));
}

function containsKnownProviderApiOrigin(contents: string): boolean {
  const lowerContents = contents.toLowerCase();
  return knownProviderApiHostMarkers.some((hostname) => lowerContents.includes(hostname));
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
    !/\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(relativePath) &&
    sourceExtensions.has(path.posix.extname(relativePath));
}

export function shouldSkipProviderRequestDirectory(name: string): boolean {
  return skippedDirectoryNames.has(name) || name.startsWith(".next");
}

function formatViolationKind(kind: ProviderRequestBoundaryViolationKind): string {
  switch (kind) {
    case "object-assign":
      return "uses Object.assign";
    case "object-spread":
      return "contains an object spread";
    case "raw-provider-http":
      return "constructs direct raw provider HTTP";
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
