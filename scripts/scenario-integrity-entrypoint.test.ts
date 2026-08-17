import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("scenario-integrity entrypoint", () => {
  it("keeps the ordinary root command coverage-bearing", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["test:scenario-integrity"]).toBe(
      "tsx e2e/smoke/verify-scenario-integrity.ts --coverage",
    );
  });

  it("routes release fixture coverage through the ordinary root command", async () => {
    const workflow = await readFile(
      path.join(repoRoot, ".github", "workflows", "host-support.yml"),
      "utf8",
    );

    expect(workflow).toContain("run: pnpm test:scenario-integrity");
    expect(workflow).not.toContain(
      "run: pnpm exec tsx e2e/smoke/verify-scenario-integrity.ts --coverage",
    );
  });
});
