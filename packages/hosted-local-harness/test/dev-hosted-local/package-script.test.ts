import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { hostedLocalHarnessRepoRoot as repoRoot } from "../../src/repo.ts";

describe("root hosted local dev package script", () => {
  it("routes root dev through the canonical hosted-local harness", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(repoRoot, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["hosted-local"]).toBe(
      "pnpm exec tsx --tsconfig tsconfig.base.json scripts/hosted-local.ts",
    );
    expect(packageJson.scripts?.dev).toBe(
      "pnpm hosted-local up",
    );
    expect(packageJson.scripts?.["dev:worktree"]).toBe(
      "pnpm hosted-local worktree up",
    );
    expect(packageJson.scripts?.["dev:reset"]).toBe(
      "MURPH_DEV_FORCE_RESET_LOCAL_DB=1 MURPH_DEV_FORCE_RESET_TEMPORAL=1 MURPH_DEV_TEMPORAL=managed pnpm hosted-local up",
    );
  });
});
