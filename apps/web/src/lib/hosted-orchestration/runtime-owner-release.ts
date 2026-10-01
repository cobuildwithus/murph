import { readHostedRuntimeOwnerReleaseActionable } from "./runtime-reconciliation-facts";
import { signalHostedRuntimeOwnerReleasedRuntime, signalHostedRuntimeRecheckRuntime } from "./signal-runtime";

/** Advisory scheduling only; the caller must commit ownership first. */
export async function signalHostedRuntimeOwnerRelease(input: {
  userId: string;
  runtimeAttemptId: string | null;
  immediateRecheckRequested: boolean;
  abortSignal?: AbortSignal;
}): Promise<boolean> {
  if (!input.immediateRecheckRequested
    && !(await readHostedRuntimeOwnerReleaseActionable({ userId: input.userId }))) return false;
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
  immediateRecheckRequested: boolean;
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
