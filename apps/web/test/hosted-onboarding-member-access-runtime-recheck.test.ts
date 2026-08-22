import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signalHostedRuntimeRecheckRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedRuntimeRecheckRuntime: mocks.signalHostedRuntimeRecheckRuntime,
}));

import {
  signalHostedAccessGrantRuntimeRecheckBestEffort,
} from "@/src/lib/hosted-onboarding/member-access-runtime-recheck";

describe("signalHostedAccessGrantRuntimeRecheckBestEffort", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("sends a bounded payload-free recheck after access is granted", async () => {
    const prisma = {} as never;
    mocks.signalHostedRuntimeRecheckRuntime.mockResolvedValueOnce({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });

    await expect(signalHostedAccessGrantRuntimeRecheckBestEffort({
      memberId: "member_123",
      prisma,
      timeoutMs: 5_000,
    })).resolves.toBeUndefined();

    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      prisma,
      userId: "member_123",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("contains and redacts a failed best-effort recheck", async () => {
    const signalError = new Error("failed member_123 with Bearer abc.def.ghi");
    signalError.name = "TemporalSignalError";
    mocks.signalHostedRuntimeRecheckRuntime.mockRejectedValueOnce(signalError);

    await expect(signalHostedAccessGrantRuntimeRecheckBestEffort({
      memberId: "member_123",
      prisma: {} as never,
    })).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      "Hosted access-grant runtime recheck failed.",
      expect.objectContaining({
        errorCode: "TemporalSignalError",
        errorMessage: "failed member_<redacted-id> with Bearer [redacted]",
        errorType: "Error",
      }),
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("abc.def.ghi");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("failed member_123");
  });
});
