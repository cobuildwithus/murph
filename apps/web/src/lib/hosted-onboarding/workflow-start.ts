import { start } from "workflow/api";

import { hostedOnboardingError } from "./errors";

type HostedPointerWorkflow<TInput> = (input: TInput) => Promise<unknown>;

export async function startHostedPointerWorkflow<TInput>(input: {
  error: {
    code: string;
    message: string;
  };
  payload: TInput;
  signal?: AbortSignal;
  workflow: HostedPointerWorkflow<TInput>;
}): Promise<{ runId: string }> {
  try {
    input.signal?.throwIfAborted();
    const pendingStart = start(input.workflow, [input.payload]);
    const run = input.signal
      ? await waitForHostedWorkflowStart(pendingStart, input.signal)
      : await pendingStart;

    return {
      runId: run.runId,
    };
  } catch {
    throw hostedOnboardingError({
      code: input.error.code,
      httpStatus: 503,
      message: input.error.message,
      retryable: true,
    });
  }
}

async function waitForHostedWorkflowStart<T>(
  pendingStart: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const removeAbortListener = () => {
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      removeAbortListener();
      reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    pendingStart.then(
      (run) => {
        removeAbortListener();
        resolve(run);
      },
      (error: unknown) => {
        removeAbortListener();
        reject(error);
      },
    );
    if (signal.aborted) {
      onAbort();
    }
  });
}
