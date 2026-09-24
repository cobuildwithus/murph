import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("repository Vault CLI development entrypoint", () => {
  it("uses root source aliases and owns the chat shortcut", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["vault-cli"]).toBe(
      "tsx --tsconfig tsconfig.base.json packages/cli/src/bin.ts",
    );
    expect(packageJson.scripts?.chat).toBe("pnpm vault-cli assistant chat");
  });
});
