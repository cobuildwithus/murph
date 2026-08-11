import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS,
  buildCloudflareHostedControlBrowserVaultSessionPath,
  buildCloudflareHostedControlEnvironmentVoiceDeletePath,
  buildCloudflareHostedControlEnvironmentVoiceStagePath,
  buildCloudflareHostedControlMealPhotoDeletePath,
  buildCloudflareHostedControlMealPhotoStagePath,
  buildCloudflareHostedControlRuntimeEnsureProcessingPath,
  buildCloudflareHostedControlRuntimeHealthDataConsentPath,
  buildCloudflareHostedControlRuntimeShellPrewarmPath,
  buildCloudflareHostedControlTelegramUsageLimitNoticePath,
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
    expect(buildCloudflareHostedControlRuntimeHealthDataConsentPath("user/a b")).toBe(
      "/internal/users/user%2Fa%20b/runtime/health-data-consent",
    );
    expect(buildCloudflareHostedControlRuntimeShellPrewarmPath("user/a b")).toBe(
      "/internal/users/user%2Fa%20b/runtime/shell-prewarm",
    );
    expect(buildCloudflareHostedControlTelegramUsageLimitNoticePath("user/a b")).toBe(
      "/internal/users/user%2Fa%20b/telegram/usage-limit-notice",
    );
    expect(buildCloudflareHostedControlUserDataDeletionPath("user/a b")).toBe(
      "/internal/users/user%2Fa%20b/account-data/delete",
    );
    expect(buildCloudflareHostedControlMealPhotoStagePath("user/a b")).toBe(
      "/internal/users/user%2Fa%20b/meal-photos/stage",
    );
    expect(buildCloudflareHostedControlMealPhotoDeletePath("user/a b")).toBe(
      "/internal/users/user%2Fa%20b/meal-photos/delete",
    );
    expect(buildCloudflareHostedControlEnvironmentVoiceStagePath("user/a b")).toBe(
      "/internal/users/user%2Fa%20b/environment-voice/stage",
    );
    expect(buildCloudflareHostedControlEnvironmentVoiceDeletePath("user/a b")).toBe(
      "/internal/users/user%2Fa%20b/environment-voice/delete",
    );
  });

  it("rejects blank user identifiers before building routes", () => {
    for (const buildPath of [
      buildCloudflareHostedControlBrowserVaultSessionPath,
      buildCloudflareHostedControlEnvironmentVoiceDeletePath,
      buildCloudflareHostedControlEnvironmentVoiceStagePath,
      buildCloudflareHostedControlMealPhotoDeletePath,
      buildCloudflareHostedControlMealPhotoStagePath,
      buildCloudflareHostedControlUserDataDeletionPath,
      buildCloudflareHostedControlRuntimeEnsureProcessingPath,
      buildCloudflareHostedControlRuntimeHealthDataConsentPath,
      buildCloudflareHostedControlRuntimeShellPrewarmPath,
      buildCloudflareHostedControlTelegramUsageLimitNoticePath,
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
        "environmentVoiceDelete",
        buildCloudflareHostedControlEnvironmentVoiceDeletePath(userId),
      ),
    ).toEqual({ userId: encodedUserId });
    expect(
      matchCloudflareHostedControlUserRoutePath(
        "environmentVoiceStage",
        buildCloudflareHostedControlEnvironmentVoiceStagePath(userId),
      ),
    ).toEqual({ userId: encodedUserId });
    expect(
      matchCloudflareHostedControlUserRoutePath(
        "mealPhotoDelete",
        buildCloudflareHostedControlMealPhotoDeletePath(userId),
      ),
    ).toEqual({ userId: encodedUserId });
    expect(
      matchCloudflareHostedControlUserRoutePath(
        "mealPhotoStage",
        buildCloudflareHostedControlMealPhotoStagePath(userId),
      ),
    ).toEqual({ userId: encodedUserId });
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
        "runtimeHealthDataConsentReconcile",
        buildCloudflareHostedControlRuntimeHealthDataConsentPath(userId),
      ),
    ).toEqual({ userId: encodedUserId });
    expect(
      matchCloudflareHostedControlUserRoutePath(
        "runtimeShellPrewarm",
        buildCloudflareHostedControlRuntimeShellPrewarmPath(userId),
      ),
    ).toEqual({ userId: encodedUserId });
    expect(
      matchCloudflareHostedControlUserRoutePath(
        "telegramUsageLimitNotice",
        buildCloudflareHostedControlTelegramUsageLimitNoticePath(userId),
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
      environmentVoiceDelete: { method: "DELETE", suffix: "environment-voice/delete" },
      environmentVoiceStage: { method: "POST", suffix: "environment-voice/stage" },
      inferenceVerification: { method: "POST", suffix: "inference/verify" },
      mealPhotoDelete: { method: "DELETE", suffix: "meal-photos/delete" },
      mealPhotoStage: { method: "POST", suffix: "meal-photos/stage" },
      runtimeEnsureProcessing: { method: "POST", suffix: "runtime/ensure-processing" },
      runtimeShellPrewarm: { method: "POST", suffix: "runtime/shell-prewarm" },
      runtimeHealthDataConsentReconcile: {
        method: "POST",
        suffix: "runtime/health-data-consent",
      },
      status: { method: "GET", suffix: "status" },
      telegramUsageLimitNotice: { method: "POST", suffix: "telegram/usage-limit-notice" },
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
      "./inference-verification",
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
      "CLOUDFLARE_HOSTED_CONTROL_ENVIRONMENT_VOICE_CAPTURE_ID_HEADER",
      "CLOUDFLARE_HOSTED_CONTROL_ENVIRONMENT_VOICE_KEY_HEADER",
      "CLOUDFLARE_HOSTED_CONTROL_ENVIRONMENT_VOICE_SHA256_HEADER",
      "CLOUDFLARE_HOSTED_CONTROL_MEAL_PHOTO_CAPTURE_ID_HEADER",
      "CLOUDFLARE_HOSTED_CONTROL_MEAL_PHOTO_KEY_HEADER",
      "CLOUDFLARE_HOSTED_CONTROL_MEAL_PHOTO_SHA256_HEADER",
      "CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS",
      "buildCloudflareHostedControlBrowserVaultSessionPath",
      "buildCloudflareHostedControlEnvironmentVoiceDeletePath",
      "buildCloudflareHostedControlEnvironmentVoiceStagePath",
      "buildCloudflareHostedControlInferenceVerificationPath",
      "buildCloudflareHostedControlMealPhotoDeletePath",
      "buildCloudflareHostedControlMealPhotoStagePath",
      "buildCloudflareHostedControlRuntimeEnsureProcessingPath",
      "buildCloudflareHostedControlRuntimeHealthDataConsentPath",
      "buildCloudflareHostedControlRuntimeShellPrewarmPath",
      "buildCloudflareHostedControlTelegramUsageLimitNoticePath",
      "buildCloudflareHostedControlUserDataDeletionPath",
      "buildCloudflareHostedControlUserStatusPath",
      "matchCloudflareHostedControlUserRoutePath",
    ]);
    expect(routesModule).toMatchObject({
      buildCloudflareHostedControlBrowserVaultSessionPath: expect.any(Function),
      buildCloudflareHostedControlEnvironmentVoiceDeletePath: expect.any(Function),
      buildCloudflareHostedControlEnvironmentVoiceStagePath: expect.any(Function),
      buildCloudflareHostedControlInferenceVerificationPath: expect.any(Function),
      buildCloudflareHostedControlMealPhotoDeletePath: expect.any(Function),
      buildCloudflareHostedControlMealPhotoStagePath: expect.any(Function),
      buildCloudflareHostedControlRuntimeHealthDataConsentPath: expect.any(Function),
      buildCloudflareHostedControlTelegramUsageLimitNoticePath: expect.any(Function),
      buildCloudflareHostedControlUserDataDeletionPath: expect.any(Function),
      buildCloudflareHostedControlUserStatusPath: expect.any(Function),
      matchCloudflareHostedControlUserRoutePath: expect.any(Function),
    });
    await expect(importBySpecifier("@murphai/cloudflare-hosted-control/contracts")).rejects.toThrow();
    await expect(importBySpecifier("@murphai/cloudflare-hosted-control/parsers")).rejects.toThrow();
  });
});
