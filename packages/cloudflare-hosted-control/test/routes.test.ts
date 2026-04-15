import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildCloudflareHostedControlUserEventStatusPath,
  buildCloudflareHostedControlUserRunPath,
  buildCloudflareHostedControlUserStatusPath,
} from "../src/routes.ts";

describe("cloudflare hosted control routes", () => {
  it("builds the narrowed internal routes with encoded identifiers", () => {
    expect(buildCloudflareHostedControlUserEventStatusPath("user/a b", "evt/1 2")).toBe(
      "/internal/users/user%2Fa%20b/events/evt%2F1%202/status",
    );
    expect(buildCloudflareHostedControlUserRunPath("user/a b")).toBe(
      "/internal/users/user%2Fa%20b/run",
    );
    expect(buildCloudflareHostedControlUserStatusPath("user/a b")).toBe(
      "/internal/users/user%2Fa%20b/status",
    );
  });

  it("publishes only the surviving focused subpath exports", async () => {
    const packageJsonPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      exports?: Record<string, unknown>;
    };

    expect(Object.keys(packageJson.exports ?? {}).sort()).toEqual([
      "./client",
      "./routes",
    ]);
  });

  it("rejects removed subpaths while keeping the surviving ones importable", async () => {
    const importBySpecifier = new Function(
      "specifier",
      "return import(specifier);",
    ) as (specifier: string) => Promise<unknown>;

    await expect(
      importBySpecifier(["@murphai", "cloudflare-hosted-control"].join("/")),
    ).rejects.toThrow();
    await expect(import("@murphai/cloudflare-hosted-control/client")).resolves.toMatchObject({
      createCloudflareHostedControlClient: expect.any(Function),
    });
    await expect(import("@murphai/cloudflare-hosted-control/routes")).resolves.toMatchObject({
      buildCloudflareHostedControlUserEventStatusPath: expect.any(Function),
      buildCloudflareHostedControlUserRunPath: expect.any(Function),
      buildCloudflareHostedControlUserStatusPath: expect.any(Function),
    });
    await expect(importBySpecifier("@murphai/cloudflare-hosted-control/contracts")).rejects.toThrow();
    await expect(importBySpecifier("@murphai/cloudflare-hosted-control/parsers")).rejects.toThrow();
  });
});
