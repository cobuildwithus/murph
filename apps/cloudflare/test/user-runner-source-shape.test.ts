import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("hosted user-runner source shape", () => {
  it("does not contain a line-comment spillover in the R2 cleanup path", async () => {
    const source = await readFile(
      new URL("../src/user-runner/user-data-deletion.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain(
      "\nCloudflare // deletes only the user-scoped runtime blobs that it stores in R2.",
    );
  });
});
