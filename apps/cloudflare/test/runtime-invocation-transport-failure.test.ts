import { describe, expect, it } from "vitest";

import {
  buildHostedRunnerRedactedErrorJson,
} from "../src/user-runner/diagnostics.js";

describe("buildHostedRunnerRedactedErrorJson", () => {
  it("keeps scalar diagnostics plus bounded sanitized detail and cause in the persisted redacted shape", () => {
    const error = new Error(
      "container transport failed for hbm_abcdefghijklmnop- at /tmp/runtime.log",
      { cause: new Error("authorization=Bearer secret-token") },
    );
    const redacted = buildHostedRunnerRedactedErrorJson(error);

    expect(redacted).toEqual({
      detailsKeys: ["errorCause", "errorCode", "errorDetail", "errorMessage", "errorName"],
      errorCode: "runtime_error",
      errorDetailPresent: true,
      errorName: "Error",
      safeErrorCause: "authorization=Bearer [redacted]",
      safeErrorDetail:
        "container transport failed for hbm_<redacted-id> at <REDACTED_PATH>",
      safeErrorMessage: "Hosted execution runtime failed.",
    });
    expect(JSON.stringify(redacted)).not.toContain("abcdefghijklmnop-");
    expect(JSON.stringify(redacted)).not.toContain("/tmp/runtime.log");
    expect(JSON.stringify(redacted)).not.toContain("secret-token");
  });

  it("returns an empty redacted object for undefined errors", () => {
    expect(buildHostedRunnerRedactedErrorJson(undefined)).toEqual({});
  });

  it("drops errorCodeDetail values that do not look like plain code tokens", () => {
    const pathShapedCode = new Error("boom");
    Object.assign(pathShapedCode, { code: "/etc/passwd leaked via code" });

    const redacted = buildHostedRunnerRedactedErrorJson(pathShapedCode);

    expect(redacted).not.toHaveProperty("errorCodeDetail");
    expect(JSON.stringify(redacted)).not.toContain("/etc/passwd");
  });

  it("keeps errorCodeDetail values that look like plain code tokens", () => {
    const tokenCode = new Error("boom");
    Object.assign(tokenCode, { code: "ECONNRESET" });

    expect(buildHostedRunnerRedactedErrorJson(tokenCode)).toMatchObject({
      errorCodeDetail: "ECONNRESET",
    });
  });

  it("does not promote identifier-shaped nested detail over the outer error code", () => {
    const nestedIdentifier = Object.assign(new Error("boom"), {
      code: "runtime_error",
      details: {
        errorCodeDetail: "member_123456789",
      },
    });

    const redacted = buildHostedRunnerRedactedErrorJson(nestedIdentifier);

    expect(redacted).toMatchObject({
      errorCodeDetail: "runtime_error",
    });
    expect(JSON.stringify(redacted)).not.toContain("member_123456789");
  });
});
