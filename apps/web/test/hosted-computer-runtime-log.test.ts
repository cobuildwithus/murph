import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { computerUseError } from "../src/lib/computer-use/errors";

const mocks = vi.hoisted(() => ({
  after: vi.fn((task: () => Promise<void>) => {
    void task();
  }),
  recordHostedRuntimeLog: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: mocks.after,
}));

vi.mock("@/src/lib/hosted-workspace/store", () => ({
  recordHostedRuntimeLog: mocks.recordHostedRuntimeLog,
}));

type RuntimeLogModule = typeof import("../src/lib/computer-use/runtime-log");

let runtimeLogModule: RuntimeLogModule;

describe("hosted computer runtime logs", () => {
  beforeAll(async () => {
    runtimeLogModule = await import("../src/lib/computer-use/runtime-log");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.after.mockImplementation((task: () => Promise<void>) => {
      void task();
    });
    mocks.recordHostedRuntimeLog.mockResolvedValue({});
  });

  it("records diagnostic runtime logs for computer action failures without raw action code", async () => {
    const error = computerUseError({
      code: "HOSTED_COMPUTER_EVAL_FAILED",
      details: {
        kernelError: "Error: strict mode violation: button matched multiple elements",
        kernelErrorPresent: true,
        kernelStderrPresent: true,
        kernelStdoutPresent: false,
      },
      httpStatus: 502,
      message: "Computer browser evaluation failed.",
      retryable: true,
    });
    const run = vi.fn(async () => {
      throw error;
    });

    await expect(runtimeLogModule.withHostedComputerToolFailureRuntimeLog({
      action: {
        code: "await page.getByRole('button', { name: 'Place your order', exact: true }).click();",
        timeoutMs: 20000,
      },
      memberId: "member_123",
      operation: "act",
      run,
    })).rejects.toBe(error);

    expect(run).toHaveBeenCalledTimes(1);
    expect(mocks.recordHostedRuntimeLog).toHaveBeenCalledWith({
      component: "assistant",
      errorCode: "HOSTED_COMPUTER_EVAL_FAILED",
      eventCode: "assistant.computer_tool_failed",
      level: "warn",
      phase: "error",
      redacted: {
        computerFailureCategory: "strict_mode_violation",
        computerOperationKind: "act",
        httpStatus: 502,
        kernelErrorPresent: true,
        kernelStderrPresent: true,
        kernelStdoutPresent: false,
        playwrightCodeHash: expect.any(String),
        retryable: true,
        safeErrorMessage: "Computer browser evaluation failed.",
        timeoutMs: 20000,
        unknownOutcome: true,
      },
      userId: "member_123",
    });
    expect(JSON.stringify(mocks.recordHostedRuntimeLog.mock.calls[0]?.[0])).not.toContain(
      "Place your order",
    );
    expect(JSON.stringify(mocks.recordHostedRuntimeLog.mock.calls[0]?.[0])).not.toContain(
      "strict mode violation",
    );
  });

  it("records redacted unexpected failure messages and causes", async () => {
    const error = new Error("browser crashed", {
      cause: new Error("page context closed"),
    });
    const run = vi.fn(async () => {
      throw error;
    });

    await expect(runtimeLogModule.withHostedComputerToolFailureRuntimeLog({
      memberId: "member_123",
      operation: "open",
      run,
    })).rejects.toBe(error);

    expect(run).toHaveBeenCalledTimes(1);
    expect(mocks.recordHostedRuntimeLog).toHaveBeenCalledWith({
      component: "assistant",
      errorCode: "HOSTED_COMPUTER_UNEXPECTED_FAILURE",
      eventCode: "assistant.computer_tool_failed",
      level: "warn",
      phase: "error",
      redacted: {
        computerOperationKind: "open",
        kernelErrorPresent: false,
        kernelStderrPresent: false,
        kernelStdoutPresent: false,
        computerErrorCause: "page context closed",
        safeErrorMessage: "browser crashed",
        unknownOutcome: false,
      },
      userId: "member_123",
    });
    expect(JSON.stringify(mocks.recordHostedRuntimeLog.mock.calls[0]?.[0])).toContain(
      "page context closed",
    );
  });

  it("preserves the computer tool failure when best-effort log writes fail", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = computerUseError({
      code: "HOSTED_COMPUTER_ACTION_STATE_INVALID",
      httpStatus: 409,
      message: "Computer run is already complete.",
      retryable: false,
    });
    const run = vi.fn(async () => {
      throw error;
    });
    mocks.recordHostedRuntimeLog.mockRejectedValueOnce(new Error("database write failed"));

    try {
      await expect(runtimeLogModule.withHostedComputerToolFailureRuntimeLog({
        memberId: "member_123",
        operation: "finish",
        run,
      })).rejects.toBe(error);

      expect(run).toHaveBeenCalledTimes(1);
      expect(mocks.recordHostedRuntimeLog).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => {
        expect(consoleWarn).toHaveBeenCalledWith(
          "Hosted computer tool failure log write failed.",
          {
            errorName: "Error",
            operation: "finish",
          },
        );
      });
      expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain("database write failed");
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it("rethrows without waiting for an unresolved diagnostic write", async () => {
    const error = computerUseError({
      code: "HOSTED_COMPUTER_MANAGED_LOGIN_UNAVAILABLE",
      httpStatus: 409,
      message: "Managed sign-in is temporarily unavailable.",
      retryable: true,
    });
    mocks.recordHostedRuntimeLog.mockImplementationOnce(
      async () => await new Promise(() => {}),
    );

    const outcome = await Promise.race([
      runtimeLogModule.withHostedComputerToolFailureRuntimeLog({
        memberId: "member_123",
        operation: "managed-login",
        run: async () => {
          throw error;
        },
      }).then(
        () => "resolved",
        (caught: unknown) => caught === error ? "rejected" : "wrong-error",
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("blocked"), 0);
      }),
    ]);

    expect(outcome).toBe("rejected");
  });

  it("records fixed-vocabulary managed-login and live-view validation metadata", async () => {
    const error = computerUseError({
      code: "HOSTED_COMPUTER_MANAGED_LOGIN_UNAVAILABLE",
      details: {
        handoffToken: "handoff-token",
        kernelSessionId: "kernel-session-private",
        liveViewHostnameAllowed: false,
        liveViewParsed: true,
        liveViewPortAllowed: false,
        liveViewProtocolAllowed: true,
        liveViewUrl: "https://browser.onkernel.com:8443/live/private-capability",
        managedAuthConnectionId: "managed-auth-1",
        managedLoginCauseCode: "HOSTED_COMPUTER_LIVE_VIEW_ORIGIN_NOT_ALLOWED",
        managedLoginStage: "live_view_fallback",
        providerError: "private provider failure",
      },
      httpStatus: 409,
      message: "Managed sign-in is temporarily unavailable.",
      retryable: true,
    });

    await expect(runtimeLogModule.withHostedComputerToolFailureRuntimeLog({
      memberId: "member_123",
      operation: "managed-login",
      run: async () => {
        throw error;
      },
    })).rejects.toBe(error);

    expect(mocks.recordHostedRuntimeLog).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "HOSTED_COMPUTER_MANAGED_LOGIN_UNAVAILABLE",
        redacted: expect.objectContaining({
          computerOperationKind: "managed-login",
          liveViewHostnameAllowed: false,
          liveViewParsed: true,
          liveViewPortAllowed: false,
          liveViewProtocolAllowed: true,
          managedLoginCauseCode: "HOSTED_COMPUTER_LIVE_VIEW_ORIGIN_NOT_ALLOWED",
          managedLoginStage: "live_view_fallback",
        }),
      }),
    );
    const persisted = JSON.stringify(mocks.recordHostedRuntimeLog.mock.calls.at(-1)?.[0]);
    expect(persisted).not.toContain("handoff-token");
    expect(persisted).not.toContain("onkernel.com");
    expect(persisted).not.toContain("managed-auth-1");
    expect(persisted).not.toContain("kernel-session-private");
    expect(persisted).not.toContain("private provider failure");
  });
});
