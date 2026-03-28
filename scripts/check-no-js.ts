import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanRoots = ["packages", "apps", "e2e"] as const;
const blockedExtensions = new Set([".js", ".mjs", ".cjs", ".d.ts"]);
const allowedSourceArtifacts = new Set([
  "packages/web/postcss.config.mjs",
  "apps/web/postcss.config.mjs",
]);
const blockedTrackedArtifactDirectoryNames = new Set([
  "dist",
  ".next",
  ".next-dev",
  ".next-smoke",
  ".test-dist",
]);
const execFileAsync = promisify(execFile);
const nextEnvCommonLines = [
  '/// <reference types="next" />',
  '/// <reference types="next/image-types/global" />',
];
const nextEnvTrailingLines = [
  "",
  "// NOTE: This file should not be edited",
  "// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.",
  "",
];
const bundleArtifactFlag = "--for-source-bundle";

export function buildNextEnvDeclarationArtifact(routeTypesImportPath: string): string {
  return [...nextEnvCommonLines, `import "${routeTypesImportPath}";`, ...nextEnvTrailingLines].join(
    "\n",
  );
}

export function buildNextEnvDeclarationArtifacts(
  routeTypesImportPaths: readonly string[],
): string[] {
  return routeTypesImportPaths.map(buildNextEnvDeclarationArtifact);
}

export const allowedDeclarationArtifacts = new Map<string, string[]>([
  [
    "packages/web/next-env.d.ts",
    buildNextEnvDeclarationArtifacts([
      "./.next/types/routes.d.ts",
      "./.next/dev/types/routes.d.ts",
    ]),
  ],
  [
    "apps/web/next-env.d.ts",
    buildNextEnvDeclarationArtifacts([
      "./.next/types/routes.d.ts",
      "./.next-dev/types/routes.d.ts",
      "./.next-dev/dev/types/routes.d.ts",
      "./.next-smoke/types/routes.d.ts",
      "./.next-smoke/dev/types/routes.d.ts",
      "./.next/dev/types/routes.d.ts",
    ]),
  ],
]);

export async function main(): Promise<void> {
  const checkWorkingTreeBundleArtifacts = process.argv.includes(bundleArtifactFlag);
  const sourceArtifactOffenders: string[] = [];

  for (const root of scanRoots) {
    await scanPath(root, sourceArtifactOffenders);
  }

  const trackedArtifactOffenders = await findBlockedTrackedArtifacts();
  const workingTreeArtifactOffenders = checkWorkingTreeBundleArtifacts
    ? await findBlockedWorkingTreeArtifacts()
    : [];

  if (
    sourceArtifactOffenders.length > 0 ||
    trackedArtifactOffenders.length > 0 ||
    workingTreeArtifactOffenders.length > 0
  ) {
    const message = ["Found blocked package/e2e source or private/build artifacts:"];

    if (sourceArtifactOffenders.length > 0) {
      message.push(
        "Handwritten source artifacts outside dist/:",
        ...sourceArtifactOffenders.map((filePath) => `- ${filePath}`),
      );
    }

    if (trackedArtifactOffenders.length > 0) {
      message.push(
        "Tracked private/build artifacts:",
        ...trackedArtifactOffenders.map((filePath) => `- ${filePath}`),
      );
    }

    if (workingTreeArtifactOffenders.length > 0) {
      message.push(
        "Working-tree private/build artifacts that would leak into a raw source bundle:",
        ...workingTreeArtifactOffenders.map((filePath) => `- ${filePath}`),
        "Clear generated output before packaging (for example, `pnpm clean`) and exclude local `.env` files from any shared clone/archive.",
      );
    }

    throw new Error(message.join("\n"));
  }

  if (checkWorkingTreeBundleArtifacts) {
    console.log(
      "No blocked handwritten source files, tracked private/build artifacts, or working-tree private/build artifacts that would leak into a source bundle, were found.",
    );
    return;
  }

  console.log(
    "No handwritten .js, .mjs, .cjs, or .d.ts files beyond the allowlisted Next.js declaration stubs and fixed PostCSS config paths, and no tracked .env/.env.* private files or dist/.next/.next-dev/.next-smoke/.test-dist/*.tsbuildinfo artifacts, were found.",
  );
}

