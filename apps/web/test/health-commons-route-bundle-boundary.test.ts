import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
describe("Health Commons route-bundle boundary", () => {
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
    normalizedPath.includes("/measurement-methods/") ||
    source.includes("measurement-method-detail")
  );
}
