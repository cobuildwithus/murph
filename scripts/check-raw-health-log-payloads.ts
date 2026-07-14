import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse, type ParserPlugin } from "@babel/parser";
import {
  isCallExpression,
  isIdentifier,
  isMemberExpression,
  isObjectProperty,
  isOptionalCallExpression,
  isOptionalMemberExpression,
  isStringLiteral,
  isTemplateLiteral,
  traverseFast,
  type Identifier,
  type MemberExpression,
  type Node,
  type OptionalMemberExpression,
} from "@babel/types";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanRoots = ["apps", "packages", "scripts"] as const;
const sourceExtensions = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const skippedDirectoryNames = new Set([
  ".deploy",
  ".next",
  ".next-dev",
  ".next-smoke",
  ".test-dist",
  ".wrangler",
  "coverage",
  "dist",
  "generated",
  "node_modules",
]);
const logMethodNames = new Set(["debug", "error", "info", "log", "warn"]);
const sensitiveVariableNames = new Set([
  "body",
  "fileText",
  "finalRequest",
  "input",
  "labReport",
  "messages",
  "output",
  "prompt",
  "response",
  "transcript",
  "vault",
]);
const metadataPropertyNames = new Set([
  "byteLength",
  "code",
  "count",
  "length",
  "ok",
  "size",
  "status",
  "statusText",
  "type",
]);
const safeInputWrapperPropertyNames = new Set([
  "attemptCount",
  "context",
  "elapsedMs",
  "outcome",
  "operation",
  "poisoned",
  "reason",
  "stage",
  "startedAtMs",
  "step",
]);
const safeInputWrapperPropertyPaths = new Set([
  "account.id",
  "account.provider",
  "batch.length",
  "eventId",
  "eventId.slice",
  "eventType",
  "provider.provider",
]);
const safeHelperNamePattern =
  /(?:ErrorName|ForLog|SafeLog|mask|redact|sanitize|scrub|summarize|summary)/u;
const possibleSensitiveVariablePattern = new RegExp(
  `\\b(?:${[...sensitiveVariableNames].join("|")})\\b`,
  "u",
);
const possibleLogSinkPattern = /\b(?:console|logger|log)\b|\b[A-Za-z_$][\w$]*Logger\b/u;

export interface RawHealthLogPayloadMatch {
  readonly callee: string;
  readonly column: number;
  readonly filePath: string;
  readonly line: number;
  readonly variableName: string;
}

interface SensitiveReference {
  readonly node: Identifier;
  readonly variableName: string;
}

type MemberLikeExpression = MemberExpression | OptionalMemberExpression;

export async function collectRawHealthLogPayloadMatches(): Promise<RawHealthLogPayloadMatch[]> {
  const matches: RawHealthLogPayloadMatch[] = [];

  for (const root of scanRoots) {
    await scanDirectory(root, matches);
  }

  return matches;
}

