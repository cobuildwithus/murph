import { describe, expect, it } from "vitest";

import {
  readHostedExecutionControlBaseUrl,
  readHostedExecutionDispatchEnvironment,
} from "@/src/lib/hosted-execution/environment";

describe("hosted execution environment", () => {
  it("accepts a loopback HTTP dispatch URL for local development", () => {
    expect(
      readHostedExecutionDispatchEnvironment({
        HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS: "45000",
        HOSTED_EXECUTION_DISPATCH_URL: "http://127.0.0.1:8787",
      }),
    ).toEqual({
      dispatchTimeoutMs: 45000,
      dispatchUrl: "http://127.0.0.1:8787",
    });

    expect(
      readHostedExecutionControlBaseUrl({
        HOSTED_EXECUTION_DISPATCH_URL: "http://localhost:8787",
      }),
    ).toBe("http://localhost:8787");
  });

  it("still rejects non-loopback HTTP dispatch URLs", () => {
    expect(() =>
      readHostedExecutionDispatchEnvironment({
        HOSTED_EXECUTION_DISPATCH_URL: "http://dispatch.example.test",
      }),
    ).toThrow(/Hosted execution base URLs must use HTTPS/u);
  });
});
