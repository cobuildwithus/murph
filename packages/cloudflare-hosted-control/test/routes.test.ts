import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS,
  buildCloudflareHostedControlBrowserVaultSessionPath,
  buildCloudflareHostedControlRuntimeEnsureProcessingPath,
  buildCloudflareHostedControlRuntimePrewarmPath,
  buildCloudflareHostedControlUserDataDeletionPath,
  buildCloudflareHostedControlUserStatusPath,
  matchCloudflareHostedControlUserRoutePath,
} from "../src/routes.ts";

describe("cloudflare hosted control routes", () => {
  it("builds the narrowed internal routes with encoded identifiers", () => {
    expect(buildCloudflareHostedControlBrowserVaultSessionPath("user/a b")).toBe(
      "/internal/users/user%2Fa%20b/browser-vault/session",
    );
    expect(buildCloudflareHostedControlUserStatusPath("user/a b")).toBe(
      "/internal/users/user%2Fa%20b/status",
    );
    expect(buildCloudflareHostedControlRuntimeEnsureProcessingPath("user/a b")).toBe(
      "/internal/users/user%2Fa%20b/runtime/ensure-processing",
    );
    expect(buildCloudflareHostedControlRuntimePrewarmPath("user/a b")).toBe(
      "/internal/users/user%2Fa%20b/runtime/prewarm",
    );
    expect(buildCloudflareHostedControlUserDataDeletionPath("user/a b")).toBe(
      "/internal/users/user%2Fa%20b/account-data/delete",
    );
  });

  it("rejects blank user identifiers before building routes", () => {
    for (const buildPath of [
      buildCloudflareHostedControlBrowserVaultSessionPath,
      buildCloudflareHostedControlUserDataDeletionPath,
      buildCloudflareHostedControlRuntimeEnsureProcessingPath,
      buildCloudflareHostedControlRuntimePrewarmPath,
      buildCloudflareHostedControlUserStatusPath,
    ]) {
      expect(() => buildPath("  \t")).toThrow("Cloudflare hosted control userId must not be blank.");
    }
  });

  it("feeds every exported builder output into the shared worker matcher shape", () => {
    const userId = "user/a b";
    const encodedUserId = "user%2Fa%20b";

    expect(
      matchCloudflareHostedControlUserRoutePath(
        "browserVaultSession",
        buildCloudflareHostedControlBrowserVaultSessionPath(userId),
      ),
    ).toEqual({ userId: encodedUserId });
    expect(
      matchCloudflareHostedControlUserRoutePath(
        "runtimeEnsureProcessing",
        buildCloudflareHostedControlRuntimeEnsureProcessingPath(userId),
      ),
    ).toEqual({ userId: encodedUserId });
    expect(
      matchCloudflareHostedControlUserRoutePath(
        "runtimePrewarm",
        buildCloudflareHostedControlRuntimePrewarmPath(userId),
      ),
    ).toEqual({ userId: encodedUserId });
    expect(
      matchCloudflareHostedControlUserRoutePath(
        "userDataDelete",
        buildCloudflareHostedControlUserDataDeletionPath(userId),
      ),
    ).toEqual({ userId: encodedUserId });
    expect(
      matchCloudflareHostedControlUserRoutePath(
        "status",
        buildCloudflareHostedControlUserStatusPath(userId),
      ),
    ).toEqual({ userId: encodedUserId });
    expect(
      matchCloudflareHostedControlUserRoutePath("status", "/internal/users/user_123/run"),
    ).toBeNull();
    expect(
      matchCloudflareHostedControlUserRoutePath("status", "/internal/users//status"),
    ).toBeNull();
    expect(CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS).toEqual({
      browserVaultSession: { method: "POST", suffix: "browser-vault/session" },
      runtimeEnsureProcessing: { method: "POST", suffix: "runtime/ensure-processing" },
      runtimePrewarm: { method: "POST", suffix: "runtime/prewarm" },
      status: { method: "GET", suffix: "status" },
      userDataDelete: { method: "POST", suffix: "account-data/delete" },
    });
    expect(Object.values(CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS)).not.toContainEqual(
      expect.objectContaining({ suffix: "run" }),
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
      main?: string;
      types?: string;
    };

    expect(Object.keys(packageJson.exports ?? {}).sort()).toEqual([
      "./client",
      "./routes",
    ]);
    expect(packageJson).not.toHaveProperty("main");
    expect(packageJson).not.toHaveProperty("types");
    await expect(access(new URL("../src/index.ts", import.meta.url))).rejects.toThrow();
  });

  it("rejects removed subpaths while keeping the surviving ones importable", async () => {
    const importBySpecifier = new Function(
      "specifier",
      "return import(specifier);",
    ) as (specifier: string) => Promise<unknown>;
    const routesModule = await import("@murphai/cloudflare-hosted-control/routes");

    await expect(
      importBySpecifier(["@murphai", "cloudflare-hosted-control"].join("/")),
    ).rejects.toThrow();
    await expect(import("@murphai/cloudflare-hosted-control/client")).resolves.toMatchObject({
      createCloudflareHostedControlClient: expect.any(Function),
    });
    expect(Object.keys(routesModule).sort()).toEqual([
      "CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE",
      "CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS",
      "buildCloudflareHostedControlBrowserVaultSessionPath",
      "buildCloudflareHostedControlRuntimeEnsureProcessingPath",
      "buildCloudflareHostedControlRuntimePrewarmPath",
      "buildCloudflareHostedControlUserDataDeletionPath",
      "buildCloudflareHostedControlUserStatusPath",
      "matchCloudflareHostedControlUserRoutePath",
    ]);
    expect(routesModule).toMatchObject({
      buildCloudflareHostedControlBrowserVaultSessionPath: expect.any(Function),
      buildCloudflareHostedControlUserDataDeletionPath: expect.any(Function),
      buildCloudflareHostedControlUserStatusPath: expect.any(Function),
      matchCloudflareHostedControlUserRoutePath: expect.any(Function),
    });
    await expect(importBySpecifier("@murphai/cloudflare-hosted-control/contracts")).rejects.toThrow();
    await expect(importBySpecifier("@murphai/cloudflare-hosted-control/parsers")).rejects.toThrow();
  });
});
