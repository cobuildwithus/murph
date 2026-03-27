import { describe, expect, it } from "vitest";

import { readHostedExecutionDispatchEnvironment } from "@/src/lib/hosted-execution/env";

describe("readHostedExecutionDispatchEnvironment", () => {
  it("prefers the current Cloudflare env names", () => {
    const environment = readHostedExecutionDispatchEnvironment({
      HOSTED_EXECUTION_CLOUDFLARE_BASE_URL: "https://runner.example.test/",
      HOSTED_EXECUTION_CLOUDFLARE_SIGNING_SECRET: "secret",
      HOSTED_EXECUTION_CLOUDFLARE_TIMEOUT_MS: "45000",
      HOSTED_EXECUTION_DISPATCH_URL: "https://legacy.example.test/",
      HOSTED_EXECUTION_SIGNING_SECRET: "legacy-secret",
      HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS: "15000",
    });

    expect(environment.dispatchTimeoutMs).toBe(45_000);
    expect(environment.dispatchUrl).toBe("https://runner.example.test");
    expect(environment.signingSecret).toBe("secret");
  });

  it("still accepts the legacy dispatch env aliases", () => {
    const environment = readHostedExecutionDispatchEnvironment({
      HOSTED_EXECUTION_DISPATCH_URL: "https://runner.example.test/",
      HOSTED_EXECUTION_SIGNING_SECRET: "secret",
      HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS: "45000",
    });

    expect(environment.dispatchTimeoutMs).toBe(45_000);
    expect(environment.dispatchUrl).toBe("https://runner.example.test");
    expect(environment.signingSecret).toBe("secret");
  });

  it("falls back to legacy aliases when preferred vars are blank", () => {
    const environment = readHostedExecutionDispatchEnvironment({
      HOSTED_EXECUTION_CLOUDFLARE_BASE_URL: "   ",
      HOSTED_EXECUTION_DISPATCH_URL: "https://legacy.example.test/",
      HOSTED_EXECUTION_CLOUDFLARE_SIGNING_SECRET: "   ",
      HOSTED_EXECUTION_SIGNING_SECRET: "legacy-secret",
      HOSTED_EXECUTION_CLOUDFLARE_TIMEOUT_MS: "   ",
      HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS: "45000",
    });

    expect(environment.dispatchTimeoutMs).toBe(45_000);
    expect(environment.dispatchUrl).toBe("https://legacy.example.test");
    expect(environment.signingSecret).toBe("legacy-secret");
  });

  it("uses the default dispatch timeout when no timeout env is present", () => {
    expect(readHostedExecutionDispatchEnvironment({}).dispatchTimeoutMs).toBe(30_000);
  });
});
