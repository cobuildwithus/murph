import path from "node:path";

export type MurphVitestCoverageThresholds = {
  perFile: boolean;
  lines: number;
  functions: number;
  branches: number;
  statements: number;
};

export const murphVitestCoverageThresholds: MurphVitestCoverageThresholds = {
  perFile: true,
  lines: 85,
  functions: 85,
  branches: 80,
  statements: 85,
};

export function resolveMurphVitestCoverageProviderModule(packageDir: string): string {
  return path.resolve(packageDir, "../../config/vitest-coverage-provider.ts");
}

export function createMurphVitestCoverage(input: {
  customProviderModule: string;
  include: string[];
  exclude?: string[];
  thresholds?: MurphVitestCoverageThresholds;
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
    thresholds: input.thresholds ?? murphVitestCoverageThresholds,
    reportOnFailure: true,
  };
}
