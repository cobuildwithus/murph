import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("member ChatGPT retirement", () => {
  it("exposes no member ChatGPT auth routes", async () => {
    const apiRoot = fileURLToPath(new URL("../app/api/", import.meta.url));
    const authRoutes = (await readdir(apiRoot, { recursive: true }))
      .filter((entry) => path.basename(entry) === "route.ts"
        && entry.split(path.sep).includes("codex-auth"))
      .map((entry) => entry.split(path.sep).join("/"));
    expect(authRoutes).toEqual([]);
  });
});
