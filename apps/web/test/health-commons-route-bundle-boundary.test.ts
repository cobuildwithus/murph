import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const sourceFiles: readonly string[] = [
  "apps/web/src/lib/health-commons/experiment-detail.ts",
  "apps/web/src/lib/health-commons/biomarker-detail.ts",
  "apps/web/app/(dashboard)/experiments/[experimentId]/layout.tsx",
  "apps/web/app/(dashboard)/experiments/[experimentId]/page.tsx",
  "apps/web/app/(dashboard)/experiments/[experimentId]/research/page.tsx",
  "apps/web/app/(dashboard)/experiments/[experimentId]/results/page.tsx",
  "apps/web/app/biomarkers/[biomarkerId]/page.tsx",
] as const;

const blockedCatalogPatterns = [
  "@murphai/health-commons/generated/catalog.json",
  "generated/catalog.json",
  "getGeneratedHealthCommonsCatalogReader",
  "healthCommonsCatalog",
  "loadGeneratedHealthCommonsCatalog",
  "from \"./catalog\"",
  "from './catalog'",
] as const;

describe("Health Commons route-bundle boundary", () => {
  it("keeps public Health Commons route code off the monolithic generated catalog", () => {
    for (const relativePath of collectPublicHealthCommonsSourceFiles()) {
      const source = readFileSync(path.join(repoRoot, relativePath), "utf8");

      for (const pattern of blockedCatalogPatterns) {
        expect(source, `${relativePath} should not contain ${pattern}`).not.toContain(pattern);
      }
    }
  });

  it("keeps the public experiment layout static-first", () => {
    const source = readFileSync(
      path.join(repoRoot, "apps/web/app/(dashboard)/experiments/[experimentId]/layout.tsx"),
      "utf8",
    );

    expect(source).not.toContain("next/headers");
    expect(source).not.toContain("cookies(");
    expect(source).not.toContain("headers(");
    expect(source).not.toContain("@prisma/client");
    expect(source).not.toContain("prisma");
    expect(source).not.toContain("getServerSession");
    expect(source).not.toContain("auth(");
  });

  it("fails if existing Next traces include the monolithic generated catalog in public Health Commons routes", () => {
    const traceRoots = [
      "apps/web/.next",
    ];
    const traceFiles = traceRoots.flatMap((traceRoot) =>
      listTraceFiles(path.join(repoRoot, traceRoot))
    );

    for (const traceFile of traceFiles) {
      const source = readFileSync(traceFile, "utf8");
      if (!isHealthCommonsRouteTrace(traceFile, source)) {
        continue;
      }

      expect(source, path.relative(repoRoot, traceFile)).not.toContain(
        "@murphai/health-commons/generated/catalog.json",
      );
      expect(source, path.relative(repoRoot, traceFile)).not.toContain(
        "packages/health-commons/generated/catalog.json",
      );
    }
  });
});

function collectPublicHealthCommonsSourceFiles(): string[] {
  const visited = new Set<string>();
  const stack = [...sourceFiles];

  while (stack.length > 0) {
    const relativePath = stack.pop();
    if (!relativePath || visited.has(relativePath)) {
      continue;
    }

    visited.add(relativePath);
    const source = readFileSync(path.join(repoRoot, relativePath), "utf8");
    for (const specifier of extractRelativeImportSpecifiers(source)) {
      const resolved = resolveRelativeSourceFile(relativePath, specifier);
      if (resolved && isPublicHealthCommonsSourceFile(resolved)) {
        stack.push(resolved);
      }
    }
  }

  return [...visited].sort();
}

function extractRelativeImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importPattern =
    /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["'](\.[^"']+)["']/gu;

  for (const match of source.matchAll(importPattern)) {
    if (match[1]) {
      specifiers.push(match[1]);
    }
  }

  return specifiers;
}

function resolveRelativeSourceFile(fromRelativePath: string, specifier: string): string | null {
  const basePath = path.normalize(path.join(path.dirname(fromRelativePath), specifier));
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
  ];

  for (const candidate of candidates) {
    const absolutePath = path.join(repoRoot, candidate);
    if (existsSync(absolutePath) && statSync(absolutePath).isFile()) {
      return candidate.replace(/\\/gu, "/");
    }
  }

  return null;
}

function isPublicHealthCommonsSourceFile(relativePath: string): boolean {
  return sourceFiles.includes(relativePath)
    || relativePath.startsWith("apps/web/src/lib/health-commons/experiment-detail")
    || relativePath.startsWith("apps/web/src/lib/health-commons/biomarker-detail");
}

function listTraceFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const result: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const stat = statSync(current);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(current)) {
        stack.push(path.join(current, entry));
      }
      continue;
    }

    if (current.endsWith(".nft.json")) {
      result.push(current);
    }
  }

  return result;
}

function isHealthCommonsRouteTrace(filePath: string, source: string): boolean {
  const normalizedPath = filePath.replace(/\\/gu, "/");
  return (
    normalizedPath.includes("/experiments/") ||
    normalizedPath.includes("/biomarkers/") ||
    source.includes("experiment-detail") ||
    source.includes("biomarker-detail")
  );
}
