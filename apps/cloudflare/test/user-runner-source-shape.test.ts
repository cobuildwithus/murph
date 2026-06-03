import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("hosted user-runner source shape", () => {
  it("does not contain a line-comment spillover in the R2 cleanup path", async () => {
    const sources = await Promise.all([
      "../src/user-runner/user-data-deletion.ts",
      "../src/user-runner/r2-delete.ts",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

    expect(sources.join("\n")).not.toContain(
      "\nCloudflare // deletes only the user-scoped runtime blobs that it stores in R2.",
    );
  });

  it("does not broad-export internal runner storage helper types", async () => {
    const source = await readFile(
      new URL("../src/user-runner/index.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain('export * from "./types.js";');
  });
});
