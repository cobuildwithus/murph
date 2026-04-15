import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildCloudflareHostedControlPendingUsageUsersPath,
  buildCloudflareHostedControlSharePackPath,
  buildCloudflareHostedControlUserPendingUsagePath,
  buildCloudflareHostedControlUserRunPath,
  buildCloudflareHostedControlUserStatusPath,
} from "../src/routes.ts";

describe("cloudflare hosted control routes", () => {
  it("builds the focused internal routes with encoded identifiers", () => {
    expect(buildCloudflareHostedControlPendingUsageUsersPath()).toBe("/internal/usage/pending-users");
    expect(buildCloudflareHostedControlUserPendingUsagePath("user/a b")).toBe(
      "/internal/users/user%2Fa%20b/usage/pending",
    );
    expect(buildCloudflareHostedControlSharePackPath("user/a b", "share/1 2")).toBe(
      "/internal/users/user%2Fa%20b/shares/share%2F1%202/pack",
    );
    expect(buildCloudflareHostedControlUserRunPath("user/a b")).toBe(
      "/internal/users/user%2Fa%20b/run",
    );
    expect(buildCloudflareHostedControlUserStatusPath("user/a b")).toBe(
      "/internal/users/user%2Fa%20b/status",
    );
  });

  it("publishes focused subpath exports for callers that only need one owner surface", async () => {
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
      "./contracts",
      "./parsers",
      "./routes",
    ]);
  });

  it("rejects the package root while keeping the focused subpaths importable", async () => {
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
    await expect(import("@murphai/cloudflare-hosted-control/contracts")).resolves.toSatisfy(
      (contractsModule) => Object.keys(contractsModule as Record<string, unknown>).length === 0,
    );
    await expect(import("@murphai/cloudflare-hosted-control/parsers")).resolves.toMatchObject({
      parseCloudflareHostedManagedUserCryptoStatus: expect.any(Function),
      parseCloudflareHostedUserEnvStatus: expect.any(Function),
      parseCloudflareHostedUserEnvUpdate: expect.any(Function),
    });
    await expect(import("@murphai/cloudflare-hosted-control/routes")).resolves.toMatchObject({
      buildCloudflareHostedControlPendingUsageUsersPath: expect.any(Function),
      buildCloudflareHostedControlSharePackPath: expect.any(Function),
      buildCloudflareHostedControlUserPendingUsagePath: expect.any(Function),
      buildCloudflareHostedControlUserRunPath: expect.any(Function),
      buildCloudflareHostedControlUserStatusPath: expect.any(Function),
    });
  });
});
