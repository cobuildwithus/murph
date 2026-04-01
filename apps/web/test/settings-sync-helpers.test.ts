import { describe, expect, it, vi } from "vitest";

import {
  readJsonErrorDetails,
  retrySyncOperation,
} from "@/src/components/settings/hosted-settings-sync-helpers";

describe("hosted settings sync helpers", () => {
  it("extracts nested JSON error details only when the payload shape is valid", () => {
    expect(readJsonErrorDetails(null)).toEqual({
      code: null,
      message: null,
    });
    expect(readJsonErrorDetails({
      error: "bad-shape",
    })).toEqual({
      code: null,
      message: null,
    });
    expect(readJsonErrorDetails({
      error: {
        code: "HOSTED_SYNC_UNAVAILABLE",
        message: "Hosted sync unavailable right now.",
      },
    })).toEqual({
      code: "HOSTED_SYNC_UNAVAILABLE",
      message: "Hosted sync unavailable right now.",
    });
  });

  it("reuses the provided sleep implementation across retry delays", async () => {
    const sleepImpl = vi.fn(async () => {});
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("retry-1"))
      .mockRejectedValueOnce(new Error("retry-2"))
      .mockResolvedValueOnce("ok");

    await expect(retrySyncOperation({
      errorFactory: (message) => new Error(message),
      operation,
      retryDelaysMs: [0, 25, 50],
      retryable: () => true,
      sleepImpl,
      timeoutMessage: "timed out",
    })).resolves.toBe("ok");

    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleepImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl.mock.calls).toEqual([[25], [50]]);
  });
});
