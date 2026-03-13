import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanRoots = ["packages", "e2e"] as const;
const blockedExtensions = new Set([".js", ".mjs", ".cjs", ".d.ts"]);

async function main(): Promise<void> {
  const offenders: string[] = [];

  for (const root of scanRoots) {
    await scanPath(root, offenders);
  }

  if (offenders.length > 0) {
    throw new Error(
      [
        "Found handwritten source artifacts outside dist/:",
        ...offenders.map((filePath) => `- ${filePath}`),
      ].join("\n"),
    );
  }

  console.log("No handwritten .js, .mjs, .cjs, or .d.ts files found under packages/ or e2e/.");
}

async function scanPath(relativePath: string, offenders: string[]): Promise<void> {
  const absolutePath = path.join(repoRoot, relativePath);
  const entries = await readdir(absolutePath, { withFileTypes: true });

  for (const entry of entries) {
    const entryRelativePath = path.posix.join(relativePath, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules") {
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
      offenders.push(entryRelativePath);
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
