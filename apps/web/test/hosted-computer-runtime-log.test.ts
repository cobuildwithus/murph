import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseHostedRuntimeLogEntry,
} from "@murphai/hosted-execution/parsers";

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
        kernelError:
          "locator.click: Error: strict mode violation for button text Place your order patient-id-123 href=\"https://www.amazon.com/gp/buy/spc/handlers/display.html?session=secret\"",
        kernelStderr: "page context closed at https://www.amazon.com/checkout?token=secret patient-id-456",
        kernelStdout:
          "browser html patient-id-789 <img src='https://www.amazon.com/private.png?token=secret'>",
      },
      httpStatus: 502,
      message:
        "Computer browser evaluation failed: locator.click: Error: strict mode violation",
      retryable: true,
    });
    const run = vi.fn(async () => {
      throw error;
    });

    await expect(runtimeLogModule.withHostedComputerToolFailureRuntimeLog({
      action: {
        action: "click",
        locator: {
          by: "role",
          exact: true,
          name: "Place your order",
          role: "button",
        },
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
        browserActionKind: "click",
        computerFailureCategory: "strict_mode_violation",
        computerLocatorType: "role",
        computerOperationKind: "act",
        httpStatus: 502,
        kernelErrorPresent: true,
        kernelStderrPresent: true,
        kernelStdoutPresent: true,
        retryable: true,
        safeErrorMessage: "Hosted computer tool failed.",
        timeoutMs: 20000,
        unknownOutcome: true,
      },
      userId: "member_123",
    });
    const call = mocks.recordHostedRuntimeLog.mock.calls[0]?.[0];
    const serialized = JSON.stringify(call);
    expect(serialized).toContain("strict_mode_violation");
    expect(serialized).not.toContain("Place your order");
    expect(serialized).not.toContain("strict mode violation");
    expect(serialized).not.toContain("page context closed");
    expect(serialized).not.toContain("browser html");
    expect(serialized).not.toContain("patient-id-123");
    expect(serialized).not.toContain("patient-id-456");
    expect(serialized).not.toContain("patient-id-789");
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("session=secret");
    expect(serialized).not.toContain("token=secret");
    expect(parseHostedRuntimeLogEntry({
      at: "2026-06-17T12:00:00.000Z",
      component: call?.component,
      errorCode: call?.errorCode,
      eventCode: call?.eventCode,
      level: call?.level,
      phase: call?.phase,
      redactedJson: call?.redacted,
    })).toMatchObject({
      errorCode: "HOSTED_COMPUTER_EVAL_FAILED",
      redactedJson: {
        computerFailureCategory: "strict_mode_violation",
        kernelErrorPresent: true,
        kernelStdoutPresent: true,
      },
    });
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

  it("records metadata-only runtime logs for OS-control failures", async () => {
    const error = computerUseError({
      code: "HOSTED_COMPUTER_OS_CONTROL_FAILED",
      details: {
        kernelError: "typed canary-sensitive-input at 120,240",
      },
      httpStatus: 502,
      message: "Computer OS control failed.",
      retryable: true,
    });
    const run = vi.fn(async () => {
      throw error;
    });

    await expect(runtimeLogModule.withHostedComputerToolFailureRuntimeLog({
      action: {
        action: "typeText",
        text: "canary-sensitive-input",
      },
      memberId: "member_123",
      operation: "os-control",
      run,
    })).rejects.toBe(error);

    expect(mocks.recordHostedRuntimeLog).toHaveBeenCalledWith({
      component: "assistant",
      errorCode: "HOSTED_COMPUTER_OS_CONTROL_FAILED",
      eventCode: "assistant.computer_tool_failed",
      level: "warn",
      phase: "error",
      redacted: {
        computerOperationKind: "os-control",
        computerOsControlKind: "typeText",
        httpStatus: 502,
        kernelErrorPresent: true,
        kernelStderrPresent: false,
        kernelStdoutPresent: false,
        retryable: true,
        safeErrorMessage: "Hosted computer tool failed.",
        unknownOutcome: true,
      },
      userId: "member_123",
    });
    const serialized = JSON.stringify(mocks.recordHostedRuntimeLog.mock.calls[0]?.[0]);
    expect(serialized).not.toContain("canary-sensitive-input");
    expect(serialized).not.toContain("120,240");
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
