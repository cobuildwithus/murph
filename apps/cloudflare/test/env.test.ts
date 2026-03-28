import { describe, expect, it } from "vitest";

import { readHostedExecutionEnvironment } from "../src/env.js";

const REMOVED_BUNDLE_KEY_ALIAS = ["HB", "HOSTED", "BUNDLE", "KEY"].join("_");

describe("readHostedExecutionEnvironment", () => {
  it("reads required values and defaults", () => {
    const environment = readHostedExecutionEnvironment({
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64url"),
      HOSTED_EXECUTION_SIGNING_SECRET: "dispatch-secret",
    });

    expect(environment.bundleEncryptionKey).toHaveLength(32);
    expect(environment.bundleEncryptionKeyId).toBe("v1");
    expect(environment.defaultAlarmDelayMs).toBe(15 * 60 * 1000);
    expect(environment.maxEventAttempts).toBe(3);
    expect(environment.retryDelayMs).toBe(30_000);
    expect(environment.runnerTimeoutMs).toBe(60_000);
  });

  it("reads the runner timeout when configured", () => {
    const environment = readHostedExecutionEnvironment({
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
      HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: "15000",
      HOSTED_EXECUTION_SIGNING_SECRET: "dispatch-secret",
    });

    expect(environment.runnerTimeoutMs).toBe(15_000);
  });

  it("reads optional user env allowlist extensions", () => {
    const environment = readHostedExecutionEnvironment({
      HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS: "OPENAI_API_KEY,TELEGRAM_BOT_TOKEN",
      HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES: "HOSTED_USER_,CUSTOM_",
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
      HOSTED_EXECUTION_SIGNING_SECRET: "dispatch-secret",
    });

    expect(environment.allowedUserEnvKeys).toBe("OPENAI_API_KEY,TELEGRAM_BOT_TOKEN");
    expect(environment.allowedUserEnvPrefixes).toBe("HOSTED_USER_,CUSTOM_");
  });

  it("does not accept the removed bundle-key alias", () => {
    expect(() =>
      readHostedExecutionEnvironment({
        [REMOVED_BUNDLE_KEY_ALIAS]: Buffer.alloc(32, 9).toString("base64"),
        HOSTED_EXECUTION_SIGNING_SECRET: "dispatch-secret",
      } as Record<string, string>),
    ).toThrow(/HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY/u);
  });

  it("does not accept the removed Cloudflare signing-secret alias", () => {
    expect(() =>
      readHostedExecutionEnvironment({
        HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
        HOSTED_EXECUTION_CLOUDFLARE_SIGNING_SECRET: "dispatch-secret",
      } as Record<string, string>),
    ).toThrow(/HOSTED_EXECUTION_SIGNING_SECRET/u);
  });
});