async function scanPath(relativePath: string, offenders: string[]): Promise<void> {
  const absolutePath = path.join(repoRoot, relativePath);
  const entries = await readdir(absolutePath, { withFileTypes: true });

  for (const entry of entries) {
    const entryRelativePath = path.posix.join(relativePath, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name === "dist" ||
        entry.name === "node_modules" ||
        entry.name === "coverage" ||
        entry.name === ".next" ||
        entry.name === ".next-dev" ||
        entry.name === ".next-smoke"
      ) {
        continue;
      }

      await scanPath(entryRelativePath, offenders);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name);
    const hasBlockedDeclarationSuffix = entry.name.endsWith(".d.ts");

    if (blockedExtensions.has(extension) || hasBlockedDeclarationSuffix) {
      if (allowedSourceArtifacts.has(entryRelativePath)) {
        continue;
      }

      if (await isAllowedDeclarationArtifact(entryRelativePath)) {
        continue;
      }

      offenders.push(entryRelativePath);
    }
  }
}

async function isAllowedDeclarationArtifact(relativePath: string): Promise<boolean> {
  const absolutePath = path.join(repoRoot, relativePath);
  const contents = await readFile(absolutePath, "utf8");
  return isAllowedDeclarationArtifactContents(relativePath, contents);
}

function normalizeGitPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function isAllowedDeclarationArtifactContents(
  relativePath: string,
  contents: string,
): boolean {
  const expectedContents = allowedDeclarationArtifacts.get(relativePath);
  return expectedContents?.includes(contents) ?? false;
}

export function isBlockedTrackedEnvArtifactPath(filePath: string): boolean {
  const normalizedPath = normalizeGitPath(filePath);
  const baseName = path.posix.basename(normalizedPath);

  if (baseName === ".env") {
    return true;
  }

  return baseName.startsWith(".env.") && !baseName.endsWith(".example");
}

export function isBlockedTrackedArtifactPath(filePath: string): boolean {
  const normalizedPath = normalizeGitPath(filePath);

  if (isBlockedTrackedEnvArtifactPath(normalizedPath)) {
    return true;
  }

  if (normalizedPath.endsWith(".tsbuildinfo")) {
    return true;
  }

  const pathSegments = normalizedPath.split("/");
  return pathSegments.some((segment) => blockedTrackedArtifactDirectoryNames.has(segment));
}

export function getBlockedWorkingTreeArtifactPath(
  filePath: string,
  entryType: "file" | "directory",
): string | null {
  const normalizedPath = normalizeGitPath(filePath).replace(/\/+$/u, "");

  if (entryType === "directory") {
    return isBlockedTrackedArtifactPath(normalizedPath) ? `${normalizedPath}/` : null;
  }

  if (isBlockedTrackedEnvArtifactPath(normalizedPath) || normalizedPath.endsWith(".tsbuildinfo")) {
    return normalizedPath;
  }

  return null;
}

async function findBlockedTrackedArtifacts(): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["ls-files"], {
    cwd: repoRoot,
  });
  const trackedFiles = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return trackedFiles.filter(isBlockedTrackedArtifactPath);
}

async function findBlockedWorkingTreeArtifacts(): Promise<string[]> {
  const offenders: string[] = [];

  for (const root of scanRoots) {
    await scanWorkingTreeArtifacts(root, offenders);
  }

  return offenders;
}

async function scanWorkingTreeArtifacts(relativePath: string, offenders: string[]): Promise<void> {
  const absolutePath = path.join(repoRoot, relativePath);
  const entries = await readdir(absolutePath, { withFileTypes: true });

  for (const entry of entries) {
    const entryRelativePath = path.posix.join(relativePath, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules") {
        continue;
      }

      const blockedDirectoryPath = getBlockedWorkingTreeArtifactPath(entryRelativePath, "directory");

      if (blockedDirectoryPath) {
        offenders.push(blockedDirectoryPath);
        continue;
      }

      await scanWorkingTreeArtifacts(entryRelativePath, offenders);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const blockedFilePath = getBlockedWorkingTreeArtifactPath(entryRelativePath, "file");

    if (blockedFilePath) {
      offenders.push(blockedFilePath);
    }
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
