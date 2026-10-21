import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseHostedRuntimeLogEntry,
  parseHostedRuntimeLogRequest,
  parseHostedRuntimeRedactedJson,
} from "@murphai/hosted-execution/parsers";

import { KernelComputerClient } from "../src/lib/computer-use/kernel-client";
import { isHostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

import { computerUseError } from "../src/lib/computer-use/errors";

const mocks = vi.hoisted(() => ({
  after: vi.fn((task: () => Promise<void>) => {
    void task();
  }),
  playwrightExecute: vi.fn(),
  writeHostedRuntimeLogs: vi.fn(),
}));

vi.mock("@onkernel/sdk", () => ({
  ConflictError: class ConflictError extends Error {},
  default: class Kernel {
    browsers = { playwright: { execute: mocks.playwrightExecute } };
  },
  NotFoundError: class NotFoundError extends Error {},
}));

vi.mock("next/server", () => ({
  after: mocks.after,
}));

vi.mock("@/src/lib/hosted-runtime-log/write", () => ({
  writeHostedRuntimeLogs: mocks.writeHostedRuntimeLogs,
}));

type RuntimeLogModule = typeof import("../src/lib/computer-use/runtime-log");

let runtimeLogModule: RuntimeLogModule;

// Synthetic only: exercise the extractor, not fabricated pre-extracted details.
const diagnosticCases: Array<{
  name: string;
  response: { error?: unknown; stderr?: unknown; stdout?: unknown; result?: unknown };
  category: string | null;
  present: [boolean, boolean, boolean];
}> = [
  { name: "script syntax", response: { error: "SyntaxError: Unexpected token synthetic-private-value" }, category: "javascript_error", present: [true, false, false] },
  { name: "object reference error", response: { error: { name: "ReferenceError", message: "synthetic-private-value is not defined", stack: "ReferenceError: synthetic-private-value\n at /tmp/synthetic-private-value.js:1:1" } }, category: "javascript_error", present: [true, false, false] },
  { name: "stderr type error", response: { stderr: "TypeError: Cannot read properties of synthetic-private-value" }, category: "javascript_error", present: [false, true, false] },
  { name: "wrapped evaluation error", response: { error: "Error: page.evaluate: RangeError: synthetic-private-value" }, category: "javascript_error", present: [true, false, false] },
  { name: "name-only eval error", response: { error: { name: "EvalError" } }, category: "javascript_error", present: [true, false, false] },
  { name: "URI error", response: { error: "URIError: URI malformed" }, category: "javascript_error", present: [true, false, false] },
  { name: "aggregate error", response: { error: "AggregateError: All promises were rejected" }, category: "javascript_error", present: [true, false, false] },
  { name: "navigation network error", response: { error: "Error: page.goto: net::ERR_NAME_NOT_RESOLVED at https://synthetic.example.test/synthetic-private-value" }, category: "navigation_network_error", present: [true, false, false] },
  { name: "object navigation error", response: { error: { name: "Error", message: "page.reload: net::ERR_CONNECTION_RESET at https://synthetic.example.test/synthetic-private-value" } }, category: "navigation_network_error", present: [true, false, false] },
  { name: "stderr network error", response: { stderr: "net::ERR_CONNECTION_REFUSED at https://synthetic.example.test/synthetic-private-value" }, category: "navigation_network_error", present: [false, true, false] },
  { name: "interrupted navigation", response: { error: 'page.goBack: Navigation to "https://synthetic.example.test/synthetic-private-value" is interrupted by another navigation' }, category: "navigation_network_error", present: [true, false, false] },
  { name: "fetch failure before generic TypeError", response: { error: "TypeError: fetch failed" }, category: "navigation_network_error", present: [true, false, false] },
  { name: "object browser fetch failure", response: { stderr: { name: "TypeError", message: "Failed to fetch" } }, category: "navigation_network_error", present: [false, true, false] },
  { name: "unclassified private text", response: { error: "synthetic-private-value person@example.test +1-202-555-0100 https://synthetic.example.test/private authorization: Bearer synthetic-secret-value" }, category: null, present: [true, false, false] },
  { name: "absent diagnostics", response: {}, category: null, present: [false, false, false] },
  { name: "empty diagnostics", response: { error: " ", stderr: {}, stdout: null }, category: null, present: [false, false, false] },
  { name: "stdout is not error evidence", response: { stdout: "SyntaxError: synthetic-private-value\npage.goto: net::ERR_FAILED" }, category: null, present: [false, false, true] },
  { name: "object stdout is not error evidence", response: { stdout: { name: "TypeError", message: "fetch failed" } }, category: null, present: [false, false, true] },
  { name: "page fields are not diagnostics", response: { error: { title: "SyntaxError: synthetic-private-value", body: "page.goto: net::ERR_FAILED" }, result: { text: "TypeError: fetch failed" } }, category: null, present: [false, false, false] },
  { name: "nested fields are not diagnostics", response: { error: { message: { error: "SyntaxError: synthetic-private-value" } } }, category: null, present: [false, false, false] },
  { name: "prose is not a signature", response: { error: "synthetic-private-value mentions SyntaxError and navigation network failure" }, category: null, present: [true, false, false] },
  { name: "echoed page/source is not a header", response: { error: "Error: locator.click: synthetic-private-value\nSyntaxError: echoed page text\npage.goto: net::ERR_FAILED" }, category: null, present: [true, false, false] },
  { name: "diagnostic channels are not concatenated", response: { error: "Syntax", stderr: "Error: synthetic-private-value" }, category: null, present: [true, true, false] },
  { name: "unrecognized navigation failure", response: { error: "page.goto: synthetic-private-value" }, category: null, present: [true, false, false] },
  { name: "extractor truncation", response: { error: `Error: ${"x".repeat(4_100)}\nSyntaxError: synthetic-private-value` }, category: null, present: [true, false, false] },
  { name: "strict mode keeps first precedence", response: { error: "SyntaxError: strict mode violation timeout target closed", stderr: "page.goto: net::ERR_FAILED" }, category: "strict_mode_violation", present: [true, true, false] },
  { name: "timeout keeps second precedence", response: { error: "SyntaxError: timeout target closed", stderr: "page.goto: net::ERR_FAILED" }, category: "timeout", present: [true, true, false] },
  { name: "closed target keeps third precedence", response: { error: "TypeError: target closed", stderr: "page.goto: net::ERR_FAILED" }, category: "browser_closed", present: [true, true, false] },
  { name: "closed page context", response: { error: "page context closed" }, category: "browser_closed", present: [true, false, false] },
  { name: "closed browser context", response: { error: "browser context closed" }, category: "browser_closed", present: [true, false, false] },
];

describe("hosted computer runtime logs", () => {
  beforeAll(async () => {
    runtimeLogModule = await import("../src/lib/computer-use/runtime-log");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.after.mockImplementation((task: () => Promise<void>) => {
      void task();
    });
    mocks.writeHostedRuntimeLogs.mockResolvedValue({});
  });

  it.each(diagnosticCases)("classifies $name through extraction and log parsing", async ({ response, category, present }) => {
    const client = new KernelComputerClient({ apiKey: "test-kernel-key" });
    const action = { code: 'throw new Error("synthetic-script-value")', timeoutMs: 20_000 };
    mocks.playwrightExecute.mockResolvedValueOnce({ ...response, success: false });
    let extractedError: unknown;
    const run = vi.fn(async () => {
      try {
        return await client.executePlaywright({ ...action, sessionId: "synthetic-session-value" });
      } catch (error) {
        extractedError = error;
        throw error;
      }
    });
    const caught = await runtimeLogModule.withHostedComputerToolFailureRuntimeLog({
      action,
      memberId: "member_123",
      operation: "act",
      run,
    }).catch((error: unknown) => error);

    expect(caught).toBe(extractedError);
    expect(caught).toMatchObject({
      code: "HOSTED_COMPUTER_EVAL_FAILED",
      httpStatus: 502,
      message: "Computer browser evaluation failed.",
      retryable: true,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(mocks.playwrightExecute).toHaveBeenCalledExactlyOnceWith("synthetic-session-value", {
      code: action.code,
      timeout_sec: 20,
    });
    if (!isHostedOnboardingError(caught)) throw new Error("Expected a computer domain error.");
    for (const key of ["kernelError", "kernelStderr"] as const) {
      const value = caught.details?.[key];
      if (typeof value === "string") expect(value.length).toBeLessThanOrEqual(4_000);
    }
    expect(caught.details).not.toHaveProperty("kernelStdout");
    expect(mocks.writeHostedRuntimeLogs).toHaveBeenCalledTimes(1);
    // The real append parser and read parser must retain the observation after JSON storage.
    const entry = parseHostedRuntimeLogRequest({
      entries: mocks.writeHostedRuntimeLogs.mock.calls[0]?.[0].entries,
    }).entries[0];
    const read = parseHostedRuntimeRedactedJson(
      JSON.parse(JSON.stringify(entry?.redactedJson)),
      "Hosted runtime timing log redactedJson",
    );
    expect(read).toEqual(entry?.redactedJson);
    expect(read).toEqual({
      computerFailureCategory: category ?? "unclassified",
      computerOperationElapsedMs: expect.any(Number),
      kernelExecutionTimeoutMs: 20_000,
      kernelExecutionElapsedMs: expect.any(Number),
      computerOperationKind: "act",
      httpStatus: 502,
      kernelErrorPresent: present[0],
      kernelStderrPresent: present[1],
      kernelStdoutPresent: present[2],
      playwrightCodeHash: expect.any(String),
      retryable: true,
      safeErrorMessage: "Computer browser evaluation failed.",
      timeoutMs: 20_000,
      unknownOutcome: true,
    });
    const logged = JSON.stringify(mocks.writeHostedRuntimeLogs.mock.calls);
    for (const secret of [
      "synthetic-private-value", "synthetic-script-value", "synthetic-session-value",
      "synthetic-secret-value", "person@example.test", "202-555-0100", "https://", "/tmp/",
    ]) expect(logged).not.toContain(secret);
  });

  it("returns the identical successful result without scheduling or writing diagnostics", async () => {
    const result = { text: "SyntaxError: synthetic-private-value", stdout: "net::ERR_FAILED" };
    const run = vi.fn(async () => result);
    await expect(runtimeLogModule.withHostedComputerToolFailureRuntimeLog({
      memberId: "member_123", operation: "act", run,
    })).resolves.toBe(result);
    expect(run).toHaveBeenCalledTimes(1);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.writeHostedRuntimeLogs).not.toHaveBeenCalled();
  });

  it("defers classification and logging until the scheduled task runs", async () => {
    const tasks: Array<() => Promise<void>> = [];
    mocks.after.mockImplementationOnce((task) => { tasks.push(task); });
    const error = computerUseError({
      code: "HOSTED_COMPUTER_EVAL_FAILED", httpStatus: 502,
      message: "Computer browser evaluation failed.", retryable: true,
      details: { kernelError: "SyntaxError: synthetic-private-value", kernelErrorPresent: true },
    });
    await expect(runtimeLogModule.withHostedComputerToolFailureRuntimeLog({
      memberId: "member_123", operation: "act", run: async () => { throw error; },
    })).rejects.toBe(error);
    expect(mocks.writeHostedRuntimeLogs).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(1);
    await tasks[0]?.();
    expect(mocks.writeHostedRuntimeLogs).toHaveBeenCalledTimes(1);
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
    expect(mocks.writeHostedRuntimeLogs).toHaveBeenCalledWith({
      entries: [{
        at: expect.any(String),
        component: "assistant",
        errorCode: "HOSTED_COMPUTER_EVAL_FAILED",
        eventCode: "assistant.computer_tool_failed",
        level: "warn",
        phase: "error",
        redactedJson: {
        computerFailureCategory: "strict_mode_violation",
        computerOperationKind: "act",
        computerOperationElapsedMs: expect.any(Number),
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
      }],
      userId: "member_123",
    });
    expect(JSON.stringify(mocks.writeHostedRuntimeLogs.mock.calls[0]?.[0])).not.toContain(
      "Place your order",
    );
    expect(JSON.stringify(mocks.writeHostedRuntimeLogs.mock.calls[0]?.[0])).not.toContain(
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
    expect(mocks.writeHostedRuntimeLogs).toHaveBeenCalledWith({
      entries: [{
        at: expect.any(String),
        component: "assistant",
        errorCode: "HOSTED_COMPUTER_UNEXPECTED_FAILURE",
        eventCode: "assistant.computer_tool_failed",
        level: "warn",
        phase: "error",
        redactedJson: {
        computerOperationKind: "open",
        computerOperationElapsedMs: expect.any(Number),
        computerFailureCategory: "unclassified",
        kernelErrorPresent: false,
        kernelStderrPresent: false,
        kernelStdoutPresent: false,
        computerErrorCause: "page context closed",
        safeErrorMessage: "browser crashed",
        unknownOutcome: false,
        },
      }],
      userId: "member_123",
    });
    expect(JSON.stringify(mocks.writeHostedRuntimeLogs.mock.calls[0]?.[0])).toContain(
      "page context closed",
    );
  });

  it("persists execution timing alongside closed failure diagnostics", async () => {
    const message = "private unrecognized failure";
    const category = "unclassified";
    const clock = vi.spyOn(performance, "now").mockReturnValueOnce(100).mockReturnValueOnce(850);
    const error = computerUseError({
      code: "HOSTED_COMPUTER_EVAL_FAILED", httpStatus: 502,
      message: "Computer browser evaluation failed.", retryable: true,
      details: { kernelError: message, kernelExecutionTimeoutMs: 23000, kernelExecutionElapsedMs: 700 },
    });
    try {
      await expect(runtimeLogModule.withHostedComputerToolFailureRuntimeLog({
        memberId: "member_123", operation: "open", run: async () => { throw error; },
      })).rejects.toBe(error);
      const entry = mocks.writeHostedRuntimeLogs.mock.calls.at(-1)?.[0].entries[0];
      expect(entry.redactedJson).toMatchObject({
        computerFailureCategory: category, computerOperationElapsedMs: 750,
        kernelExecutionTimeoutMs: 23000, kernelExecutionElapsedMs: 700,
      });
      expect(parseHostedRuntimeLogEntry(entry)).toEqual(entry);
      expect(JSON.stringify(entry)).not.toContain(message);
    } finally { clock.mockRestore(); }
  });

  it("retains only valid upstream statuses and timing values without changing SDK failures", async () => {
    for (const status of [429, 503, "private-status", 200, 999]) {
      const error = Object.assign(new Error("Computer provider unavailable."), { status });
      await expect(runtimeLogModule.withHostedComputerToolFailureRuntimeLog({
        memberId: "member_123", operation: "act", run: async () => { throw error; },
      })).rejects.toBe(error);
      const entry = mocks.writeHostedRuntimeLogs.mock.calls.at(-1)?.[0].entries[0];
      expect(entry.redactedJson.providerHttpStatus).toBe(status === 429 || status === 503 ? status : undefined);
      expect(parseHostedRuntimeLogEntry(entry)).toEqual(entry);
    }
    const error = computerUseError({
      code: "HOSTED_COMPUTER_EVAL_FAILED", httpStatus: 502, message: "Computer browser evaluation failed.",
      details: { kernelExecutionTimeoutMs: "private-value", kernelExecutionElapsedMs: Infinity },
    });
    await expect(runtimeLogModule.withHostedComputerToolFailureRuntimeLog({
      memberId: "member_123", operation: "open", run: async () => { throw error; },
    })).rejects.toBe(error);
    const entry = mocks.writeHostedRuntimeLogs.mock.calls.at(-1)?.[0].entries[0];
    expect(entry.redactedJson).not.toHaveProperty("kernelExecutionTimeoutMs");
    expect(entry.redactedJson).not.toHaveProperty("kernelExecutionElapsedMs");
  });

  it.each([false, true])("preserves failures when logging fails (after unavailable: %s)", async (afterUnavailable) => {
    if (afterUnavailable) {
      mocks.after.mockImplementationOnce(() => { throw new Error("after unavailable"); });
    }
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
    mocks.writeHostedRuntimeLogs.mockRejectedValueOnce(new Error("database write failed"));

    try {
      await expect(runtimeLogModule.withHostedComputerToolFailureRuntimeLog({
        memberId: "member_123",
        operation: "finish",
        run,
      })).rejects.toBe(error);

      expect(run).toHaveBeenCalledTimes(1);
      expect(mocks.writeHostedRuntimeLogs).toHaveBeenCalledTimes(1);
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
    mocks.writeHostedRuntimeLogs.mockImplementationOnce(
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

    expect(mocks.writeHostedRuntimeLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [expect.objectContaining({
          errorCode: "HOSTED_COMPUTER_MANAGED_LOGIN_UNAVAILABLE",
          redactedJson: expect.objectContaining({
            computerOperationKind: "managed-login",
            liveViewHostnameAllowed: false,
            liveViewParsed: true,
            liveViewPortAllowed: false,
            liveViewProtocolAllowed: true,
            managedLoginCauseCode: "HOSTED_COMPUTER_LIVE_VIEW_ORIGIN_NOT_ALLOWED",
            managedLoginStage: "live_view_fallback",
          }),
        })],
      }),
    );
    const persisted = JSON.stringify(mocks.writeHostedRuntimeLogs.mock.calls.at(-1)?.[0]);
    expect(persisted).not.toContain("handoff-token");
    expect(persisted).not.toContain("onkernel.com");
    expect(persisted).not.toContain("managed-auth-1");
    expect(persisted).not.toContain("kernel-session-private");
    expect(persisted).not.toContain("private provider failure");
  });
});
