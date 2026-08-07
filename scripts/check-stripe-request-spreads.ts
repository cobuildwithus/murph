import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse, type ParserPlugin } from "@babel/parser";
import {
  isCallExpression,
  isFunction,
  isIdentifier,
  isMemberExpression,
  isObjectExpression,
  isObjectProperty,
  isOptionalCallExpression,
  isOptionalMemberExpression,
  isSpreadElement,
  isReturnStatement,
  isVariableDeclarator,
  traverseFast,
  type CallExpression,
  type Expression,
  type Node,
  type OptionalCallExpression,
} from "@babel/types";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanRoots = ["apps/web/src", "apps/web/scripts"] as const;
const sourceExtensions = new Set([".cts", ".mts", ".ts", ".tsx"]);
const skippedDirectoryNames = new Set([
  ".next",
  ".next-dev",
  ".next-smoke",
  "coverage",
  "dist",
  "generated",
  "node_modules",
]);
const stripeTopLevelResources = new Set([
  "balanceTransactions",
  "billingPortal",
  "charges",
  "checkout",
  "customers",
  "disputes",
  "events",
  "invoiceItems",
  "invoicePayments",
  "invoices",
  "paymentIntents",
  "paymentMethods",
  "prices",
  "products",
  "refunds",
  "subscriptionItems",
  "subscriptionSchedules",
  "subscriptions",
  "webhooks",
  "webhookEndpoints",
]);

interface VariableBinding {
  readonly initializer: Expression;
  readonly start: number;
}

export interface StripeRequestSpreadMatch {
  readonly callee: string;
  readonly column: number;
  readonly filePath: string;
  readonly line: number;
}

export async function collectStripeRequestSpreadMatches(): Promise<StripeRequestSpreadMatch[]> {
  const matches: StripeRequestSpreadMatch[] = [];
  for (const root of scanRoots) {
    await scanDirectory(root, matches);
  }
  return matches;
}

