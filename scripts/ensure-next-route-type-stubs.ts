import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routeTypesImportPattern = /import\s+["'](\.\/[^"'`]*types\/routes\.d\.ts)["'];/u;
const routeTypesStubContents = [
  "// Auto-generated route-type stub for clean typecheck flows.",
  "export {};",
  "",
].join("\n");

export async function ensureNextRouteTypeStubForWorkspace(
  workspaceRelativePath: string,
): Promise<string | null> {
  const nextEnvPath = path.join(repoRoot, workspaceRelativePath, "next-env.d.ts");
  const ensuredStubPath = await ensureNextRouteTypeStub(nextEnvPath);
  return ensuredStubPath ? path.relative(repoRoot, ensuredStubPath).replace(/\\/g, "/") : null;
}

export function extractNextRouteTypesImport(nextEnvContents: string): string | null {
  return nextEnvContents.match(routeTypesImportPattern)?.[1] ?? null;
}

export async function ensureNextRouteTypeStub(nextEnvPath: string): Promise<string | null> {
  const nextEnvContents = await readFile(nextEnvPath, "utf8");
  const stubRelativeImportPath = extractNextRouteTypesImport(nextEnvContents);

  if (!stubRelativeImportPath) {
    return null;
  }

  const stubPath = path.resolve(path.dirname(nextEnvPath), stubRelativeImportPath);
  await mkdir(path.dirname(stubPath), { recursive: true });

  try {
    await readFile(stubPath, "utf8");
  } catch {
    await writeFile(stubPath, routeTypesStubContents, "utf8");
  }

  return stubPath;
}

async function main(): Promise<void> {
  const workspaceRelativePaths = process.argv.slice(2);

  if (workspaceRelativePaths.length === 0) {
    throw new Error("Usage: tsx scripts/ensure-next-route-type-stubs.ts <workspace-dir> [...]");
  }

  for (const workspaceRelativePath of workspaceRelativePaths) {
    await ensureNextRouteTypeStubForWorkspace(workspaceRelativePath);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
