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
  type ComplexityDiffReport,
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

describe("cyclomatic complexity exact function moves", () => {
  const moved = functionWithBranches("moved", 24);
  const retained = "export const retained = true;";
  const nested = `function outer(value) { ${moved} return moved(value); }`;
  const typedMoved = moved
    .replace("function moved(value)", "async function moved(value: number): Promise<unknown>")
    .replace("return value;", "return consume({ value, }, [value,],);");
  const parenthesizedMoved = moved.replace("return value;", "return (value + 1);");
  const concentrated = `${functionWithBranches("first", 24)}${functionWithBranches("second", 24)}`;
  const concentratedHead = `${functionWithBranches("first", 29)}${functionWithBranches("second", 19)}`;
  const cases: {
    name: string;
    before: Record<string, string>;
    after: Record<string, string>;
    passed: boolean;
    movedIn: number;
  }[] = [
    {
      name: "accepts an exact extraction with comments and export changes",
      before: { "source.ts": `${moved}${retained}` },
      after: {
        "source.ts": `import { moved } from './owner.js'; ${retained}`,
        "owner.ts": `// New module ownership.\nexport ${moved.trim().replace("return value;", "/* preserved */ return value;")}`,
      },
      passed: true,
      movedIn: 1,
    },
    {
      name: "rejects a copy from an unchanged source file",
      before: { "source.ts": moved },
      after: { "source.ts": moved, "owner.ts": moved },
      passed: false,
      movedIn: 0,
    },
    {
      name: "reserves the donor when its file changes but the function stays",
      before: { "source.ts": moved },
      after: { "source.ts": `${moved}${retained}`, "owner.ts": moved },
      passed: false,
      movedIn: 0,
    },
    {
      name: "consumes one removed occurrence only once across two destinations",
      before: { "source.ts": `${moved}${retained}` },
      after: { "source.ts": retained, "first.ts": moved, "second.ts": moved },
      passed: false,
      movedIn: 1,
    },
    {
      name: "does not match a moved function with greater complexity",
      before: { "source.ts": `${moved}${retained}` },
      after: { "source.ts": retained, "owner.ts": functionWithBranches("moved", 25) },
      passed: false,
      movedIn: 0,
    },
    {
      name: "does not match changed bodies even with equal complexity",
      before: { "source.ts": `${moved}${retained}` },
      after: { "source.ts": retained, "owner.ts": moved.replace("return value;", "return -value;") },
      passed: false,
      movedIn: 0,
    },
    {
      name: "does not match renamed functions",
      before: { "source.ts": `${moved}${retained}` },
      after: { "source.ts": retained, "owner.ts": moved.replace("function moved", "function renamed") },
      passed: false,
      movedIn: 0,
    },
    {
      name: "preserves independent nested frames when their outer function moves",
      before: { "source.ts": `${nested}${retained}` },
      after: { "source.ts": retained, "owner.ts": nested },
      passed: true,
      movedIn: 2,
    },
    {
      name: "rejects a copied nested function when its donor remains inside an edited wrapper",
      before: { "source.ts": nested },
      after: { "source.ts": nested.replace("return moved(value);", "return moved(value) + 1;"), "owner.ts": moved },
      passed: false,
      movedIn: 0,
    },
    {
      name: "does not offset growth against an unrelated deletion",
      before: { "source.ts": moved, "other.ts": functionWithBranches("other", 20) },
      after: { "source.ts": retained, "other.ts": functionWithBranches("other", 21) },
      passed: false,
      movedIn: 0,
    },
    {
      name: "preserves maximum protection in a donor after its largest function moves",
      before: { "source.ts": `${functionWithBranches("largest", 40)}${concentrated}` },
      after: { "source.ts": concentratedHead, "owner.ts": functionWithBranches("largest", 40) },
      passed: false,
      movedIn: 1,
    },
    {
      name: "preserves maximum protection in a destination receiving a larger function",
      before: { "source.ts": `${functionWithBranches("largest", 40)}${retained}`, "owner.ts": concentrated },
      after: { "source.ts": retained, "owner.ts": `${functionWithBranches("largest", 40)}${concentratedHead}` },
      passed: false,
      movedIn: 1,
    },
    {
      name: "matches async typed functions with trailing comma source positions",
      before: { "source.ts": `${retained}\n${typedMoved}` },
      after: { "source.ts": retained, "owner.ts": `export ${typedMoved.trim()}` },
      passed: true,
      movedIn: 1,
    },
    {
      name: "matches parenthesized expressions after source positions change",
      before: { "source.ts": `${retained}\n${parenthesizedMoved}` },
      after: { "source.ts": retained, "owner.ts": parenthesizedMoved },
      passed: true,
      movedIn: 1,
    },
  ];

  for (const { name, before, after, passed, movedIn } of cases) {
    it(name, async () => {
      const repository = await mkdtemp(path.join(tmpdir(), "complexity-moves-"));
      try {
        runFixtureGit(repository, "init", "--initial-branch=main");
        for (const [name, source] of Object.entries(before)) {
          await writeFile(path.join(repository, name), source);
        }
        runFixtureGit(repository, "add", ".");
        runFixtureGit(repository, "commit", "-m", "baseline");
        const baseRef = runFixtureGit(repository, "rev-parse", "HEAD");
        for (const [name, source] of Object.entries(after)) {
          await writeFile(path.join(repository, name), source);
        }
        const workingTree = runComplexityCli(repository, "--base", baseRef, "--json");
        expect(workingTree.status, workingTree.stderr).toBe(passed ? 0 : 1);
        const report: ComplexityDiffReport = JSON.parse(workingTree.stdout);
        expect(report.files.reduce((sum, file) => sum + file.movedInCount, 0)).toBe(movedIn);
        expect(report.files.reduce((sum, file) => sum + file.movedOutCount, 0)).toBe(movedIn);
        // Full summaries still expose moved hotspots for the mandatory review.
        expect(report.files.some((file) => file.headSummary.maximumComplexity > 20)).toBe(true);
        runFixtureGit(repository, "add", ".");
        runFixtureGit(repository, "commit", "-m", "candidate");
        const committed = runComplexityCli(repository, "--base", baseRef, "--head", "HEAD");
        expect(committed.status, committed.stderr).toBe(passed ? 0 : 1);
        if (movedIn > 0) {
          expect(committed.stdout).toContain("exact moves:");
          expect(committed.stdout).toContain("deltas compare only unmoved functions");
        }
      } finally {
        await rm(repository, { force: true, recursive: true });
      }
    });
  }
});
