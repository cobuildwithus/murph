import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  analyzeCyclomaticComplexity,
  compareFileComplexity,
  formatComplexityDiffReport,
  isCyclomaticSourcePath,
  parseNameStatus,
} from "./check-cyclomatic-complexity.js";

const analyzerScriptPath = fileURLToPath(
  new URL("./check-cyclomatic-complexity.ts", import.meta.url),
);
const tsxCliPath = createRequire(import.meta.url).resolve("tsx/cli");

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

function functionWithSplitBranches(
  name: string,
  baseBranchCount: number,
  prBranchCount: number,
): string {
  return `
    export function ${name}(value) {
      ${Array.from(
        { length: baseBranchCount },
        (_, index) => `if (value === ${index}) return ${index};`,
      ).join("\n")}
      // Keep branch-owned edits in separate Git hunks.
      // 01
      // 02
      // 03
      // 04
      // 05
      // 06
      // 07
      // 08
      // 09
      // 10
      ${Array.from(
        { length: prBranchCount },
        (_, index) => `if (value === ${index + 1000}) return ${index + 1000};`,
      ).join("\n")}
      return value;
    }
  `;
}

function runFixtureGit(repository: string, ...args: string[]): string {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd: repository, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || `Git failed: ${args.join(" ")}`);
  }
  return result.stdout.trim();
}

function runComplexityCli(repository: string, ...args: string[]) {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  delete environment.MURPH_COMPLEXITY_BASE_SHA;
  delete environment.MURPH_COMPLEXITY_HEAD_SHA;
  return spawnSync(
    process.execPath,
    [tsxCliPath, analyzerScriptPath, ...args],
    {
      cwd: repository,
      encoding: "utf8",
      env: environment,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
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

  it("prints every hotspot that requires agent judgment", () => {
    const names = Array.from({ length: 6 }, (_, index) => `hotspot${index + 1}`);
    const headSummary = analyzeCyclomaticComplexity(
      "source.ts",
      names.map((name) => functionWithBranches(name, 20)).join("\n"),
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

    for (const name of names) {
      expect(output).toContain(`hotspot ${name}`);
    }
  });
});

describe("cyclomatic complexity CLI composition", () => {
  it("compares the exact merge candidate and covers changed Git path shapes", async () => {
    const repository = await mkdtemp(path.join(tmpdir(), "complexity-cli-"));

    try {
      runFixtureGit(repository, "init", "--initial-branch=main");
      await writeFile(
        path.join(repository, "source.ts"),
        functionWithSplitBranches("target", 9, 0),
      );
      await writeFile(
        path.join(repository, "inverse.ts"),
        functionWithSplitBranches("inverse", 20, 0),
      );
      await writeFile(path.join(repository, "delete.ts"), "export const removed = true;\n");
      await writeFile(path.join(repository, "rename.ts"), "export const renamed = true;\n");
      runFixtureGit(repository, "add", ".");
      runFixtureGit(repository, "commit", "-m", "initial");

      runFixtureGit(repository, "switch", "-c", "feature");
      await writeFile(
        path.join(repository, "source.ts"),
        functionWithSplitBranches("target", 9, 1),
      );
      await writeFile(
        path.join(repository, "inverse.ts"),
        functionWithSplitBranches("inverse", 20, 1),
      );
      await writeFile(path.join(repository, "added.ts"), "export const added = true;\n");
      runFixtureGit(repository, "rm", "delete.ts");
      runFixtureGit(repository, "mv", "rename.ts", "moved.ts");
      runFixtureGit(repository, "add", ".");
      runFixtureGit(repository, "commit", "-m", "feature changes");
      const pullRequestHead = runFixtureGit(repository, "rev-parse", "HEAD");

      runFixtureGit(repository, "switch", "main");
      await writeFile(
        path.join(repository, "source.ts"),
        functionWithSplitBranches("target", 19, 0),
      );
      await writeFile(
        path.join(repository, "inverse.ts"),
        functionWithSplitBranches("inverse", 10, 0),
      );
      runFixtureGit(repository, "add", "source.ts", "inverse.ts");
      runFixtureGit(repository, "commit", "-m", "advance base");
      const eventBase = runFixtureGit(repository, "rev-parse", "HEAD");
      runFixtureGit(repository, "merge", "--no-ff", "feature", "-m", "merge candidate");
      const mergeCandidate = runFixtureGit(repository, "rev-parse", "HEAD");

      const branchOnly = runComplexityCli(
        repository,
        "--base",
        eventBase,
        "--head",
        pullRequestHead,
        "--",
        "source.ts",
      );
      expect(branchOnly.status, branchOnly.stderr).toBe(0);

      const exactCandidate = runComplexityCli(
        repository,
        "--base",
        `${mergeCandidate}^1`,
        "--head",
        mergeCandidate,
        "--",
        "source.ts",
      );
      expect(exactCandidate.status, exactCandidate.stderr).toBe(1);
      expect(exactCandidate.stdout).toContain("debt 0 -> 1");

      const inverseBranchOnly = runComplexityCli(
        repository,
        "--base",
        eventBase,
        "--head",
        pullRequestHead,
        "--",
        "inverse.ts",
      );
      expect(inverseBranchOnly.status, inverseBranchOnly.stderr).toBe(1);

      const inverseCandidate = runComplexityCli(
        repository,
        "--base",
        `${mergeCandidate}^1`,
        "--head",
        mergeCandidate,
        "--",
        "inverse.ts",
      );
      expect(inverseCandidate.status, inverseCandidate.stderr).toBe(0);

      const pathShapes = runComplexityCli(
        repository,
        "--base",
        `${mergeCandidate}^1`,
        "--head",
        mergeCandidate,
        "--",
        "added.ts",
        "delete.ts",
        "rename.ts",
        "moved.ts",
      );
      expect(pathShapes.status, pathShapes.stderr).toBe(0);
      for (const changedPath of ["added.ts", "delete.ts", "moved.ts"]) {
        expect(pathShapes.stdout).toContain(changedPath);
      }

      await writeFile(
        path.join(repository, "added.ts"),
        functionWithBranches("trackedWorkingChange", 20),
      );
      await writeFile(
        path.join(repository, "untracked.ts"),
        functionWithBranches("untrackedWorkingChange", 20),
      );
      const workingTree = runComplexityCli(repository);
      expect(workingTree.status, workingTree.stderr).toBe(1);
      expect(workingTree.stdout).toContain("added.ts");
      expect(workingTree.stdout).toContain("untracked.ts");

      const immutableCandidate = runComplexityCli(
        repository,
        "--base",
        `${mergeCandidate}^1`,
        "--head",
        mergeCandidate,
        "--",
        "source.ts",
      );
      expect(immutableCandidate.status, immutableCandidate.stderr).toBe(1);
      expect(immutableCandidate.stdout).toContain("debt 0 -> 1");
    } finally {
      await rm(repository, { force: true, recursive: true });
    }
  });
});
