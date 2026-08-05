import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isAllowedNextEnvRouteTypesImportPath } from "./check-no-js.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routeTypesImportPattern = /import\s+["'](\.\/[^"'`]*types\/routes\.d\.ts)["'];/u;
const rootParamsTypesImportPattern =
  /import\s+["'](\.\/[^"'`]*types\/root-params\.d\.ts)["'];/u;
const defaultRouteTypesImportPath = "./.next/types/routes.d.ts";
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
const routeTypesStubContents = [
  "// Auto-generated route-type stub for clean typecheck flows.",
  "export {};",
  "",
].join("\n");
const rootParamsTypesStubContents = [
  "// Type definitions for Next.js root params (next/root-params)",
  "// No root params detected.",
  "export {};",
  "",
].join("\n");
const routeTypesRuntimeStubContents = [
  "// Auto-generated route-type runtime stub for clean typecheck flows.",
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

export function extractNextRootParamsTypesImport(nextEnvContents: string): string | null {
  return nextEnvContents.match(rootParamsTypesImportPattern)?.[1] ?? null;
}

export async function ensureNextRouteTypeStub(nextEnvPath: string): Promise<string | null> {
  const nextEnvContents = await readOrCreateNextEnvDeclaration(nextEnvPath);
  const stubRelativeImportPath = extractNextRouteTypesImport(nextEnvContents);

  if (!stubRelativeImportPath || !isAllowedNextEnvRouteTypesImportPath(stubRelativeImportPath)) {
    throw new Error("next-env.d.ts is missing the generated Next 16.3 route-types import.");
  }

  const rootParamsRelativeImportPath = stubRelativeImportPath.replace(
    /routes\.d\.ts$/u,
    "root-params.d.ts",
  );
  const stubPath = path.resolve(path.dirname(nextEnvPath), stubRelativeImportPath);
  await ensureDeclarationStub(stubPath, routeTypesStubContents);
  await ensureDeclarationStub(
    path.resolve(path.dirname(nextEnvPath), rootParamsRelativeImportPath),
    rootParamsTypesStubContents,
  );

  await ensureNextRouteTypesRuntimeStub(stubPath);
  await removeStaleNextValidatorStub(stubPath);

  return stubPath;
}

async function readOrCreateNextEnvDeclaration(nextEnvPath: string): Promise<string> {
  let contents: string;
  try {
    contents = await readFile(nextEnvPath, "utf8");
  } catch (error) {
    if (!isNodeErrorWithCode(error, "ENOENT")) {
      throw error;
    }

    contents = buildNextEnvDeclarationArtifact(defaultRouteTypesImportPath);
    await writeFile(nextEnvPath, contents, "utf8");
    return contents;
  }

  const routeTypesImportPath = extractNextRouteTypesImport(contents);
  if (!routeTypesImportPath || !isAllowedNextEnvRouteTypesImportPath(routeTypesImportPath)) {
    throw new Error("next-env.d.ts has an unsupported generated route-types import.");
  }

  const expectedCurrentContents = buildNextEnvDeclarationArtifact(routeTypesImportPath);
  if (normalizeDeclarationContents(contents) === normalizeDeclarationContents(expectedCurrentContents)) {
    return contents;
  }

  const legacyContents = buildLegacyNextEnvDeclarationArtifact(routeTypesImportPath);
  if (normalizeDeclarationContents(contents) !== normalizeDeclarationContents(legacyContents)) {
    throw new Error("next-env.d.ts does not match the generated Next 16.2 or 16.3 declaration shape.");
  }

  const migratedContents = contents.includes("\r\n")
    ? expectedCurrentContents.replace(/\n/g, "\r\n")
    : expectedCurrentContents;
  await writeFile(nextEnvPath, migratedContents, "utf8");
  return migratedContents;
}

function buildNextEnvDeclarationArtifact(routeTypesImportPath: string): string {
  const rootParamsImportPath = routeTypesImportPath.replace(/routes\.d\.ts$/u, "root-params.d.ts");
  return [
    ...nextEnvCommonLines,
    `import "${routeTypesImportPath}";`,
    `import "${rootParamsImportPath}";`,
    ...nextEnvTrailingLines,
  ].join("\n");
}

function buildLegacyNextEnvDeclarationArtifact(routeTypesImportPath: string): string {
  return [...nextEnvCommonLines, `import "${routeTypesImportPath}";`, ...nextEnvTrailingLines].join(
    "\n",
  );
}

function normalizeDeclarationContents(contents: string): string {
  return contents.replace(/\r\n/g, "\n").replace(/\n$/u, "");
}

async function ensureDeclarationStub(stubPath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(stubPath), { recursive: true });

  try {
    await readFile(stubPath, "utf8");
  } catch {
    await writeFile(stubPath, contents, "utf8");
  }
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && Reflect.get(error, "code") === code;
}

async function ensureNextRouteTypesRuntimeStub(routeTypesStubPath: string): Promise<void> {
  if (!routeTypesStubPath.endsWith("/routes.d.ts")) {
    return;
  }

  const runtimeStubPath = routeTypesStubPath.replace(/\.d\.ts$/u, ".js");

  try {
    await readFile(runtimeStubPath, "utf8");
  } catch {
    await writeFile(runtimeStubPath, routeTypesRuntimeStubContents, "utf8");
  }
}

async function removeStaleNextValidatorStub(routeTypesStubPath: string): Promise<void> {
  if (!routeTypesStubPath.endsWith("/routes.d.ts")) {
    return;
  }

  const candidateValidatorPaths = new Set<string>([
    routeTypesStubPath.replace(/routes\.d\.ts$/u, "validator.ts"),
  ]);

  const workspaceRoot = extractWorkspaceRootFromRouteTypesPath(routeTypesStubPath);
  if (workspaceRoot) {
    candidateValidatorPaths.add(path.join(workspaceRoot, ".next", "types", "validator.ts"));
  }

  await Promise.all(
    [...candidateValidatorPaths].map(async (validatorPath) => {
      await rm(validatorPath, { force: true });
    }),
  );
}

function extractWorkspaceRootFromRouteTypesPath(routeTypesStubPath: string): string | null {
  const normalizedPath = routeTypesStubPath.replace(/\\/g, "/");
  const match = normalizedPath.match(/^(.*)\/\.next(?:-[^/]+)?\/.*\/routes\.d\.ts$/u);
  return match?.[1] ?? null;
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
