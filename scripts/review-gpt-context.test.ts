import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");

function runPackageScript(scriptName: string, outDir: string, name: string) {
  const scriptPath = path.join(repoRoot, "scripts", scriptName);
  const result = spawnSync(
    "bash",
    [scriptPath, "--zip", "--out-dir", outDir, "--name", name],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
      },
    },
  );

  expect(result.status, result.stderr || result.stdout).toBe(0);

  const zipPath = result.stdout.match(/^ZIP: (.*) \(/m)?.[1]?.trim();
  expect(zipPath).toBeTruthy();
  expect(existsSync(zipPath!)).toBe(true);

  return zipPath!;
}

function listZipEntries(zipPath: string) {
  return execFileSync("unzip", ["-Z1", zipPath], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function expectReviewGptPrunedEntries(entries: string[]) {
  expect(entries.some((entry) => entry.startsWith("output-packages/"))).toBe(false);
  expect(entries.some((entry) => entry.startsWith("packages/health-commons/content/"))).toBe(false);
  expect(entries.some((entry) => entry.startsWith("packages/health-commons/generated/"))).toBe(false);
}

describe("review-gpt context packaging", () => {
  it("uses review-gpt-only package scripts without changing generic source zips", () => {
    const config = readFileSync(path.join(repoRoot, "scripts", "review-gpt.config.sh"), "utf8");
    const fullConfig = readFileSync(path.join(repoRoot, "scripts", "review-gpt-full.config.sh"), "utf8");
    const packageScript = readFileSync(path.join(repoRoot, "scripts", "package-audit-context.sh"), "utf8");

    expect(config).toContain('package_script="scripts/package-review-gpt-context.sh"');
    expect(fullConfig).toContain('package_script="scripts/package-review-gpt-context-full.sh"');
    expect(packageScript).not.toContain("packages/health-commons/content/**");
    expect(config).toContain('"output-packages/**"');
    expect(config).toContain('"packages/health-commons/content/**"');
    expect(config).toContain('"packages/health-commons/generated/**"');
  });

  it("omits output packages and Health Commons data from the normal review-gpt ZIP", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "murph-review-gpt-context-"));

    try {
      const zipPath = runPackageScript(
        "package-review-gpt-context.sh",
        tempRoot,
        "normal-review-gpt-context",
      );
      const entries = listZipEntries(zipPath);

      expectReviewGptPrunedEntries(entries);
      expect(entries).toContain("scripts/review-gpt.config.sh");
      expect(entries).toContain("packages/health-commons/src/index.ts");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps the full review-gpt ZIP broad while omitting output packages and Health Commons data", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "murph-review-gpt-context-full-"));

    try {
      const zipPath = runPackageScript(
        "package-review-gpt-context-full.sh",
        tempRoot,
        "full-review-gpt-context",
      );
      const entries = listZipEntries(zipPath);

      expectReviewGptPrunedEntries(entries);
      expect(entries).toContain("packages/query/test/overview-vault-source-coverage.test.ts");
      expect(entries).toContain(".github/workflows/host-support.yml");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