export function findRawHealthLogPayloadMatches(
  relativePath: string,
  contents: string,
): RawHealthLogPayloadMatch[] {
  if (
    !possibleSensitiveVariablePattern.test(contents) ||
    !possibleLogSinkPattern.test(contents)
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
  const matches: RawHealthLogPayloadMatch[] = [];

  traverseFast(sourceFile, (node) => {
    if (
      (isCallExpression(node) || isOptionalCallExpression(node)) &&
      isLogCallExpression(node.callee)
    ) {
      const callee = readNodeText(node.callee, contents);
      for (const argument of node.arguments) {
        for (const reference of findUnsafeSensitiveReferences(argument, contents)) {
          const position = readLineAndColumn(contents, reference.node.start);
          matches.push({
            callee,
            column: position.column,
            filePath: normalizeRepoPath(relativePath),
            line: position.line,
            variableName: reference.variableName,
          });
        }
      }
    }
  });
  return matches;
}

export async function main(): Promise<void> {
  const matches = await collectRawHealthLogPayloadMatches();

  if (matches.length === 0) {
    console.log(
      "No raw health/model/vault payload variables were found in log calls without a redaction or summarization layer.",
    );
    return;
  }

  const message = [
    "Found raw health/model/vault payload variables in log calls.",
    "Pass these values through an explicit redaction/sanitization/summarization helper, or log metadata-only counts/status instead:",
    ...matches.map(
      (match) =>
        `- ${match.filePath}:${match.line}:${match.column} logs \`${match.variableName}\` via \`${match.callee}\``,
    ),
  ];

  throw new Error(message.join("\n"));
}

async function scanDirectory(
  relativePath: string,
  matches: RawHealthLogPayloadMatch[],
): Promise<void> {
  const absolutePath = path.join(repoRoot, relativePath);
  const entries = await readdir(absolutePath, { withFileTypes: true });

  for (const entry of entries) {
    const entryRelativePath = path.posix.join(relativePath, entry.name);

    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) {
        continue;
      }

      await scanDirectory(entryRelativePath, matches);
      continue;
    }

    if (!entry.isFile() || !shouldScanSourceFile(entryRelativePath)) {
      continue;
    }

    const contents = await readFile(path.join(repoRoot, entryRelativePath), "utf8");
    matches.push(...findRawHealthLogPayloadMatches(entryRelativePath, contents));
  }
}

function findUnsafeSensitiveReferences(
  node: Node,
  sourceText: string,
): SensitiveReference[] {
  if (isSafeExpression(node, sourceText)) {
    return [];
  }

  if (isIdentifier(node) && sensitiveVariableNames.has(node.name)) {
    return [{ node, variableName: node.name }];
  }

  if (isObjectProperty(node)) {
    return findUnsafeSensitiveReferences(node.value, sourceText);
  }

  const propertyAccessReference = readUnsafePropertyAccessReference(node, sourceText);
  if (propertyAccessReference) {
    return [propertyAccessReference];
  }

  const references: SensitiveReference[] = [];
  traverseFast(node, (child) => {
    if (child !== node) {
      references.push(...findUnsafeSensitiveReferences(child, sourceText));
      return traverseFast.skip;
    }
  });
  return references;
}

function readUnsafePropertyAccessReference(
  node: Node,
  sourceText: string,
): SensitiveReference | null {
  if (!isMemberLikeExpression(node)) {
    return null;
  }

  if (!node.computed) {
    const root = readPropertyAccessRootIdentifier(node);
    if (!root || !sensitiveVariableNames.has(root.name)) {
      return null;
    }

    const propertyNames = readPropertyAccessNames(node);
    if (isMetadataOnlyPropertyAccess(root.name, propertyNames)) {
      return null;
    }

    return { node: root, variableName: root.name };
  }

  const root = readPropertyAccessRootIdentifier(node.object);
  if (!root || !sensitiveVariableNames.has(root.name)) {
    return null;
  }

  const keyName = readStaticElementAccessName(node.property, sourceText);
  if (keyName && isMetadataOnlyPropertyAccess(root.name, [keyName])) {
    return null;
  }

  return { node: root, variableName: root.name };
}

function isSafeExpression(node: Node, sourceText: string): boolean {
  if (isCallExpression(node) || isOptionalCallExpression(node)) {
    return isSafeHelperCallee(node.callee, sourceText);
  }

  if (isMemberLikeExpression(node) && !node.computed) {
    const root = readPropertyAccessRootIdentifier(node);
    return !!root && isMetadataOnlyPropertyAccess(root.name, readPropertyAccessNames(node));
  }

  return false;
}

function isSafeHelperCallee(expression: Node, sourceText: string): boolean {
  return safeHelperNamePattern.test(readNodeText(expression, sourceText));
}

function isLogCallExpression(expression: Node): boolean {
  if (isIdentifier(expression)) {
    return expression.name === "log";
  }

  if (!isMemberLikeExpression(expression)) {
    return false;
  }

  const methodName = readMemberPropertyName(expression);
  if (!methodName || !logMethodNames.has(methodName)) {
    return false;
  }

  const root = readPropertyAccessRootIdentifier(expression.object);
  if (!root) {
    return isLoggerPropertyAccessReceiver(expression.object);
  }

  return root.name === "console" || root.name === "logger" || isLoggerLikeName(root.name);
}

