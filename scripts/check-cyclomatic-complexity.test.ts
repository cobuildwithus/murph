import { describe, expect, it } from "vitest";

import {
  analyzeCyclomaticComplexity,
  compareFileComplexity,
  formatComplexityDiffReport,
  isCyclomaticSourcePath,
  parseNameStatus,
} from "./check-cyclomatic-complexity.js";

function functionWithBranches(name: string, branchCount: number): string {
  return `
    function ${name}(value) {
      ${Array.from(
        { length: branchCount },
        (_, index) => `if (value === ${index}) return ${index};`,
      ).join("\n")}
      return value;
    }
  `;
}

describe("cyclomatic complexity source analysis", () => {
  it("matches ESLint classic branch semantics", () => {
    const result = analyzeCyclomaticComplexity(
      "fixture.ts",
      `
        function sample(value = {}) {
          let total = 0;
          if (value && value.enabled) total += 1;
          for (let index = 0; index < 1; index += 1) total += index;
          while (false) total += 1;
          do total += 1; while (false);
          switch (total) {
            case 1: total += 1; break;
            case 2: total += 2; break;
            default: break;
          }
          try { total += 1; } catch { total = 0; }
          total ||= 1;
          const selected = value?.nested?.value ?? (total > 0 ? 1 : 0);
          handler?.();
          return selected;
        }
      `,
    );

    expect(result.functions).toEqual([
      expect.objectContaining({ complexity: 16, name: "sample" }),
    ]);
    expect(result.complexityDebt).toBe(0);
    expect(result.maximumComplexity).toBe(16);
  });

  it("keeps nested functions and class initializers out of their enclosing function", () => {
    const result = analyzeCyclomaticComplexity(
      "fixture.ts",
      `
        function outer(flag) {
          class Example {
            value = flag && (flag ? 1 : 0);
            static { if (flag) consume(flag); }
          }
          if (flag) consume(flag);
          return () => flag ? 1 : 0;
        }
      `,
    );

    expect(result.functions.map(({ complexity, name }) => ({ complexity, name })))
      .toEqual([
        { complexity: 2, name: "outer" },
        { complexity: 3, name: "class field initializer value" },
        { complexity: 2, name: "class static block" },
        { complexity: 2, name: "<anonymous>" },
      ]);
  });
});

describe("cyclomatic complexity ratchet", () => {
  it("allows behavior-preserving extraction even when raw summed complexity rises", () => {
    const baseSummary = analyzeCyclomaticComplexity(
      "source.ts",
      functionWithBranches("large", 30),
    );
    const headSummary = analyzeCyclomaticComplexity(
      "source.ts",
      `${functionWithBranches("first", 15)}${functionWithBranches("second", 15)}`,
    );

    const comparison = compareFileComplexity(
      { basePath: "source.ts", headPath: "source.ts", status: "M" },
      baseSummary,
      headSummary,
    );

    expect(baseSummary.totalComplexity).toBe(31);
    expect(headSummary.totalComplexity).toBe(32);
    expect(comparison.complexityDebtDelta).toBe(-11);
    expect(comparison.maximumComplexityDelta).toBe(-15);
    expect(comparison.violations).toEqual([]);
  });

  it("fails when debt and the maximum both increase above the threshold", () => {
    const comparison = compareFileComplexity(
      { basePath: "source.ts", headPath: "source.ts", status: "M" },
      analyzeCyclomaticComplexity("source.ts", functionWithBranches("target", 24)),
      analyzeCyclomaticComplexity("source.ts", functionWithBranches("target", 25)),
    );

    expect(comparison.complexityDebtDelta).toBe(1);
    expect(comparison.maximumComplexityDelta).toBe(1);
    expect(comparison.violations).toEqual([
      "complexity debt above 20 increased by 1",
      "maximum function complexity increased by 1",
    ]);
  });

  it("fails concentration even when total debt stays flat", () => {
    const comparison = compareFileComplexity(
      { basePath: "source.ts", headPath: "source.ts", status: "M" },
      analyzeCyclomaticComplexity(
        "source.ts",
        `${functionWithBranches("first", 24)}${functionWithBranches("second", 24)}`,
      ),
      analyzeCyclomaticComplexity(
        "source.ts",
        `${functionWithBranches("first", 29)}${functionWithBranches("second", 19)}`,
      ),
    );

    expect(comparison.complexityDebtDelta).toBe(0);
    expect(comparison.maximumComplexityDelta).toBe(5);
    expect(comparison.violations).toEqual([
      "maximum function complexity increased by 5",
    ]);
  });

  it("allows growth that remains at or below the threshold", () => {
    const comparison = compareFileComplexity(
      { basePath: "source.ts", headPath: "source.ts", status: "M" },
      analyzeCyclomaticComplexity("source.ts", functionWithBranches("target", 4)),
      analyzeCyclomaticComplexity("source.ts", functionWithBranches("target", 19)),
    );

    expect(comparison.maximumComplexityDelta).toBe(15);
    expect(comparison.violations).toEqual([]);
  });
});

describe("cyclomatic complexity diff inputs and reporting", () => {
  it("parses ordinary, rename, and deletion name-status records", () => {
    expect(parseNameStatus(
      "M\0source.ts\0R100\0old.ts\0new.ts\0D\0deleted.ts\0",
    )).toEqual([
      { basePath: "source.ts", headPath: "source.ts", status: "M" },
      { basePath: "old.ts", headPath: "new.ts", status: "R100" },
      { basePath: "deleted.ts", headPath: null, status: "D" },
    ]);
  });

  it("selects authored source and excludes generated and proof files", () => {
    expect(isCyclomaticSourcePath("packages/core/src/value.ts")).toBe(true);
    expect(isCyclomaticSourcePath("scripts/check-policy.mjs")).toBe(true);
    expect(isCyclomaticSourcePath("packages/core/src/contest.ts")).toBe(true);
    expect(isCyclomaticSourcePath("apps/web/test/value.test.ts")).toBe(false);
    expect(isCyclomaticSourcePath("packages/core/src/value.generated.ts")).toBe(false);
    expect(isCyclomaticSourcePath("packages/core/dist/value.js")).toBe(false);
    expect(isCyclomaticSourcePath("packages/core/src/value.d.ts")).toBe(false);
  });

  it("prints hotspots and an explicit agent judgment prompt", () => {
    const headSummary = analyzeCyclomaticComplexity(
      "source.ts",
      functionWithBranches("target", 20),
    );
    const comparison = compareFileComplexity(
      { basePath: null, headPath: "source.ts", status: "A" },
      analyzeCyclomaticComplexity("source.ts", ""),
      headSummary,
    );
    const output = formatComplexityDiffReport({
      baseRef: "a".repeat(40),
      files: [comparison],
      headRef: null,
      passed: false,
      threshold: 20,
    });

    expect(output).toContain("hotspot target");
    expect(output).toContain("Cyclomatic complexity guard failed");
  });
});
