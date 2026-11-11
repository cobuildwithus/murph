import path from "node:path";

export function resolveMurphVitestCoverageProviderModule(packageDir: string): string {
  return path.resolve(packageDir, "../../config/vitest-coverage-provider.ts");
}

export function createMurphVitestCoverage(input: {
  customProviderModule: string;
  include: string[];
  exclude?: string[];
}) {
  return {
    provider: "custom" as const,
    customProviderModule: input.customProviderModule,
    reporter: ["text", "lcov"] as string[],
    reportsDirectory: "./coverage",
    include: [...input.include],
    exclude: [
      "coverage/**",
      "dist/**",
      ...(input.exclude ?? []),
      "**/*.d.ts",
    ],
    reportOnFailure: true,
  };
}
