import { describe, expect, it } from "vitest";

import {
  readHostedExecutionControlBaseUrl,
  readHostedExecutionControlEnvironment,
  readHostedExecutionControlOrigin,
} from "@/src/lib/hosted-execution/environment";

describe("hosted execution environment", () => {
  it("accepts a loopback HTTP dispatch URL for local development", () => {
    expect(
      readHostedExecutionControlEnvironment({
        HOSTED_EXECUTION_CONTROL_TIMEOUT_MS: "45000",
        HOSTED_EXECUTION_CONTROL_URL: "http://127.0.0.1:8787",
      }),
    ).toEqual({
      controlBaseUrl: "http://127.0.0.1:8787",
      controlTimeoutMs: 45000,
    });

    expect(
      readHostedExecutionControlBaseUrl({
        HOSTED_EXECUTION_CONTROL_URL: "http://localhost:8787",
      }),
    ).toBe("http://localhost:8787");
  });

  it("still rejects non-loopback HTTP dispatch URLs", () => {
    expect(() =>
      readHostedExecutionControlEnvironment({
        HOSTED_EXECUTION_CONTROL_URL: "http://dispatch.example.test",
      }),
    ).toThrow(/Hosted execution base URLs must use HTTPS/u);
  });

  it("derives the private-media validation origin from the control URL", () => {
    expect(readHostedExecutionControlOrigin({
      HOSTED_EXECUTION_CONTROL_URL:
        "https://hosted-runner-staging.example.test/internal/control",
    })).toBe("https://hosted-runner-staging.example.test");
  });
});
