import { describe, expect, it } from "vitest";

import { formatHostedExecutionSafeLogError } from "@/src/lib/hosted-execution/logging";

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
});
