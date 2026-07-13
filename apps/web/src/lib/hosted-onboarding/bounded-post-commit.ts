export const HOSTED_POST_COMMIT_TIMEOUT_MS = 5_000;

export function createHostedPostCommitDeadline(
  timeoutMs: number | undefined,
): number {
  return Date.now() + normalizeHostedPostCommitTimeoutMs(timeoutMs);
}

export function readHostedPostCommitRemainingMs(deadlineMs: number): number {
  return Math.max(1, deadlineMs - Date.now());
}

export async function waitForHostedPostCommitOperation<T>(input: {
  deadlineMs: number;
  operation: (signal: AbortSignal) => Promise<T>;
  signal?: AbortSignal;
}): Promise<T> {
  throwIfHostedPostCommitAborted(input.signal);

  const remainingMs = readHostedPostCommitRemainingMs(input.deadlineMs);
  if (input.deadlineMs <= Date.now()) {
    throw createHostedPostCommitTimeoutError(remainingMs);
  }
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => {
    timeoutController.abort(createHostedPostCommitTimeoutError(remainingMs));
  }, remainingMs);
  const waitSignal = input.signal
    ? AbortSignal.any([input.signal, timeoutController.signal])
    : timeoutController.signal;
  const operation = input.operation(waitSignal);
  operation.catch(() => undefined);
  const aborted = new Promise<never>((_, reject) => {
    const rejectFromSignal = () => reject(createHostedPostCommitAbortError(waitSignal));
    if (waitSignal.aborted) {
      rejectFromSignal();
      return;
    }
    waitSignal.addEventListener("abort", rejectFromSignal, { once: true });
  });

  try {
    return await Promise.race([operation, aborted]);
  } finally {
    clearTimeout(timeout);
    if (!timeoutController.signal.aborted) {
      timeoutController.abort();
    }
  }
}

function normalizeHostedPostCommitTimeoutMs(timeoutMs: number | undefined): number {
  if (
    typeof timeoutMs !== "number"
    || !Number.isFinite(timeoutMs)
    || timeoutMs <= 0
  ) {
    return HOSTED_POST_COMMIT_TIMEOUT_MS;
  }
  return Math.ceil(timeoutMs);
}

function throwIfHostedPostCommitAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createHostedPostCommitAbortError(signal);
  }
}

function createHostedPostCommitAbortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason;
  }
  const error = new Error("Hosted post-commit handoff was aborted.");
  error.name = "AbortError";
  return error;
}

function createHostedPostCommitTimeoutError(timeoutMs: number): Error {
  const error = new Error(`Hosted post-commit handoff timed out after ${timeoutMs}ms.`);
  error.name = "TimeoutError";
  return error;
}
