import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");

function runPackageScript(
  scriptName: string,
  outDir: string,
  name: string,
  options: { args?: string[]; env?: Record<string, string> } = {},
) {
  const scriptPath = path.join(repoRoot, "scripts", scriptName);
  const result = spawnSync(
    "bash",
    [scriptPath, "--zip", "--out-dir", outDir, "--name", name, ...(options.args ?? [])],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ...options.env,
      },
    },
  );

  expect(result.status, result.stderr || result.stdout).toBe(0);
  expect(result.stderr).not.toContain("Warning: excluding path from audit package:");

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
    const protocolConfig = readFileSync(
      path.join(repoRoot, "scripts", "review-gpt-protocol.config.sh"),
      "utf8",
    );
    const protocolTargetConfig = readFileSync(
      path.join(repoRoot, "scripts", "review-gpt-protocol-target.config.sh"),
      "utf8",
    );
    const packageJson = readFileSync(path.join(repoRoot, "package.json"), "utf8");
    const packageScript = readFileSync(path.join(repoRoot, "scripts", "package-audit-context.sh"), "utf8");
    const protocolWrapper = readFileSync(path.join(repoRoot, "scripts", "review-gpt-protocol.sh"), "utf8");

    expect(config).toContain('package_script="scripts/package-review-gpt-context.sh"');
    expect(fullConfig).toContain('package_script="scripts/package-review-gpt-context-full.sh"');
    expect(protocolConfig).toContain('package_script="scripts/package-review-gpt-protocol-context.sh"');
    expect(protocolTargetConfig).toContain(
      'package_script="scripts/package-review-gpt-protocol-target-context.sh"',
    );
    expect(packageScript).not.toContain("packages/health-commons/content/**");
    expect(packageJson).toContain('"review:gpt:protocol": "bash scripts/review-gpt-protocol.sh"');
    expect(packageJson).toContain('"review:gpt:protocol:all"');
    expect(packageJson).not.toContain("review:gpt:protocol:finnish-sauna");
    expect(protocolWrapper).toContain("resolve_protocol_slug");
    expect(config).toContain('"output-packages/**"');
    expect(config).toContain('"packages/health-commons/content/**"');
    expect(config).toContain('"packages/health-commons/generated/**"');
    expect(protocolConfig).toContain('"packages/health-commons/content/**"');
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

  it("includes broad authored Health Commons content in the legacy protocol review-gpt ZIP", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "murph-review-gpt-protocol-context-"));

    try {
      const zipPath = runPackageScript(
        "package-review-gpt-protocol-context.sh",
        tempRoot,
        "protocol-review-gpt-context",
      );
      const entries = listZipEntries(zipPath);

      expect(entries.some((entry) => entry.startsWith("output-packages/"))).toBe(false);
      expect(entries).toContain("packages/health-commons/content/protocols/norwegian-4x4/norwegian-4x4.md");
      expect(entries).toContain("packages/health-commons/content/artifacts/norwegian-4x4/research-artifacts.json");
      expect(entries).not.toContain("packages/health-commons/generated/catalog.json");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("packages a focused protocol review-gpt ZIP from a short Health Commons slug", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "murph-review-gpt-protocol-target-context-"));

    try {
      const zipPath = runPackageScript(
        "package-review-gpt-protocol-target-context.sh",
        tempRoot,
        "protocol-target-review-gpt-context",
        { args: ["--protocol-slug", "finnish-sauna"] },
      );
      const entries = listZipEntries(zipPath);

      expect(entries).toContain("REVIEW_CONTEXT.md");
      expect(entries).toContain(
        "packages/health-commons/content/protocols/dry-sauna/murph-finnish-standard-3x-week.md",
      );
      expect(entries).toContain("packages/health-commons/content/sources/dry-sauna/pmid-29849692.md");
      expect(entries).toContain(
        "packages/health-commons/content/evidence-appraisals/source-protocol-evidence/dry-sauna.jsonl",
      );
      expect(entries).toContain("packages/health-commons/content/biomarkers/resting-heart-rate.md");
      expect(entries).not.toContain("packages/health-commons/generated/catalog.json");
      expect(entries.some((entry) => entry.startsWith("packages/health-commons/content/sources/norwegian-4x4/"))).toBe(
        false,
      );
      expect(entries.some((entry) => entry.startsWith("agent-docs/exec-plans/active/"))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
