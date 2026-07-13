import { start } from "workflow/api";

import { waitForAbortableSettlement } from "./abortable-settlement";
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
      ? await waitForAbortableSettlement(pendingStart, input.signal)
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
