import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanRoots = ["apps", "packages"] as const;
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
  "apps/web/app/api/internal/hosted-wake",
  "apps/web/src/lib/hosted-wake",
] as const;
const blockedContentTokens = [
  "HostedWakeTerminal",
  "assistantNextWakeAt",
  "wakeMaterializationHints",
  "pending_commit_json",
  "wake_materialization_hints_json",
] as const;
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

  for (const blockedContentToken of blockedContentTokens) {
    const line = findFirstMatchLine(contents, blockedContentToken);

    if (line !== null) {
      matches.push({
        kind: "content",
        filePath: normalizedPath,
        matched: blockedContentToken,
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
      "No blocked hosted-wake production residue was found in apps/packages source files.",
    );
    return;
  }

  const lines = [
    "Found blocked hosted-wake production residue. Keep the live hosted framing run-centric and ingress-centric; legacy wake-by-wake protocol residue is allowed only in tests/history, not production apps/packages source files.",
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

function findFirstMatchLine(contents: string, token: string): number | null {
  const index = contents.indexOf(token);

  if (index < 0) {
    return null;
  }

  return contents.slice(0, index).split("\n").length;
}

void main();
