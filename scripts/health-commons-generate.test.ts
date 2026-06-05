import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("Health Commons generated artifact setup", () => {
  it("runs without the global workspace-artifact lock", () => {
    const rootPackageJson = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const ensureHealthCommonsGenerated = readFileSync(
      path.join(repoRoot, "scripts", "ensure-health-commons-generated.mjs"),
      "utf8",
    );

    expect(rootPackageJson.scripts?.["health-commons:generate"]).toBe(
      "node scripts/ensure-health-commons-generated.mjs",
    );
    expect(ensureHealthCommonsGenerated).toContain('"@murphai/health-commons"');
    expect(ensureHealthCommonsGenerated).toContain('"generate"');
    expect(ensureHealthCommonsGenerated).not.toContain(
      "run-with-workspace-artifact-lock.mjs",
    );
  });
});