export function findStripeRequestSpreadMatches(
  relativePath: string,
  contents: string,
): StripeRequestSpreadMatch[] {
  if (!/stripe/iu.test(contents) || !contents.includes("...")) {
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
  const bindings = collectVariableBindings(sourceFile);
  const stripeClientNames = collectStripeClientNames(sourceFile, contents);
  const matchesByPosition = new Map<number, StripeRequestSpreadMatch>();

  traverseFast(sourceFile, (node) => {
    if (!isStripeSdkCall(node, stripeClientNames)) {
      return;
    }

    const callee = readNodeText(node.callee, contents);
    for (const argument of node.arguments) {
      if (argument.type === "ArgumentPlaceholder") {
        continue;
      }
      collectRequestObjectSpreads({
        bindings,
        callee,
        contents,
        matchesByPosition,
        node: argument,
        resolvingBindings: new Set(),
      });
    }
  });

  traverseFast(sourceFile, (node) => {
    if (!isFunction(node) || !node.returnType) {
      return;
    }
    const returnType = readNodeText(node.returnType, contents);
    if (!/\bStripe\b[\s\S]*(?:Params?|RequestOptions)\b/u.test(returnType)) {
      return;
    }
    const callee = `Stripe-typed parameter builder ${readFunctionName(node)}`;
    if (node.body.type !== "BlockStatement") {
      collectRequestObjectSpreads({
        bindings,
        callee,
        contents,
        matchesByPosition,
        node: node.body,
        resolvingBindings: new Set(),
      });
      return;
    }
    traverseFast(node.body, (child) => {
      if (isFunction(child)) {
        return traverseFast.skip;
      }
      if (isReturnStatement(child) && child.argument) {
        collectRequestObjectSpreads({
          bindings,
          callee,
          contents,
          matchesByPosition,
          node: child.argument,
          resolvingBindings: new Set(),
        });
      }
    });
  });

  return [...matchesByPosition.values()].sort((left, right) =>
    left.line - right.line || left.column - right.column
  );
}

export async function main(): Promise<void> {
  const matches = await collectStripeRequestSpreadMatches();
  if (matches.length === 0) {
    console.log("No object spreads were found in Stripe SDK request arguments.");
    return;
  }

  throw new Error([
    "Found object spreads in Stripe SDK request arguments.",
    "Build an SDK-typed parameter object and assign optional fields explicitly so TypeScript checks every Stripe key:",
    ...matches.map(
      (match) =>
        `- ${match.filePath}:${match.line}:${match.column} spreads an object passed to \`${match.callee}\``,
    ),
  ].join("\n"));
}

function collectVariableBindings(sourceFile: Node): Map<string, VariableBinding[]> {
  const bindings = new Map<string, VariableBinding[]>();
  traverseFast(sourceFile, (node) => {
    if (!isVariableDeclarator(node) || !isIdentifier(node.id) || !node.init) {
      return;
    }
    const current = bindings.get(node.id.name) ?? [];
    current.push({ initializer: node.init, start: node.start ?? 0 });
    bindings.set(node.id.name, current);
  });
  return bindings;
}

function collectStripeClientNames(sourceFile: Node, contents: string): ReadonlySet<string> {
  const names = new Set(["stripe"]);
  traverseFast(sourceFile, (node) => {
    if (!isVariableDeclarator(node) || !isIdentifier(node.id)) {
      return;
    }
    const declaredType = node.id.typeAnnotation
      ? readNodeText(node.id.typeAnnotation, contents)
      : "";
    const initializer = node.init ? readNodeText(node.init, contents) : "";
    if (
      /\bStripe\b/u.test(declaredType) ||
      /(?:\bstripe\b|StripeApi\b)/u.test(initializer)
    ) {
      names.add(node.id.name);
    }
  });
  return names;
}

function collectRequestObjectSpreads(input: {
  readonly bindings: ReadonlyMap<string, readonly VariableBinding[]>;
  readonly callee: string;
  readonly contents: string;
  readonly matchesByPosition: Map<number, StripeRequestSpreadMatch>;
  readonly node: Node;
  readonly resolvingBindings: ReadonlySet<string>;
}): void {
  const { node } = input;

  if (isIdentifier(node)) {
    const binding = resolveBinding(input.bindings, node.name, node.start ?? Number.MAX_SAFE_INTEGER);
    if (!binding || input.resolvingBindings.has(node.name)) {
      return;
    }
    const resolvingBindings = new Set(input.resolvingBindings);
    resolvingBindings.add(node.name);
    collectRequestObjectSpreads({ ...input, node: binding.initializer, resolvingBindings });
    return;
  }

  if (isObjectExpression(node)) {
    for (const property of node.properties) {
      if (isSpreadElement(property)) {
        recordMatch(input, property);
        collectRequestObjectSpreads({ ...input, node: property.argument });
        continue;
      }
      if (isObjectProperty(property)) {
        collectRequestObjectSpreads({ ...input, node: property.value });
      }
    }
    return;
  }

  switch (node.type) {
    case "ArrayExpression":
      for (const element of node.elements) {
        if (element) {
          collectRequestObjectSpreads({
            ...input,
            node: isSpreadElement(element) ? element.argument : element,
          });
        }
      }
      return;
    case "AssignmentExpression":
      collectRequestObjectSpreads({ ...input, node: node.right });
      return;
    case "ConditionalExpression":
      collectRequestObjectSpreads({ ...input, node: node.consequent });
      collectRequestObjectSpreads({ ...input, node: node.alternate });
      return;
    case "LogicalExpression":
      collectRequestObjectSpreads({ ...input, node: node.left });
      collectRequestObjectSpreads({ ...input, node: node.right });
      return;
    case "SequenceExpression":
      for (const expression of node.expressions) {
        collectRequestObjectSpreads({ ...input, node: expression });
      }
      return;
    case "TSAsExpression":
    case "TSInstantiationExpression":
    case "TSNonNullExpression":
    case "TSSatisfiesExpression":
    case "TypeCastExpression":
      collectRequestObjectSpreads({ ...input, node: node.expression });
      return;
    default:
      return;
  }
}

function recordMatch(
  input: {
    readonly callee: string;
    readonly contents: string;
    readonly matchesByPosition: Map<number, StripeRequestSpreadMatch>;
  },
  spread: Node,
): void {
  const start = spread.start ?? 0;
  if (input.matchesByPosition.has(start)) {
    return;
  }
  const position = readLineAndColumn(input.contents, start);
  input.matchesByPosition.set(start, {
    callee: input.callee,
    column: position.column,
    filePath: normalizeRepoPath(readSourceFilename(spread)),
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
    if (candidate.start <= before && (!resolved || candidate.start > resolved.start)) {
      resolved = candidate;
    }
  }
  return resolved;
}

function isStripeSdkCall(
  node: Node,
  stripeClientNames: ReadonlySet<string>,
): node is CallExpression | OptionalCallExpression {
  if (!isCallExpression(node) && !isOptionalCallExpression(node)) {
    return false;
  }
  const pathParts = readMemberPath(node.callee);
  if (!pathParts || pathParts.length < 3) {
    return false;
  }
  const stripeIndex = pathParts.findIndex(
    (part) => /stripe/iu.test(part) || stripeClientNames.has(part),
  );
  return stripeIndex >= 0 && stripeTopLevelResources.has(pathParts[stripeIndex + 1] ?? "");
}

function readMemberPath(node: Node): string[] | null {
  if (isIdentifier(node)) {
    return [node.name];
  }
  if (isMemberExpression(node) || isOptionalMemberExpression(node)) {
    if (node.computed || !isIdentifier(node.property)) {
      return null;
    }
    const objectPath = readMemberPath(node.object);
    return objectPath ? [...objectPath, node.property.name] : null;
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
  matches: StripeRequestSpreadMatch[],
): Promise<void> {
  const entries = await readdir(path.join(repoRoot, relativePath), { withFileTypes: true });
  for (const entry of entries) {
    const entryRelativePath = path.posix.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipDirectory(entry.name)) {
        await scanDirectory(entryRelativePath, matches);
      }
      continue;
    }
    if (!entry.isFile() || !shouldScanSourceFile(entryRelativePath)) {
      continue;
    }
    const contents = await readFile(path.join(repoRoot, entryRelativePath), "utf8");
    matches.push(...findStripeRequestSpreadMatches(entryRelativePath, contents));
  }
}

function parserPlugins(relativePath: string): ParserPlugin[] {
  const plugins: ParserPlugin[] = [["decorators", { decoratorsBeforeExport: true }], "typescript"];
  if (/\.tsx$/u.test(relativePath)) {
    plugins.push("jsx");
  }
  return plugins;
}

function shouldScanSourceFile(relativePath: string): boolean {
  return !relativePath.endsWith(".d.ts") && sourceExtensions.has(path.posix.extname(relativePath));
}

function shouldSkipDirectory(name: string): boolean {
  return skippedDirectoryNames.has(name) || name.startsWith(".next");
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

function readSourceFilename(node: Node): string {
  return node.loc?.filename ?? "<unknown>";
}

function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/gu, "/");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
