import { describe, expect, it } from "vitest";

import {
  readHostedRuntimeSafeErrorText,
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

  it("extracts redacted messages from an error cause chain", () => {
    const cause = new TypeError(
      "fetch failed for https://example.r2.cloudflarestorage.com/bucket/object"
        + "?X-Amz-Signature=abcdef1234567890"
        + " with local scratch /tmp/hosted-runtime/snapshot.enc"
        + " and TOKEN=secret-token",
    );
    const error = new Error("Hosted provider request failed.", { cause });

    expect(readHostedRuntimeSafeErrorText(error)).toBe(
      "Hosted provider request failed."
        + " | fetch failed for <redacted-url> with local scratch <redacted-path>"
        + " and TOKEN=<redacted>",
    );
  });

  it("redacts hosted workspace and user identifiers in safe error text", () => {
    const error = new Error(
      "failed for snapshot_runner_platform "
        + "users/hsn_0123456789abcdef01234567/workspace-snapshots/snapshot_runner_platform.snapshot.enc "
        + "hsn_0123456789abcdef01234567 member_123 root_key_test wrapped_data_key_test",
    );

    expect(readHostedRuntimeSafeErrorText(error)).toBe(
      "failed for <redacted-snapshot-id> "
        + "users/<redacted>/workspace-snapshots/<redacted> "
        + "<redacted-hosted-namespace> <redacted-user-id> <redacted-key-id> <redacted-key-id>",
    );
  });

  it("walks nested causes while redacting hosted snapshot identifiers and secrets", () => {
    const rootCause = new TypeError(
      "fetch failed for https://r2.example.test/bundles/object?X-Amz-Signature=fixture-secret"
        + " and API_KEY=hidden-provider-key",
    );
    const midCause = new Error(
      "direct upload object users/hsn_0123456789abcdef01234567"
        + "/workspace-snapshots/snapshot_runner_platform.snapshot.enc"
        + " for member_123 root_key_test",
      { cause: rootCause },
    );
    const error = new Error("Hosted workspace snapshot direct R2 upload request failed.", {
      cause: midCause,
    });

    expect(readHostedRuntimeSafeErrorText(error)).toBe(
      "Hosted workspace snapshot direct R2 upload request failed."
        + " | direct upload object users/<redacted>/workspace-snapshots/<redacted>"
        + " for <redacted-user-id> <redacted-key-id>"
        + " | fetch failed for <redacted-url> and API_KEY=<redacted>",
    );
  });
});
