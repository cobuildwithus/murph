import { describe, expect, it } from "vitest";

import { readHostedExecutionEnvironment } from "../src/env.js";

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
  });

  it("normalizes the runner base url", () => {
    const environment = readHostedExecutionEnvironment({
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
      HOSTED_EXECUTION_RUNNER_BASE_URL: "https://runner.example.test/",
      HOSTED_EXECUTION_SIGNING_SECRET: "dispatch-secret",
    });

    expect(environment.runnerBaseUrl).toBe("https://runner.example.test");
  });

  it("accepts the recovered handoff env aliases", () => {
    const environment = readHostedExecutionEnvironment({
      HB_HOSTED_BUNDLE_KEY: Buffer.alloc(32, 9).toString("base64"),
      HOSTED_EXECUTION_CLOUDFLARE_SIGNING_SECRET: "dispatch-secret",
    });

    expect(environment.bundleEncryptionKey).toHaveLength(32);
    expect(environment.dispatchSigningSecret).toBe("dispatch-secret");
  });
});
