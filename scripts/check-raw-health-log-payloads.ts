import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as ts from "@typescript/typescript6";

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

export interface RawHealthLogPayloadMatch {
  readonly callee: string;
  readonly column: number;
  readonly filePath: string;
  readonly line: number;
  readonly variableName: string;
}

interface SensitiveReference {
  readonly node: ts.Node;
  readonly variableName: string;
}

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
  const sourceFile = ts.createSourceFile(
    relativePath,
    contents,
    ts.ScriptTarget.Latest,
    true,
    resolveScriptKind(relativePath),
  );
  const matches: RawHealthLogPayloadMatch[] = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isLogCallExpression(node.expression)) {
      const callee = node.expression.getText(sourceFile);
      for (const argument of node.arguments) {
        for (const reference of findUnsafeSensitiveReferences(argument, sourceFile)) {
          const position = sourceFile.getLineAndCharacterOfPosition(reference.node.getStart(sourceFile));
          matches.push({
            callee,
            column: position.character + 1,
            filePath: normalizeRepoPath(relativePath),
            line: position.line + 1,
            variableName: reference.variableName,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
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
  node: ts.Node,
  sourceFile: ts.SourceFile,
): SensitiveReference[] {
  if (isSafeExpression(node, sourceFile)) {
    return [];
  }

  if (ts.isIdentifier(node) && sensitiveVariableNames.has(node.text)) {
    return [{ node, variableName: node.text }];
  }

  if (ts.isShorthandPropertyAssignment(node) && sensitiveVariableNames.has(node.name.text)) {
    return [{ node: node.name, variableName: node.name.text }];
  }

  if (ts.isPropertyAssignment(node)) {
    return findUnsafeSensitiveReferences(node.initializer, sourceFile);
  }

  const propertyAccessReference = readUnsafePropertyAccessReference(node, sourceFile);
  if (propertyAccessReference) {
    return [propertyAccessReference];
  }

  const references: SensitiveReference[] = [];
  ts.forEachChild(node, (child) => {
    references.push(...findUnsafeSensitiveReferences(child, sourceFile));
  });
  return references;
}

function readUnsafePropertyAccessReference(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): SensitiveReference | null {
  if (ts.isPropertyAccessExpression(node)) {
    const root = readPropertyAccessRootIdentifier(node);
    if (!root || !sensitiveVariableNames.has(root.text)) {
      return null;
    }

    const propertyNames = readPropertyAccessNames(node);
    if (isMetadataOnlyPropertyAccess(root.text, propertyNames)) {
      return null;
    }

    return { node: root, variableName: root.text };
  }

  if (ts.isElementAccessExpression(node)) {
    const root = readPropertyAccessRootIdentifier(node.expression);
    if (!root || !sensitiveVariableNames.has(root.text)) {
      return null;
    }

    const keyName = readStaticElementAccessName(node.argumentExpression, sourceFile);
    if (keyName && isMetadataOnlyPropertyAccess(root.text, [keyName])) {
      return null;
    }

    return { node: root, variableName: root.text };
  }

  return null;
}

function isSafeExpression(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  if (ts.isCallExpression(node)) {
    return isSafeHelperCallee(node.expression, sourceFile);
  }

  if (ts.isPropertyAccessExpression(node)) {
    const root = readPropertyAccessRootIdentifier(node);
    return !!root && isMetadataOnlyPropertyAccess(root.text, readPropertyAccessNames(node));
  }

  return false;
}

function isSafeHelperCallee(expression: ts.Expression, sourceFile: ts.SourceFile): boolean {
  return safeHelperNamePattern.test(expression.getText(sourceFile));
}

function isLogCallExpression(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) {
    return expression.text === "log";
  }

  if (!ts.isPropertyAccessExpression(expression) || !logMethodNames.has(expression.name.text)) {
    return false;
  }

  const root = readPropertyAccessRootIdentifier(expression.expression);
  if (!root) {
    return isLoggerPropertyAccessReceiver(expression.expression);
  }

  return root.text === "console" || root.text === "logger" || isLoggerLikeName(root.text);
}

function isLoggerPropertyAccessReceiver(expression: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(expression)) {
    return false;
  }

  return isLoggerLikeName(expression.name.text);
}

function isLoggerLikeName(name: string): boolean {
  return name === "logger" || /Logger$/u.test(name);
}

function readPropertyAccessRootIdentifier(node: ts.Node): ts.Identifier | null {
  if (ts.isIdentifier(node)) {
    return node;
  }

  if (node.kind === ts.SyntaxKind.ThisKeyword) {
    return null;
  }

  if (ts.isPropertyAccessExpression(node)) {
    const root = readPropertyAccessRootIdentifier(node.expression);
    return root ?? (ts.isIdentifier(node.name) && node.name.text === "logger" ? node.name : null);
  }

  if (ts.isElementAccessExpression(node)) {
    return readPropertyAccessRootIdentifier(node.expression);
  }

  return null;
}

function readPropertyAccessNames(node: ts.PropertyAccessExpression): string[] {
  const names: string[] = [node.name.text];
  let current: ts.Expression = node.expression;

  while (ts.isPropertyAccessExpression(current)) {
    names.unshift(current.name.text);
    current = current.expression;
  }

  return names;
}

function readStaticElementAccessName(
  node: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
): string | null {
  if (!node) {
    return null;
  }

  if (ts.isStringLiteralLike(node)) {
    return node.text;
  }

  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  const text = node.getText(sourceFile);
  return /^[A-Za-z_$][\w$]*$/u.test(text) ? text : null;
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

function resolveScriptKind(relativePath: string): ts.ScriptKind {
  if (relativePath.endsWith(".tsx") || relativePath.endsWith(".jsx")) {
    return ts.ScriptKind.TSX;
  }

  if (relativePath.endsWith(".js") || relativePath.endsWith(".mjs") || relativePath.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }

  return ts.ScriptKind.TS;
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
