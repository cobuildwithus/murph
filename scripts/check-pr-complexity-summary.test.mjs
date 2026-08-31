import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isCyclomaticSourcePath,
  validatePrComplexitySummary,
} from "./check-pr-complexity-summary.mjs";
import { readChangedPaths } from "./pr-body-markdown.mjs";

function section(...items) {
  return `
<h2>Complexity impact</h2>
<ul>
${items.map((item) => `<li>${item}</li>`).join("\n")}
</ul>
`;
}

const completeItems = [
  "Guard: pass — pnpm complexity:diff reported no debt or maximum regression.",
  "Hotspots: One existing function remains above 20 and is unchanged by this patch.",
  "Agent judgment: Further extraction would split one cohesive policy owner without reducing current risk.",
];

test("accepts a completed complexity judgment for authored source", () => {
  assert.deepEqual(
    validatePrComplexitySummary({
      changedPaths: ["packages/core/src/value.ts"],
      prBodyHtml: section(...completeItems),
    }),
    [],
  );
});

test("accepts a concrete not-applicable disposition without authored source", () => {
  assert.deepEqual(
    validatePrComplexitySummary({
      changedPaths: ["agent-docs/operations/example.md"],
      prBodyHtml: section(
        "Guard: not applicable — this documentation-only change has no executable source.",
        "Hotspots: No JavaScript or TypeScript source is changed by this pull request.",
        "Agent judgment: Complexity analysis cannot improve a documentation-only patch.",
      ),
    }),
    [],
  );
});

test("requires the section and every structured field", () => {
  assert.deepEqual(
    validatePrComplexitySummary({ changedPaths: [], prBodyHtml: "<h2>Summary</h2>" }),
    ["Add a `## Complexity impact` section to the pull request body."],
  );
  assert.deepEqual(
    validatePrComplexitySummary({
      changedPaths: [],
      prBodyHtml: section("Guard: not applicable — documentation only."),
    }),
    [
      "Add exactly one `Hotspots:` bullet.",
      "Add exactly one `Agent judgment:` bullet.",
    ],
  );
});

test("rejects skipped or unnamed guards for authored source", () => {
  assert.deepEqual(
    validatePrComplexitySummary({
      changedPaths: ["apps/web/src/component.tsx"],
      prBodyHtml: section(
        "Guard: not applicable — the command was not executed for this source patch.",
        "Hotspots: No hotspot assessment was recorded beyond this placeholder sentence.",
        "Agent judgment: The source shape was not assessed for possible simplification.",
      ),
    }),
    [
      "Set `Guard:` to `pass` for authored JavaScript or TypeScript changes.",
      "Name `pnpm complexity:diff` in `Guard:` for authored JavaScript or TypeScript changes.",
    ],
  );
});

test("uses the same authored-source boundary as the analyzer", () => {
  assert.equal(isCyclomaticSourcePath("scripts/tool.mjs"), true);
  assert.equal(isCyclomaticSourcePath("packages/core/src/value.ts"), true);
  assert.equal(isCyclomaticSourcePath("packages/core/src/contest.ts"), true);
  assert.equal(isCyclomaticSourcePath("packages/core/test/value.test.ts"), false);
  assert.equal(isCyclomaticSourcePath("apps/web/e2e/value.ts"), false);
  assert.equal(isCyclomaticSourcePath("packages/core/src/value.generated.ts"), false);
  assert.equal(isCyclomaticSourcePath("packages/core/src/value.d.ts"), false);
});

test("keeps the authored side of a source-to-document rename", async () => {
  const repository = await mkdtemp(path.join(tmpdir(), "complexity-pr-paths-"));
  const runGit = (...args) => {
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
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };

  try {
    runGit("init", "--initial-branch=main");
    await writeFile(path.join(repository, "source.ts"), "export const value = 1;\n");
    runGit("add", "source.ts");
    runGit("commit", "-m", "add source");
    const baseSha = runGit("rev-parse", "HEAD");

    await rename(
      path.join(repository, "source.ts"),
      path.join(repository, "README.md"),
    );
    runGit("add", "--all");
    runGit("commit", "-m", "rename source");
    const headSha = runGit("rev-parse", "HEAD");

    const changedPaths = readChangedPaths(baseSha, headSha, {
      cwd: repository,
      detectRenames: false,
    });
    assert.deepEqual(changedPaths.sort(), ["README.md", "source.ts"]);
    assert.equal(changedPaths.some(isCyclomaticSourcePath), true);
  } finally {
    await rm(repository, { force: true, recursive: true });
  }
});
