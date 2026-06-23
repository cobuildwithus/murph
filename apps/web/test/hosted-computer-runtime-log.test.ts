import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { computerUseError } from "../src/lib/computer-use/errors";

const mocks = vi.hoisted(() => ({
  recordHostedRuntimeLog: vi.fn(),
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
    mocks.recordHostedRuntimeLog.mockResolvedValue({});
  });

  it("records metadata-only runtime logs for computer action failures", async () => {
    const error = computerUseError({
      code: "HOSTED_COMPUTER_EVAL_FAILED",
      details: {
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
        computerOperationKind: "act",
        httpStatus: 502,
        kernelErrorPresent: true,
        kernelStderrPresent: true,
        kernelStdoutPresent: false,
        playwrightCodeHash: expect.any(String),
        retryable: true,
        safeErrorMessage: "Hosted computer tool failed.",
        timeoutMs: 20000,
        unknownOutcome: true,
      },
      userId: "member_123",
    });
    expect(JSON.stringify(mocks.recordHostedRuntimeLog.mock.calls[0]?.[0])).not.toContain(
      "Place your order",
    );
    expect(JSON.stringify(mocks.recordHostedRuntimeLog.mock.calls[0]?.[0])).not.toContain(
      "page context closed",
    );
  });

  it("records generic metadata for unexpected failures without leaking raw error text", async () => {
    const error = new Error("browser crashed after visiting private checkout token");
    const run = vi.fn(async () => {
      throw error;
    });

    await expect(runtimeLogModule.withHostedComputerToolFailureRuntimeLog({
      memberId: "member_123",
      operation: "start-run",
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
        computerOperationKind: "start-run",
        kernelErrorPresent: false,
        kernelStderrPresent: false,
        kernelStdoutPresent: false,
        safeErrorMessage: "Hosted computer tool failed.",
        unknownOutcome: false,
      },
      userId: "member_123",
    });
    expect(JSON.stringify(mocks.recordHostedRuntimeLog.mock.calls[0]?.[0])).not.toContain(
      "private checkout token",
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
      expect(consoleWarn).toHaveBeenCalledWith(
        "Hosted computer tool failure log write failed.",
        {
          errorName: "Error",
          operation: "finish",
        },
      );
      expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain("database write failed");
    } finally {
      consoleWarn.mockRestore();
    }
  });
});
