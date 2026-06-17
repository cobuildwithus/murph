import { describe, expect, it } from "vitest";

import {
  describeHostedExecutionSafeLogErrorCode,
  formatHostedExecutionSafeLogError,
  formatHostedExecutionSafeLogErrorDetails,
} from "@/src/lib/hosted-execution/logging";

describe("formatHostedExecutionSafeLogError", () => {
  it("redacts bearer tokens and email addresses", () => {
    expect(
      formatHostedExecutionSafeLogError(
        new Error("authorization: Bearer abc.def.ghi user@example.com"),
      ),
    ).toBe("authorization=Bearer [redacted] [redacted-email]");
  });

  it("falls back to the shared unknown-error message for blank input", () => {
    expect(formatHostedExecutionSafeLogError(" \n\t ")).toBe("Unknown hosted execution error.");
  });

  it("redacts hosted workflow and direct member identifiers", () => {
    expect(
      formatHostedExecutionSafeLogError(
        new Error("failed hosted-user-runtime:member_test for member_test"),
      ),
    ).toBe("failed hosted-user-runtime:<redacted-id> for member_<redacted-id>");
  });

  it("formats structured logs with a safe code and redacted message chain", () => {
    const error = new Error("failed for user@example.com");
    error.name = "Unsafe user@example.com";
    error.cause = new Error("Bearer secret-token-value");

    expect(describeHostedExecutionSafeLogErrorCode(error)).toBe("UnknownError");
    expect(formatHostedExecutionSafeLogErrorDetails(error, {
      code: "HOSTED_TEST_FAILURE",
    })).toEqual({
      errorCauseMessage: "Bearer [redacted]",
      errorCauseType: "Error",
      errorCode: "HOSTED_TEST_FAILURE",
      errorMessage: "failed for [redacted-email]",
      errorType: "Error",
    });
  });
});
