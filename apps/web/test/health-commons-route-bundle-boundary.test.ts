import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const sourceFiles: readonly string[] = [
  "apps/web/src/lib/health-commons/experiment-detail.ts",
  "apps/web/src/lib/health-commons/experiment-browse.ts",
  "apps/web/src/lib/health-commons/generated-experiment-artifacts.ts",
  "apps/web/src/lib/health-commons/generated-biomarker-artifacts.ts",
  "apps/web/src/lib/health-commons/generated-measurement-method-artifacts.ts",
  "apps/web/src/lib/health-commons/experiment-projections.ts",
  "apps/web/src/lib/health-commons/biomarker-projections.ts",
  "apps/web/src/lib/health-commons/measurement-method-detail.ts",
  "apps/web/app/(dashboard)/experiments/page.tsx",
  "apps/web/app/(dashboard)/experiments/[experimentId]/layout.tsx",
  "apps/web/app/(dashboard)/experiments/[experimentId]/page.tsx",
  "apps/web/app/(dashboard)/experiments/[experimentId]/research/page.tsx",
  "apps/web/app/(dashboard)/experiments/[experimentId]/results/page.tsx",
  "apps/web/app/(dashboard)/biomarkers/[biomarkerId]/page.tsx",
  "apps/web/app/measurement-methods/[measurementMethodId]/page.tsx",
] as const;

const blockedCatalogPatterns = [
  "@murphai/health-commons/generated/catalog.json",
  "generated/catalog.json",
  "getGeneratedHealthCommonsCatalogReader",
  "getHealthCommonsCatalogReader",
  "healthCommonsCatalog",
  "loadGeneratedHealthCommonsCatalog",
  "from \"@/src/lib/health-commons/catalog\"",
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

  it("keeps experiment browse code off the filesystem-backed Health Commons runtime", () => {
    const source = readFileSync(
      path.join(repoRoot, "apps/web/src/lib/health-commons/experiment-browse.ts"),
      "utf8",
    );

    expect(source).not.toContain("@murphai/health-commons/runtime");
  });

  it("keeps public biomarker pages on generated page projections instead of route bundles", () => {
    const files = [
      "apps/web/app/(dashboard)/biomarkers/page.tsx",
      "apps/web/app/(dashboard)/biomarkers/[biomarkerId]/layout.tsx",
      "apps/web/app/(dashboard)/biomarkers/[biomarkerId]/page.tsx",
      "apps/web/app/(dashboard)/biomarkers/[biomarkerId]/research/page.tsx",
      "apps/web/src/lib/health-commons/biomarker-projections.ts",
    ];

    for (const relativePath of files) {
      const source = readFileSync(path.join(repoRoot, relativePath), "utf8");

      expect(source, `${relativePath} should not load biomarker route bundles`).not.toContain(
        "loadGeneratedHealthCommonsWebRouteBundle",
      );
      expect(source, `${relativePath} should not instantiate biomarker route bundle readers`).not.toContain(
        "createHealthCommonsRouteBundleReader",
      );
    }
  });

  it("keeps biomarker experiment cards on projected protocol images", () => {
    const files = [
      "apps/web/src/components/biomarkers/biomarker-detail/biomarker-experiment-card.tsx",
      "apps/web/src/components/biomarkers/biomarker-detail/biomarker-experiment-card-hero.tsx",
      "apps/web/src/components/biomarkers/biomarker-detail/biomarker-experiment-row.tsx",
    ];

    for (const relativePath of files) {
      const source = readFileSync(path.join(repoRoot, relativePath), "utf8");

      expect(source, `${relativePath} should not N+1 load experiment shells`).not.toContain(
        "resolveHealthCommonsExperimentShell",
      );
    }
  });

  it("fails if existing Next traces include the monolithic generated catalog in public Health Commons routes", () => {
    const traceRoots = [
      "apps/web/.next",
    ];
    const traceFiles = traceRoots.flatMap((traceRoot) =>
      listTraceFiles(path.join(repoRoot, traceRoot))
    );

    const routeTraces = traceFiles.flatMap((traceFile) => {
      const source = readFileSync(traceFile, "utf8");
      return isHealthCommonsRouteTrace(traceFile, source)
        ? [{ source, traceFile }]
        : [];
    });

    if (process.env.MURPH_REQUIRE_HEALTH_COMMONS_ROUTE_TRACES === "1") {
      expect(
        routeTraces.length,
        "the production build should emit a Health Commons route trace",
      ).toBeGreaterThan(0);
    }

    for (const { source, traceFile } of routeTraces) {
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
      const resolved = resolveSourceFile(relativePath, specifier);
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
    /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']((?:\.|@\/src\/lib\/health-commons\/)[^"']+)["']/gu;

  for (const match of source.matchAll(importPattern)) {
    if (match[1]) {
      specifiers.push(match[1]);
    }
  }

  return specifiers;
}

function resolveSourceFile(fromRelativePath: string, specifier: string): string | null {
  if (specifier.startsWith("@/src/lib/health-commons/")) {
    return resolveRelativeSourceFile(
      "apps/web/src/lib/health-commons/__alias__.ts",
      `./${specifier.slice("@/src/lib/health-commons/".length)}`,
    );
  }

  return resolveRelativeSourceFile(fromRelativePath, specifier);
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
    || relativePath.startsWith("apps/web/app/(dashboard)/experiments")
    || relativePath.startsWith("apps/web/app/(dashboard)/biomarkers")
    || relativePath.startsWith("apps/web/app/measurement-methods")
    || relativePath.startsWith("apps/web/src/lib/health-commons/experiment-browse")
    || relativePath.startsWith("apps/web/src/lib/health-commons/experiment-detail")
    || relativePath.startsWith("apps/web/src/lib/health-commons/experiment-images")
    || relativePath.startsWith("apps/web/src/lib/health-commons/experiment-projections")
    || relativePath.startsWith("apps/web/src/lib/health-commons/generated-experiment-artifacts")
    || relativePath.startsWith("apps/web/src/lib/health-commons/generated-biomarker-artifacts")
    || relativePath.startsWith("apps/web/src/lib/health-commons/generated-measurement-method-artifacts")
    || relativePath.startsWith("apps/web/src/lib/health-commons/biomarker-projections")
    || relativePath.startsWith("apps/web/src/lib/health-commons/measurement-method-detail");
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

    const stat = statPathIfPresent(current);
    if (!stat) {
      continue;
    }

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

function statPathIfPresent(filePath: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(filePath);
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

function isHealthCommonsRouteTrace(filePath: string, source: string): boolean {
  const normalizedPath = filePath.replace(/\\/gu, "/");
  return (
    normalizedPath.includes("/experiments/") ||
    normalizedPath.includes("/biomarkers/") ||
    normalizedPath.includes("/measurement-methods/") ||
    source.includes("experiment-detail") ||
    source.includes("biomarker-detail") ||
    source.includes("measurement-method-detail")
  );
}
