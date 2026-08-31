import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { parse, type ParserPlugin } from "@babel/parser";
import traverseImport, { type NodePath } from "@babel/traverse";
import * as t from "@babel/types";

type Traverse = typeof import("@babel/traverse").default;
const traverseModule = traverseImport as unknown as Traverse | { default: Traverse };
const traverse: Traverse = (
  typeof traverseImport === "function"
    ? traverseModule as Traverse
    : (traverseModule as { default: Traverse }).default
);

const repoRoot = resolveRepositoryRoot();

export const DEFAULT_CYCLOMATIC_COMPLEXITY_THRESHOLD = 20;

const sourceExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const excludedDirectoryNames = new Set([
  ".next",
  ".next-dev",
  ".next-smoke",
  ".test-dist",
  ".wrangler",
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
const excludedFilePattern = /(?:^|\.)(?:gen|generated|spec|test)\.[cm]?[jt]sx?$/u;

export interface FunctionComplexity {
  readonly column: number;
  readonly complexity: number;
  readonly line: number;
  readonly name: string;
}

export interface SourceComplexitySummary {
  readonly complexityDebt: number;
  readonly functions: readonly FunctionComplexity[];
  readonly maximumComplexity: number;
  readonly totalComplexity: number;
}

export interface FileComplexityComparison {
  readonly basePath: string | null;
  readonly baseSummary: SourceComplexitySummary;
  readonly complexityDebtDelta: number;
  readonly displayPath: string;
  readonly headPath: string | null;
  readonly headSummary: SourceComplexitySummary;
  readonly maximumComplexityDelta: number;
  readonly status: string;
  readonly violations: readonly string[];
}

export interface ComplexityDiffReport {
  readonly baseRef: string;
  readonly files: readonly FileComplexityComparison[];
  readonly headRef: string | null;
  readonly passed: boolean;
  readonly threshold: number;
}

interface ComplexityFrame {
  complexity: number;
  readonly column: number;
  readonly line: number;
  readonly name: string;
}

interface ChangedSourcePath {
  readonly basePath: string | null;
  readonly headPath: string | null;
  readonly status: string;
}

interface CliOptions {
  readonly baseRef: string;
  readonly headRef: string | null;
  readonly json: boolean;
  readonly pathspecs: readonly string[];
  readonly threshold: number;
}

const emptySummary: SourceComplexitySummary = Object.freeze({
  complexityDebt: 0,
  functions: Object.freeze([]),
  maximumComplexity: 0,
  totalComplexity: 0,
});

export function analyzeCyclomaticComplexity(
  relativePath: string,
  sourceText: string,
  threshold = DEFAULT_CYCLOMATIC_COMPLEXITY_THRESHOLD,
): SourceComplexitySummary {
  assertThreshold(threshold);
  const syntaxTree = parse(sourceText, {
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    allowUndeclaredExports: true,
    plugins: parserPlugins(relativePath),
    sourceFilename: relativePath,
    sourceType: "unambiguous",
  });
  const frames: ComplexityFrame[] = [];
  const functions: FunctionComplexity[] = [];

  const startFrame = (name: string, node: t.Node) => {
    frames.push({
      column: (node.loc?.start.column ?? 0) + 1,
      complexity: 1,
      line: node.loc?.start.line ?? 1,
      name,
    });
  };
  const finishFrame = () => {
    const frame = frames.pop();
    if (!frame) {
      throw new Error("Cyclomatic complexity traversal lost its active frame.");
    }
    functions.push(frame);
  };
  const increaseComplexity = () => {
    const frame = frames.at(-1);
    if (frame) {
      frame.complexity += 1;
    }
  };

  traverse(syntaxTree, {
    Function: {
      enter(functionPath) {
        startFrame(readFunctionName(functionPath), functionPath.node);
      },
      exit() {
        finishFrame();
      },
    },
    ClassProperty: {
      enter(propertyPath) {
        if (propertyPath.node.value) {
          startFrame(
            `class field initializer ${readPropertyName(propertyPath.node.key)}`,
            propertyPath.node,
          );
        }
      },
      exit(propertyPath) {
        if (propertyPath.node.value) {
          finishFrame();
        }
      },
    },
    ClassPrivateProperty: {
      enter(propertyPath) {
        if (propertyPath.node.value) {
          startFrame(
            `class field initializer ${readPropertyName(propertyPath.node.key)}`,
            propertyPath.node,
          );
        }
      },
      exit(propertyPath) {
        if (propertyPath.node.value) {
          finishFrame();
        }
      },
    },
    StaticBlock: {
      enter(blockPath) {
        startFrame("class static block", blockPath.node);
      },
      exit() {
        finishFrame();
      },
    },
    AssignmentPattern: increaseComplexity,
    CatchClause: increaseComplexity,
    ConditionalExpression: increaseComplexity,
    DoWhileStatement: increaseComplexity,
    ForInStatement: increaseComplexity,
    ForOfStatement: increaseComplexity,
    ForStatement: increaseComplexity,
    IfStatement: increaseComplexity,
    LogicalExpression: increaseComplexity,
    SwitchCase(casePath) {
      if (casePath.node.test) {
        increaseComplexity();
      }
    },
    WhileStatement: increaseComplexity,
    AssignmentExpression(assignmentPath) {
      if (["&&=", "||=", "??="].includes(assignmentPath.node.operator)) {
        increaseComplexity();
      }
    },
    MemberExpression(memberPath) {
      if (memberPath.node.optional === true) {
        increaseComplexity();
      }
    },
    OptionalMemberExpression(memberPath) {
      if (memberPath.node.optional === true) {
        increaseComplexity();
      }
    },
    CallExpression(callPath) {
      if (callPath.node.optional === true) {
        increaseComplexity();
      }
    },
    OptionalCallExpression(callPath) {
      if (callPath.node.optional === true) {
        increaseComplexity();
      }
    },
  });

  if (frames.length > 0) {
    throw new Error("Cyclomatic complexity traversal ended with unfinished frames.");
  }

  functions.sort((left, right) =>
    left.line - right.line ||
    left.column - right.column ||
    left.name.localeCompare(right.name)
  );
  return summarizeFunctionComplexities(functions, threshold);
}

export function compareFileComplexity(
  changedPath: ChangedSourcePath,
  baseSummary: SourceComplexitySummary,
  headSummary: SourceComplexitySummary,
  threshold = DEFAULT_CYCLOMATIC_COMPLEXITY_THRESHOLD,
): FileComplexityComparison {
  assertThreshold(threshold);
  const complexityDebtDelta =
    headSummary.complexityDebt - baseSummary.complexityDebt;
  const maximumComplexityDelta =
    headSummary.maximumComplexity - baseSummary.maximumComplexity;
  const violations: string[] = [];

  if (complexityDebtDelta > 0) {
    violations.push(
      `complexity debt above ${threshold} increased by ${complexityDebtDelta}`,
    );
  }
  if (
    maximumComplexityDelta > 0 &&
    headSummary.maximumComplexity > threshold
  ) {
    violations.push(
      `maximum function complexity increased by ${maximumComplexityDelta}`,
    );
  }

  return {
    ...changedPath,
    baseSummary,
    complexityDebtDelta,
    displayPath: changedPath.headPath ?? changedPath.basePath ?? "<unknown>",
    headSummary,
    maximumComplexityDelta,
    violations,
  };
}

export function evaluateComplexityDiff({
  baseRef,
  headRef,
  pathspecs = [],
  threshold = DEFAULT_CYCLOMATIC_COMPLEXITY_THRESHOLD,
}: {
  readonly baseRef: string;
  readonly headRef: string | null;
  readonly pathspecs?: readonly string[];
  readonly threshold?: number;
}): ComplexityDiffReport {
  assertThreshold(threshold);
  assertGitCommit(baseRef, "base");
  if (headRef) {
    assertGitCommit(headRef, "head");
  }

  const comparisonBaseRef = headRef
    ? resolveMergeBase(baseRef, headRef)
    : baseRef;
  const changedPaths = readChangedSourcePaths(
    comparisonBaseRef,
    headRef,
    pathspecs,
  );
  const files = changedPaths.map((changedPath) => {
    const baseSource = changedPath.basePath
      ? readSourceAtRevision(comparisonBaseRef, changedPath.basePath)
      : null;
    const headSource = changedPath.headPath
      ? readHeadSource(headRef, changedPath.headPath)
      : null;
    const baseSummary = baseSource === null
      ? emptySummary
      : analyzeCyclomaticComplexity(
        changedPath.basePath!,
        baseSource,
        threshold,
      );
    const headSummary = headSource === null
      ? emptySummary
      : analyzeCyclomaticComplexity(
        changedPath.headPath!,
        headSource,
        threshold,
      );
    return compareFileComplexity(
      changedPath,
      baseSummary,
      headSummary,
      threshold,
    );
  });

  return {
    baseRef: comparisonBaseRef,
    files,
    headRef,
    passed: files.every((file) => file.violations.length === 0),
    threshold,
  };
}

export function formatComplexityDiffReport(report: ComplexityDiffReport): string {
  const lines = [
    `Cyclomatic complexity diff (ESLint classic semantics, threshold ${report.threshold})`,
    `Base: ${shortRef(report.baseRef)}  Head: ${report.headRef ? shortRef(report.headRef) : "working tree"}`,
  ];

  if (report.files.length === 0) {
    lines.push("No authored JavaScript or TypeScript source changes to analyze.");
    lines.push("Cyclomatic complexity guard passed.");
    return lines.join("\n");
  }

  for (const file of report.files) {
    lines.push(
      `${file.violations.length === 0 ? "PASS" : "FAIL"} ${file.displayPath}: ` +
      `debt ${file.baseSummary.complexityDebt} -> ${file.headSummary.complexityDebt} ` +
      `(${formatDelta(file.complexityDebtDelta)}), max ` +
      `${file.baseSummary.maximumComplexity} -> ${file.headSummary.maximumComplexity} ` +
      `(${formatDelta(file.maximumComplexityDelta)})`,
    );
    const hotspots = file.headSummary.functions
      .filter((entry) => entry.complexity > report.threshold)
      .sort((left, right) =>
        right.complexity - left.complexity ||
        left.line - right.line
      );
    for (const hotspot of hotspots) {
      lines.push(
        `  hotspot ${hotspot.name} at ${hotspot.line}:${hotspot.column} = ${hotspot.complexity}`,
      );
    }
    for (const violation of file.violations) {
      lines.push(`  violation: ${violation}`);
    }
  }

  const currentHotspotCount = report.files.reduce(
    (count, file) =>
      count + file.headSummary.functions.filter(
        (entry) => entry.complexity > report.threshold,
      ).length,
    0,
  );
  lines.push(
    `Summary: ${report.files.length} changed source file(s), ${currentHotspotCount} current hotspot(s) above ${report.threshold}.`,
  );
  lines.push(
    report.passed
      ? "Cyclomatic complexity guard passed. Review listed hotspots and simplify them when a smaller behavior-preserving shape is justified."
      : "Cyclomatic complexity guard failed. Reduce the regression before continuing.",
  );
  return lines.join("\n");
}

export function isCyclomaticSourcePath(filePath: string): boolean {
  const normalizedPath = normalizeRepoPath(filePath);
  const segments = normalizedPath.split("/");
  const fileName = segments.at(-1) ?? "";
  if (
    segments.some((segment) =>
      excludedDirectoryNames.has(segment) || segment.startsWith(".next")
    )
  ) {
    return false;
  }
  if (
    /\.d\.[cm]?ts$/u.test(fileName) ||
    excludedFilePattern.test(fileName)
  ) {
    return false;
  }
  return sourceExtensions.has(path.posix.extname(normalizedPath));
}

export function parseNameStatus(output: string): ChangedSourcePath[] {
  const tokens = output.split("\0");
  const changedPaths: ChangedSourcePath[] = [];
  let index = 0;
  while (index < tokens.length) {
    const status = tokens[index++];
    if (!status) {
      continue;
    }
    const statusCode = status[0];
    if (statusCode === "R" || statusCode === "C") {
      const basePath = tokens[index++];
      const headPath = tokens[index++];
      if (!basePath || !headPath) {
        throw new Error("Git returned an incomplete rename/copy record.");
      }
      changedPaths.push({ basePath, headPath, status });
      continue;
    }
    const changedPath = tokens[index++];
    if (!changedPath) {
      throw new Error("Git returned an incomplete changed-path record.");
    }
    changedPaths.push({
      basePath: statusCode === "A" ? null : changedPath,
      headPath: statusCode === "D" ? null : changedPath,
      status,
    });
  }
  return changedPaths;
}

function summarizeFunctionComplexities(
  functions: readonly FunctionComplexity[],
  threshold: number,
): SourceComplexitySummary {
  return {
    complexityDebt: functions.reduce(
      (debt, entry) => debt + Math.max(0, entry.complexity - threshold),
      0,
    ),
    functions,
    maximumComplexity: functions.reduce(
      (maximum, entry) => Math.max(maximum, entry.complexity),
      0,
    ),
    totalComplexity: functions.reduce(
      (total, entry) => total + entry.complexity,
      0,
    ),
  };
}

function readChangedSourcePaths(
  baseRef: string,
  headRef: string | null,
  pathspecs: readonly string[],
): ChangedSourcePath[] {
  const diffArgs = [
    "diff",
    "--find-renames",
    "--name-status",
    "-z",
    baseRef,
  ];
  if (headRef) {
    diffArgs.push(headRef);
  }
  diffArgs.push("--", ...pathspecs);
  const changedPaths = parseNameStatus(execGit(diffArgs));

  if (!headRef) {
    const untrackedArgs = ["ls-files", "--others", "--exclude-standard", "-z"];
    if (pathspecs.length > 0) {
      untrackedArgs.push("--", ...pathspecs);
    }
    for (const untrackedPath of execGit(untrackedArgs).split("\0")) {
      if (untrackedPath) {
        changedPaths.push({ basePath: null, headPath: untrackedPath, status: "A" });
      }
    }
  }

  const normalized = new Map<string, ChangedSourcePath>();
  for (const changedPath of changedPaths) {
    const basePath = changedPath.basePath && isCyclomaticSourcePath(changedPath.basePath)
      ? normalizeRepoPath(changedPath.basePath)
      : null;
    const headPath = changedPath.headPath && isCyclomaticSourcePath(changedPath.headPath)
      ? normalizeRepoPath(changedPath.headPath)
      : null;
    if (!basePath && !headPath) {
      continue;
    }
    const normalizedPath = { ...changedPath, basePath, headPath };
    normalized.set(`${basePath ?? ""}\0${headPath ?? ""}`, normalizedPath);
  }
  return [...normalized.values()].sort((left, right) =>
    (left.headPath ?? left.basePath ?? "").localeCompare(
      right.headPath ?? right.basePath ?? "",
    )
  );
}

function readHeadSource(headRef: string | null, relativePath: string): string {
  if (headRef) {
    return readSourceAtRevision(headRef, relativePath);
  }
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Changed source file disappeared during analysis: ${relativePath}`);
  }
  return readFileSync(absolutePath, "utf8");
}

function readSourceAtRevision(revision: string, relativePath: string): string {
  return execGit(["show", `${revision}:${relativePath}`]);
}

function readFunctionName(functionPath: NodePath<t.Function>): string {
  const node = functionPath.node;
  if ((t.isFunctionDeclaration(node) || t.isFunctionExpression(node)) && node.id) {
    return node.id.name;
  }
  if (t.isObjectMethod(node) || t.isClassMethod(node) || t.isClassPrivateMethod(node)) {
    return readPropertyName(node.key);
  }

  const parent = functionPath.parentPath?.node;
  if (t.isVariableDeclarator(parent) && parent.init === node) {
    return readBindingName(parent.id);
  }
  if (t.isObjectProperty(parent) && parent.value === node) {
    return readPropertyName(parent.key);
  }
  if ((t.isClassProperty(parent) || t.isClassPrivateProperty(parent)) && parent.value === node) {
    return readPropertyName(parent.key);
  }
  if (t.isAssignmentExpression(parent) && parent.right === node) {
    return readExpressionName(parent.left);
  }
  return "<anonymous>";
}

function readBindingName(binding: t.LVal | t.VoidPattern): string {
  if (t.isIdentifier(binding)) {
    return binding.name;
  }
  return "<destructured>";
}

function readExpressionName(expression: t.Expression | t.LVal): string {
  if (t.isIdentifier(expression)) {
    return expression.name;
  }
  if (t.isMemberExpression(expression) || t.isOptionalMemberExpression(expression)) {
    return readPropertyName(expression.property);
  }
  return "<anonymous>";
}

function readPropertyName(property: t.Node): string {
  if (t.isIdentifier(property)) {
    return property.name;
  }
  if (t.isPrivateName(property)) {
    return `#${property.id.name}`;
  }
  if (t.isStringLiteral(property) || t.isNumericLiteral(property)) {
    return String(property.value);
  }
  return "<computed>";
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

function parseCliOptions(argv: readonly string[]): CliOptions {
  let baseRef = process.env.MURPH_COMPLEXITY_BASE_SHA?.trim() ?? "";
  let headRef = process.env.MURPH_COMPLEXITY_HEAD_SHA?.trim() || null;
  let json = false;
  let threshold = DEFAULT_CYCLOMATIC_COMPLEXITY_THRESHOLD;
  const pathspecs: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--") {
      pathspecs.push(...argv.slice(index + 1));
      break;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--base" || argument === "--head" || argument === "--threshold") {
      const value = argv[++index];
      if (!value) {
        throw new Error(`${argument} requires a value.`);
      }
      if (argument === "--base") {
        baseRef = value;
      } else if (argument === "--head") {
        headRef = value;
      } else {
        threshold = Number.parseInt(value, 10);
      }
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!baseRef) {
    baseRef = resolveDefaultBaseRef();
  }
  assertThreshold(threshold);
  return { baseRef, headRef, json, pathspecs, threshold };
}

function resolveDefaultBaseRef(): string {
  for (const candidate of ["refs/remotes/origin/main", "main"]) {
    try {
      return resolveMergeBase("HEAD", candidate);
    } catch {
      // Try the next local base candidate.
    }
  }
  throw new Error(
    "Unable to resolve a local main merge base; pass --base <ref> explicitly.",
  );
}

function resolveMergeBase(leftRef: string, rightRef: string): string {
  const mergeBase = execGit(["merge-base", leftRef, rightRef]).trim();
  if (!mergeBase) {
    throw new Error(
      `Unable to resolve a merge base between ${leftRef} and ${rightRef}.`,
    );
  }
  return mergeBase;
}

function assertThreshold(threshold: number): void {
  if (!Number.isSafeInteger(threshold) || threshold < 1) {
    throw new Error("Cyclomatic complexity threshold must be a positive integer.");
  }
}

function assertGitCommit(revision: string, label: string): void {
  try {
    execGit(["cat-file", "-e", `${revision}^{commit}`]);
  } catch {
    throw new Error(`Cyclomatic complexity ${label} ref is not a commit: ${revision}`);
  }
}

function execGit(args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resolveRepositoryRoot(): string {
  const resolvedRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (!resolvedRoot) {
    throw new Error("Unable to resolve the repository root.");
  }
  return resolvedRoot;
}

function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/gu, "/");
}

function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta);
}

function shortRef(revision: string): string {
  return /^[0-9a-f]{40}$/u.test(revision) ? revision.slice(0, 12) : revision;
}

function printUsage(): void {
  console.log(
    "Usage: pnpm complexity:diff [--base <ref>] [--head <ref>] [--threshold <number>] [--json] [-- <path> ...]",
  );
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const report = evaluateComplexityDiff(options);
  console.log(
    options.json
      ? JSON.stringify(report, null, 2)
      : formatComplexityDiffReport(report),
  );
  if (!report.passed) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
