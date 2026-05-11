export type RuntimeLivenessRejectionReason =
  | "malformed_request"
  | "no_active_invocation"
  | "stale_attempt"
  | "stale_generation"
  | "unauthorized"
  | "wrong_user";

export type RuntimeLivenessInstruction =
  | {
    kind: "continue";
  }
  | {
    kind: "yield";
    nextWakeAt: string | null;
    status: "scheduled";
  };

export type RuntimeLivenessAcceptedResult = {
  instruction: RuntimeLivenessInstruction;
  inputAvailable?: boolean;
  nextAlarmAt?: string | null;
  ok: true;
  pendingNudge?: boolean;
};

export type RuntimeLivenessTouchResult =
  | RuntimeLivenessAcceptedResult
  | {
    ok: false;
    reason: RuntimeLivenessRejectionReason;
  };

export interface RuntimeLivenessPort {
  touch(input: {
    requestId: string;
    signal?: AbortSignal | null;
  }): Promise<RuntimeLivenessTouchResult>;
}

export interface RuntimeLivenessHeartbeat {
  readonly initialTouch: Promise<RuntimeLivenessTouchResult>;
  stop(): Promise<void>;
}

const RUNTIME_LIVENESS_CONTINUE_RESULT: RuntimeLivenessAcceptedResult = {
  instruction: { kind: "continue" },
  ok: true,
};
export const RUNTIME_LIVENESS_DEFAULT_INTERVAL_MS = 15_000;
export const RUNTIME_LIVENESS_TOUCH_TIMEOUT_MAX_MS = 5_000;

export function readRuntimeLivenessInstruction(
  result: RuntimeLivenessAcceptedResult,
): RuntimeLivenessInstruction {
  return result.instruction;
}

export function readRuntimeLivenessNextWakeAt(
  result: RuntimeLivenessAcceptedResult,
): string | null {
  const instruction = readRuntimeLivenessInstruction(result);
  return instruction.kind === "yield" ? instruction.nextWakeAt : null;
}

export function startRuntimeLivenessHeartbeat(input: {
  intervalMs?: number;
  onError?: (error: unknown) => void;
  onInputAvailable?: (result: RuntimeLivenessAcceptedResult) => Promise<void> | void;
  onRejected?: (reason: RuntimeLivenessRejectionReason) => void;
  port?: RuntimeLivenessPort | null;
  requestId: string;
  signal?: AbortSignal | null;
  touchTimeoutMs?: number;
}): RuntimeLivenessHeartbeat {
  const port = input.port ?? null;
  if (!port) {
    return {
      initialTouch: Promise.resolve(RUNTIME_LIVENESS_CONTINUE_RESULT),
      async stop() {},
    };
  }

  const intervalMs = input.intervalMs ?? RUNTIME_LIVENESS_DEFAULT_INTERVAL_MS;
  const touchTimeoutMs = Math.min(
    input.touchTimeoutMs ?? RUNTIME_LIVENESS_TOUCH_TIMEOUT_MAX_MS,
    RUNTIME_LIVENESS_TOUCH_TIMEOUT_MAX_MS,
  );
  let currentTouchAbortController: AbortController | null = null;
  let inFlight = false;
  let initialTouchSettled = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolveInitialTouch!: (result: RuntimeLivenessTouchResult) => void;
  const initialTouch = new Promise<RuntimeLivenessTouchResult>((resolve) => {
    resolveInitialTouch = resolve;
  });

  const clearCurrentTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const stop = () => {
    stopped = true;
    clearCurrentTimer();
    currentTouchAbortController?.abort();
    currentTouchAbortController = null;
    settleInitialTouch(RUNTIME_LIVENESS_CONTINUE_RESULT);
  };
  const schedule = (delayMs: number) => {
    if (stopped || input.signal?.aborted) {
      stop();
      return;
    }
    clearCurrentTimer();
    timer = setTimeout(() => {
      void runTouch();
    }, Math.max(0, delayMs));
    timer.unref?.();
  };
  const settleInitialTouch = (result: RuntimeLivenessTouchResult) => {
    if (initialTouchSettled) {
      return;
    }

    initialTouchSettled = true;
    resolveInitialTouch(result);
  };
  const runTouch = async () => {
    if (stopped || input.signal?.aborted) {
      stop();
      return;
    }
    if (inFlight) {
      schedule(intervalMs);
      return;
    }

    inFlight = true;
    const touchAbortController = new AbortController();
    currentTouchAbortController = touchAbortController;
    let timeoutReported = false;
    try {
      const result = await withRuntimeLivenessTouchTimeout(
        port.touch({
          requestId: input.requestId,
          signal: touchAbortController.signal,
        }),
        touchTimeoutMs,
        touchAbortController,
        (error) => {
          timeoutReported = true;
          if (!stopped && !input.signal?.aborted) {
            input.onError?.(error);
          }
        },
      );
      if (!result.ok) {
        settleInitialTouch(result);
        input.onRejected?.(result.reason);
        stop();
        return;
      }
      settleInitialTouch(result);
      const instruction = readRuntimeLivenessInstruction(result);
      if (instruction.kind === "yield" && !stopped && !input.signal?.aborted) {
        void Promise.resolve(input.onInputAvailable?.(result))
          .catch((error: unknown) => {
            if (!stopped && !input.signal?.aborted) {
              input.onError?.(error);
            }
          });
      }
    } catch (error) {
      if (!timeoutReported && !stopped && !input.signal?.aborted) {
        input.onError?.(error);
      }
    } finally {
      if (currentTouchAbortController === touchAbortController) {
        currentTouchAbortController = null;
      }
      inFlight = false;
    }

    schedule(intervalMs);
  };

  if (input.signal) {
    if (input.signal.aborted) {
      stop();
    } else {
      input.signal.addEventListener("abort", stop, { once: true });
    }
  }

  void runTouch();

  return {
    initialTouch,
    async stop() {
      stop();
    },
  };
}

async function withRuntimeLivenessTouchTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  abortController: AbortController,
  onTimeout: (error: Error) => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    timer = setTimeout(() => {
      const timeoutError = new Error("Runtime liveness heartbeat timed out.");
      abortController.abort(timeoutError);
      onTimeout(timeoutError);
    }, Math.max(1, timeoutMs));
    timer.unref?.();
    return await promise;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
