import { describe, expect, it } from "vitest";

import { resolveSmokeWorkerBaseUrl } from "../scripts/smoke-hosted-deploy.shared.js";

describe("resolveSmokeWorkerBaseUrl", () => {
  it("prefers the explicit smoke worker base URL over the other envs", () => {
    expect(
      resolveSmokeWorkerBaseUrl({
        HOSTED_EXECUTION_DISPATCH_URL: "https://legacy.example.test/",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://override.example.test/",
      }),
    ).toBe("https://override.example.test");
  });

  it("falls back to the dispatch URL when no smoke override is set", () => {
    expect(
      resolveSmokeWorkerBaseUrl({
        HOSTED_EXECUTION_DISPATCH_URL: " https://worker.example.test/ ",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "   ",
      }),
    ).toBe("https://worker.example.test");
  });

  it("falls back to the legacy dispatch URL when the preferred envs are absent", () => {
    expect(
      resolveSmokeWorkerBaseUrl({
        HOSTED_EXECUTION_DISPATCH_URL: "https://legacy.example.test/",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "   ",
      }),
    ).toBe("https://legacy.example.test");
  });

  it("keeps the configured-error text stable when no worker base URL env is set", () => {
    expect(() => resolveSmokeWorkerBaseUrl({})).toThrow(
      "HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL or HOSTED_EXECUTION_DISPATCH_URL must be configured.",
    );
  });
});
