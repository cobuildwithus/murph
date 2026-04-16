import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");

describe("root hosted local dev package script", () => {
  it("launches tsx with the workspace source tsconfig for clean checkouts", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(repoRoot, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.dev).toBe(
      "pnpm exec tsx --tsconfig tsconfig.base.json scripts/dev-hosted-local.ts",
    );
  });
});
