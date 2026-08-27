import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

describe("repository-generated artifacts", () => {
  it("keeps the Graft code graph out of task diffs", () => {
    const ignoredPath = execFileSync(
      "git",
      ["check-ignore", "--no-index", "graft/.graph/wiring.json"],
      { cwd: repositoryRoot, encoding: "utf8" },
    ).trim();

    expect(ignoredPath).toBe("graft/.graph/wiring.json");
  });
});
