import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("hosted web testing helper boundary", () => {
  it("does not statically import the generated Prisma client", async () => {
    const source = await readFile(
      new URL("../../web/src/testing.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(
      /import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+["']@prisma\/client["']/,
    );
  });
});
