import { describe, expect, it } from "vitest";

import {
  redactHostedRuntimeDiagnosticDetails,
  redactHostedRuntimeDiagnosticText,
} from "../src/hosted-runtime-redaction.ts";

describe("hosted runtime diagnostic redaction", () => {
  it("redacts SigV4 credential-bearing query parameters without dropping the URL shape", () => {
    const redacted = redactHostedRuntimeDiagnosticText(
      "PUT https://example.r2.cloudflarestorage.com/bucket/object"
        + "?X-Amz-Algorithm=AWS4-HMAC-SHA256"
        + "&X-Amz-Credential=AKIDEXAMPLE%2F20260520%2Fauto%2Fs3%2Faws4_request"
        + "&X-Amz-Date=20260520T123456Z"
        + "&X-Amz-Security-Token=session-token-value"
        + "&X-Amz-Signature=abcdef1234567890",
    );

    expect(redacted).toContain("example.r2.cloudflarestorage.com/bucket/object");
    expect(redacted).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(redacted).toContain("X-Amz-Credential=<redacted>");
    expect(redacted).toContain("X-Amz-Security-Token=<redacted>");
    expect(redacted).toContain("X-Amz-Signature=<redacted>");
    expect(redacted).not.toContain("AKIDEXAMPLE");
    expect(redacted).not.toContain("session-token-value");
    expect(redacted).not.toContain("abcdef1234567890");
  });

  it("redacts presigned URL fields inside nested diagnostic details", () => {
    expect(redactHostedRuntimeDiagnosticDetails({
      upload: {
        putUrl:
          "https://example.r2.cloudflarestorage.com/bucket/object?X-Amz-Signature=abcdef1234567890",
      },
    })).toEqual({
      upload: {
        putUrl:
          "https://example.r2.cloudflarestorage.com/bucket/object?X-Amz-Signature=<redacted>",
      },
    });
  });
});