function isLoggerPropertyAccessReceiver(expression: Node): boolean {
  if (!isMemberLikeExpression(expression)) {
    return false;
  }

  const propertyName = readMemberPropertyName(expression);
  return propertyName ? isLoggerLikeName(propertyName) : false;
}

function isLoggerLikeName(name: string): boolean {
  return name === "logger" || /Logger$/u.test(name);
}

function readPropertyAccessRootIdentifier(node: Node): Identifier | null {
  if (isIdentifier(node)) {
    return node;
  }

  if (node.type === "ThisExpression") {
    return null;
  }

  if (isMemberLikeExpression(node)) {
    const root = readPropertyAccessRootIdentifier(node.object);
    return root ?? (isIdentifier(node.property) && node.property.name === "logger" ? node.property : null);
  }

  return null;
}

function readPropertyAccessNames(node: MemberLikeExpression): string[] {
  const propertyName = readMemberPropertyName(node);
  const names: string[] = propertyName ? [propertyName] : [];
  let current: Node = node.object;

  while (isMemberLikeExpression(current) && !current.computed) {
    const currentPropertyName = readMemberPropertyName(current);
    if (currentPropertyName) {
      names.unshift(currentPropertyName);
    }
    current = current.object;
  }

  return names;
}

function readStaticElementAccessName(
  node: Node,
  sourceText: string,
): string | null {
  if (isStringLiteral(node)) {
    return node.value;
  }

  if (isTemplateLiteral(node) && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw ?? null;
  }

  const text = readNodeText(node, sourceText);
  return /^[A-Za-z_$][\w$]*$/u.test(text) ? text : null;
}

function isMemberLikeExpression(node: Node): node is MemberLikeExpression {
  return isMemberExpression(node) || isOptionalMemberExpression(node);
}

function readMemberPropertyName(node: MemberLikeExpression): string | null {
  if (isIdentifier(node.property)) {
    return node.property.name;
  }

  return isStringLiteral(node.property) ? node.property.value : null;
}

function readNodeText(node: Node, sourceText: string): string {
  return sourceText.slice(node.start ?? 0, node.end ?? 0);
}

function readLineAndColumn(
  sourceText: string,
  position: number | null | undefined,
): { readonly column: number; readonly line: number } {
  const prefix = sourceText.slice(0, position ?? 0);
  const lineStart = prefix.lastIndexOf("\n") + 1;
  return {
    column: prefix.length - lineStart + 1,
    line: prefix.split("\n").length,
  };
}

function isMetadataOnlyPropertyAccess(rootName: string, propertyNames: readonly string[]): boolean {
  if (propertyNames.length === 0) {
    return false;
  }

  if (rootName === "input") {
    const propertyPath = propertyNames.join(".");
    return (
      safeInputWrapperPropertyPaths.has(propertyPath) ||
      propertyNames.every(
        (name) => metadataPropertyNames.has(name) || safeInputWrapperPropertyNames.has(name),
      )
    );
  }

  return propertyNames.every((name) => metadataPropertyNames.has(name));
}

function shouldScanSourceFile(relativePath: string): boolean {
  if (relativePath.endsWith(".d.ts")) {
    return false;
  }

  return sourceExtensions.has(path.posix.extname(relativePath));
}

function shouldSkipDirectory(name: string): boolean {
  return skippedDirectoryNames.has(name) || name.startsWith(".next");
}

function parserPlugins(relativePath: string): ParserPlugin[] {
  const plugins: ParserPlugin[] = [["decorators", { decoratorsBeforeExport: true }]];
  if (/\.[cm]?tsx?$/u.test(relativePath)) {
    plugins.push("typescript");
  }
  if (/\.[jt]sx$/u.test(relativePath)) {
    plugins.push("jsx");
  }
  return plugins;
}

function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
