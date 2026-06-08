import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  hostedOnboardingError,
} from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  signalHostedManualRunRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedManualRunRuntime: mocks.signalHostedManualRunRuntime,
}));

import {
  signalHostedRuntimeManualWakeBestEffortResult,
} from "@/src/lib/hosted-orchestration/manual-wake";

describe("signalHostedRuntimeManualWakeBestEffortResult", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleError.mockRestore();
  });

  it("returns a safe best-effort failure when the manual wake exceeds its timeout", async () => {
    const signal = createDeferred<never>();
    mocks.signalHostedManualRunRuntime.mockReturnValue(signal.promise);

    const resultPromise = signalHostedRuntimeManualWakeBestEffortResult({
      timeoutMs: 5,
      userId: "member_timeout_test",
    });

    await vi.advanceTimersByTimeAsync(5);

    await expect(resultPromise).resolves.toEqual({
      accepted: false,
      configured: true,
      errorCode: "TimeoutError",
      signalAccepted: null,
      usageGateDenied: false,
      workflowIdPresent: null,
    });
    expect(mocks.signalHostedManualRunRuntime).toHaveBeenCalledWith({
      userId: "member_timeout_test",
    });

    signal.reject(new Error("late signal failure"));
    await Promise.resolve();
  });

  it("returns accepted metadata when the manual wake completes before the timeout", async () => {
    mocks.signalHostedManualRunRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_test",
    });

    await expect(signalHostedRuntimeManualWakeBestEffortResult({
      timeoutMs: 1_000,
      userId: "member_test",
    })).resolves.toEqual({
      accepted: true,
      configured: true,
      errorCode: null,
      signalAccepted: true,
      usageGateDenied: false,
      workflowIdPresent: true,
    });
  });

  it("returns usageGateDenied without logging when manual wake AI usage is denied", async () => {
    mocks.signalHostedManualRunRuntime.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_RUNTIME_MANUAL_WAKE_AI_USAGE_DENIED",
      httpStatus: 403,
      message: "Hosted runtime manual wake AI usage is denied.",
    }));

    await expect(signalHostedRuntimeManualWakeBestEffortResult({
      timeoutMs: 1_000,
      userId: "member_denied",
    })).resolves.toEqual({
      accepted: false,
      configured: true,
      errorCode: null,
      signalAccepted: null,
      usageGateDenied: true,
      workflowIdPresent: null,
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("returns a safe failure when manual wake AI usage gate is unavailable", async () => {
    mocks.signalHostedManualRunRuntime.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_RUNTIME_MANUAL_WAKE_AI_USAGE_GATE_UNAVAILABLE",
      httpStatus: 503,
      message: "Hosted runtime manual wake AI usage gate is unavailable.",
      retryable: true,
    }));

    await expect(signalHostedRuntimeManualWakeBestEffortResult({
      timeoutMs: 1_000,
      userId: "member_gate_unavailable",
    })).resolves.toEqual({
      accepted: false,
      configured: true,
      errorCode: "HOSTED_RUNTIME_MANUAL_WAKE_AI_USAGE_GATE_UNAVAILABLE",
      signalAccepted: null,
      usageGateDenied: false,
      workflowIdPresent: null,
    });
    expect(consoleError).not.toHaveBeenCalled();
  });
});

function createDeferred<T>(): {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, reject, resolve };
}
