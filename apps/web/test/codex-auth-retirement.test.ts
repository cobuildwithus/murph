import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/prisma", () => ({ getPrisma: vi.fn() }));

import * as codexAuthStore from "@/src/lib/codex-auth/store";

describe("member ChatGPT retirement", () => {
  it("retains only the existing-attempt callback consumer export", () => {
    expect(Object.keys(codexAuthStore)).toEqual(["applyHostedCodexAuthUpdate"]);
  });

  it("exposes the retained auth consumer only as an internal route", async () => {
    const apiRoot = fileURLToPath(new URL("../app/api/", import.meta.url));
    const authRoutes = (await readdir(apiRoot, { recursive: true }))
      .filter((entry) => path.basename(entry) === "route.ts"
        && entry.split(path.sep).includes("codex-auth"))
      .map((entry) => entry.split(path.sep).join("/"));
    expect(authRoutes).toEqual(["internal/hosted-runtime/codex-auth/route.ts"]);
  });
});
