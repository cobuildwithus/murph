import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanRoots = ["apps", "packages"] as const;
const explicitScanFiles = new Set([
  "apps/web/prisma/schema.prisma",
]);
const skippedDirectoryNames = new Set(["node_modules", "dist", "coverage", ".next", ".next-dev"]);
const textFileExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".mts",
  ".prisma",
  ".sql",
  ".ts",
  ".tsx",
]);
const blockedPathFragments = [
  "apps/web/app/api/internal/hosted-run/",
  "apps/web/src/lib/hosted-run/",
  "packages/hosted-execution/src/parsers/run-control.ts",
] as const;
const blockedContentPatterns = [
  { label: "HostedIngressEvent", pattern: /\bHostedIngressEvent\b/u },
  { label: "HostedIngressPayload", pattern: /\bHostedIngressPayload\b/u },
  { label: "HostedRun", pattern: /\bHostedRun(?!ner)\b/u },
  { label: "HostedRunLog", pattern: /\bHostedRunLog\b/u },
  { label: "HostedExecutionCursor", pattern: /\bHostedExecutionCursor\b/u },
  { label: "committedSeq", pattern: /\bcommittedSeq\b/u },
  { label: "finalizeRequired", pattern: /\bfinalizeRequired\b/u },
  { label: "hosted_ingress_event", pattern: /\bhosted_ingress_event\b/u },
  { label: "hosted_ingress_payload", pattern: /\bhosted_ingress_payload\b/u },
  { label: "hosted_run_log", pattern: /\bhosted_run_log\b/u },
  { label: "runDrain", pattern: /\brunDrain\b/u },
  { label: "runToken", pattern: /\brunToken\b/u },
  { label: "targetCommittedSeqHint", pattern: /\btargetCommittedSeqHint\b/u },
  { label: "turn-input/adopt", pattern: /turn-input\/adopt/u },
  { label: "turn-input/peek", pattern: /turn-input\/peek/u },
] as const;
const legacyRejectionTableFiles = new Set([
  "packages/assistant-runtime/src/hosted-runtime/parsers.ts",
  "packages/hosted-execution/src/parsers/runtime-control.ts",
]);
export type HostedRunStaleResidueMatch =
  | {
      kind: "path";
      filePath: string;
      matched: string;
    }
  | {
      kind: "content";
      filePath: string;
      matched: string;
      line: number;
    };

export function shouldScanHostedRunProductionFile(relativePath: string): boolean {
  const normalizedPath = normalizeRepoPath(relativePath);
  const extension = path.posix.extname(normalizedPath);

  if (explicitScanFiles.has(normalizedPath)) {
    return true;
  }

  if (!textFileExtensions.has(extension) || isTestLikePath(normalizedPath)) {
    return false;
  }

  if (normalizedPath.startsWith("apps/web/app/")) {
    return true;
  }

  if (normalizedPath.startsWith("apps/") || normalizedPath.startsWith("packages/")) {
    return normalizedPath.includes("/src/");
  }

  return false;
}

export function findHostedRunStaleResidueMatches(
  relativePath: string,
  contents: string,
): HostedRunStaleResidueMatch[] {
  const normalizedPath = normalizeRepoPath(relativePath);
  const matches: HostedRunStaleResidueMatch[] = [];

  for (const blockedPathFragment of blockedPathFragments) {
    if (normalizedPath.includes(blockedPathFragment)) {
      matches.push({
        kind: "path",
        filePath: normalizedPath,
        matched: blockedPathFragment,
      });
    }
  }

  for (const blockedContentPattern of blockedContentPatterns) {
    if (shouldAllowHostedHardCutResidueMatch({
      label: blockedContentPattern.label,
      relativePath: normalizedPath,
    })) {
      continue;
    }
    const line = findFirstPatternMatchLine(contents, blockedContentPattern.pattern);

    if (line !== null) {
      matches.push({
        kind: "content",
        filePath: normalizedPath,
        matched: blockedContentPattern.label,
        line,
      });
    }
  }

  return matches;
}

export async function collectHostedRunStaleResidueMatches(): Promise<HostedRunStaleResidueMatch[]> {
  const matches: HostedRunStaleResidueMatch[] = [];

  for (const root of scanRoots) {
    await scanDirectory(root, matches);
  }

  return matches;
}

export async function main(): Promise<void> {
  const matches = await collectHostedRunStaleResidueMatches();

  if (matches.length === 0) {
    console.log(
      "No blocked hosted runtime hard-cut residue was found in apps/packages source files or active schema.",
    );
    return;
  }

  const lines = [
    "Found blocked hosted runtime hard-cut residue. Keep the live hosted framing mailbox/workspace/invocation-centric; legacy run/cursor/adoption protocol residue is allowed only in tests/history or explicit parser rejection tables, not production apps/packages source files.",
  ];

  for (const match of matches) {
    if (match.kind === "path") {
      lines.push(`- ${match.filePath}: blocked path fragment \`${match.matched}\``);
      continue;
    }

    lines.push(`- ${match.filePath}:${match.line}: blocked token \`${match.matched}\``);
  }

  throw new Error(lines.join("\n"));
}

async function scanDirectory(
  relativeDirPath: string,
  matches: HostedRunStaleResidueMatch[],
): Promise<void> {
  const absoluteDirPath = path.join(repoRoot, relativeDirPath);
  const entries = await readdir(absoluteDirPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryRelativePath = path.posix.join(relativeDirPath, entry.name);

    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) {
        continue;
      }

      await scanDirectory(entryRelativePath, matches);
      continue;
    }

    if (!entry.isFile() || !shouldScanHostedRunProductionFile(entryRelativePath)) {
      continue;
    }

    const contents = await readFile(path.join(repoRoot, entryRelativePath), "utf8");
    matches.push(...findHostedRunStaleResidueMatches(entryRelativePath, contents));
  }
}

function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function shouldSkipDirectory(name: string): boolean {
  return skippedDirectoryNames.has(name);
}

function shouldAllowHostedHardCutResidueMatch(input: {
  label: string;
  relativePath: string;
}): boolean {
  return legacyRejectionTableFiles.has(input.relativePath)
    && (
      input.label === "committedSeq"
      || input.label === "finalizeRequired"
      || input.label === "runDrain"
      || input.label === "runToken"
      || input.label === "targetCommittedSeqHint"
    );
}

function isTestLikePath(relativePath: string): boolean {
  const normalizedPath = normalizeRepoPath(relativePath);
  const baseName = path.posix.basename(normalizedPath);
  const segments = normalizedPath.split("/");

  if (baseName.includes(".test.") || baseName.includes(".spec.")) {
    return true;
  }

  return segments.some((segment) =>
    segment === "__fixtures__"
    || segment === "__mocks__"
    || segment === "__tests__"
    || segment === "fixtures"
    || segment === "test"
    || segment === "tests"
  );
}

function findFirstPatternMatchLine(contents: string, pattern: RegExp): number | null {
  const match = pattern.exec(contents);

  if (!match || match.index < 0) {
    return null;
  }

  return contents.slice(0, match.index).split("\n").length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
