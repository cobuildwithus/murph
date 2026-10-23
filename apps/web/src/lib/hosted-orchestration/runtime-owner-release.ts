import { signalHostedRuntimeOwnerReleasedRuntime, signalHostedRuntimeRecheckRuntime } from "./signal-runtime";

/** An attempt ended: Temporal must reread facts even when no work is due now.
 * The caller must commit ownership first. */
export async function signalHostedRuntimeOwnerRelease(input: {
  userId: string;
  runtimeAttemptId: string | null;
  abortSignal?: AbortSignal;
}): Promise<boolean> {
  input.abortSignal?.throwIfAborted();
  if (input.runtimeAttemptId === null) {
    await signalHostedRuntimeRecheckRuntime({ userId: input.userId, abortSignal: input.abortSignal });
  } else {
    await signalHostedRuntimeOwnerReleasedRuntime({ userId: input.userId, runtimeAttemptId: input.runtimeAttemptId,
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}) });
  }
  return true;
}

/** Keep completion successful when the advisory signal fails or stalls. The
 * existing accepted-attempt recheck recovers missed hints. */
export async function notifyHostedRuntimeOwnerCompletion(input: {
  userId: string;
  runtimeAttemptId: string;
}): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      signalHostedRuntimeOwnerRelease({ ...input, abortSignal: controller.signal }),
      new Promise<void>(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve(); }, 2_000);
      }),
    ]);
  } catch {
    // Ownership is already durable; signaling cannot invalidate completion.
  } finally {
    clearTimeout(timer);
  }
}
