import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanRoots = ["packages", "apps", "e2e"] as const;
const blockedExtensions = new Set([".js", ".mjs", ".cjs", ".d.ts"]);
const allowedSourceArtifacts = new Set(["packages/web/postcss.config.mjs"]);
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
export const allowedDeclarationArtifacts = new Map<string, string[]>([
  [
    "packages/web/next-env.d.ts",
    [
      [...nextEnvCommonLines, 'import "./.next/types/routes.d.ts";', ...nextEnvTrailingLines].join(
        "\n",
      ),
      [...nextEnvCommonLines, 'import "./.next/dev/types/routes.d.ts";', ...nextEnvTrailingLines].join(
        "\n",
      ),
    ],
  ],
  [
    "apps/web/next-env.d.ts",
    [
      [...nextEnvCommonLines, 'import "./.next/types/routes.d.ts";', ...nextEnvTrailingLines].join(
        "\n",
      ),
      [...nextEnvCommonLines, 'import "./.next/dev/types/routes.d.ts";', ...nextEnvTrailingLines].join(
        "\n",
      ),
    ],
  ],
]);

export async function main(): Promise<void> {
  const sourceArtifactOffenders: string[] = [];

  for (const root of scanRoots) {
    await scanPath(root, sourceArtifactOffenders);
  }

  const trackedBuildArtifactOffenders = await findTrackedBuildArtifacts();

  if (sourceArtifactOffenders.length > 0 || trackedBuildArtifactOffenders.length > 0) {
    const message = ["Found blocked package/e2e source or tracked build artifacts:"];

    if (sourceArtifactOffenders.length > 0) {
      message.push(
        "Handwritten source artifacts outside dist/:",
        ...sourceArtifactOffenders.map((filePath) => `- ${filePath}`),
      );
    }

    if (trackedBuildArtifactOffenders.length > 0) {
      message.push(
        "Tracked build artifacts:",
        ...trackedBuildArtifactOffenders.map((filePath) => `- ${filePath}`),
      );
    }

    throw new Error(message.join("\n"));
  }

  console.log(
    "No handwritten .js, .mjs, .cjs, or .d.ts files beyond the allowlisted Next.js declaration stubs, and no tracked dist/.next/.test-dist/*.tsbuildinfo artifacts, found under packages/, apps/, or e2e/.",
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
        entry.name === ".next"
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

export function isAllowedDeclarationArtifactContents(
  relativePath: string,
  contents: string,
): boolean {
  const expectedContents = allowedDeclarationArtifacts.get(relativePath);
  return expectedContents?.includes(contents) ?? false;
}

async function findTrackedBuildArtifacts(): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["ls-files", "--", ...scanRoots], {
    cwd: repoRoot,
  });
  const trackedFiles = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return trackedFiles.filter(
    (filePath) =>
      filePath.endsWith(".tsbuildinfo") ||
      filePath.includes("/.next/") ||
      filePath.includes("/.test-dist/") ||
      filePath.includes("/dist/"),
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
