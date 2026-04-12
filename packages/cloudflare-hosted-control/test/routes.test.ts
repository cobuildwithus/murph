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

    expect(packageJson.exports).toMatchObject({
      "./client": expect.any(Object),
      "./contracts": expect.any(Object),
      "./parsers": expect.any(Object),
      "./routes": expect.any(Object),
    });
  });
});
