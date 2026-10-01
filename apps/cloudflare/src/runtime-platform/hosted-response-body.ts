import {
  HostedRuntimeControlPlaneFetchError,
  combineAbortSignalsWithCleanup,
  isRetryableHostedRuntimeReplaySafeReadTransportError,
  shouldPreserveHostedRuntimeFetchError,
} from "./control-plane-fetch.ts";

// Only the snapshot restore owner retries inactivity; ordinary control reads
// retain their existing non-retryable timeout contract.
export class HostedRuntimeResponseBodyIdleTimeoutError extends HostedRuntimeControlPlaneFetchError {}

export async function* readHostedRuntimeResponseBodyChunks(input: {
  body: ReadableStream<Uint8Array>;
  description: string;
  signal?: AbortSignal | null;
  timeoutMs: number;
  readTimeoutMs?: number;
  timing?: { readWaitMs: number; maxReadWaitMs: number };
}): AsyncIterable<Uint8Array> {
  const timeoutSignal = input.timeoutMs === 0
    ? AbortSignal.abort(new DOMException("The operation timed out.", "TimeoutError"))
    : AbortSignal.timeout(input.timeoutMs);
  const idleTimeout = new AbortController();
  const readSignal = combineAbortSignalsWithCleanup(
    input.signal ?? null,
    AbortSignal.any([timeoutSignal, idleTimeout.signal]),
  );
  const reader = input.body.getReader();
  let streamDone = false;

  try {
    while (true) {
      const next = await readHostedRuntimeResponseBodyChunk({
        reader,
        signal: readSignal.signal,
        idleTimeout,
        readTimeoutMs: input.readTimeoutMs,
        timing: input.timing,
      });
      if (next.done) {
        streamDone = true;
        break;
      }
      yield next.value;
    }
  } catch (error) {
    if (shouldPreserveHostedRuntimeFetchError(error)) {
      throw error;
    }

    const FetchError = idleTimeout.signal.aborted
        && !input.signal?.aborted && !timeoutSignal.aborted
      ? HostedRuntimeResponseBodyIdleTimeoutError
      : HostedRuntimeControlPlaneFetchError;
    const wrappedError = new FetchError({
      cause: error,
      description: `${input.description} response body read`,
      signalState: {
        callerSignalAborted: input.signal?.aborted ?? false,
        requestSignalAborted: readSignal.signal.aborted,
        timeoutMs: idleTimeout.signal.aborted ? (input.readTimeoutMs ?? input.timeoutMs) : input.timeoutMs,
        timeoutSignalAborted: timeoutSignal.aborted || idleTimeout.signal.aborted,
      },
    });

    if (
      wrappedError instanceof HostedRuntimeResponseBodyIdleTimeoutError
      || isRetryableHostedRuntimeReplaySafeReadTransportError(wrappedError)
    ) {
      throw wrappedError;
    }

    throw error;
  } finally {
    if (!streamDone) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
    readSignal.dispose();
  }
}

async function readHostedRuntimeResponseBodyChunk(input: {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  signal: AbortSignal;
  idleTimeout: AbortController;
  readTimeoutMs?: number;
  timing?: { readWaitMs: number; maxReadWaitMs: number };
}): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (input.signal.aborted) {
    return Promise.reject(readHostedRuntimeResponseBodyAbortReason(input.signal));
  }

  // Cover only the pending read; consumer processing between yields is excluded.
  const startedAt = Date.now();
  const timer = input.readTimeoutMs === undefined ? undefined : setTimeout(() => {
    input.idleTimeout.abort(new DOMException("Response body read timed out.", "TimeoutError"));
  }, input.readTimeoutMs);
  try {
    return await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
      let settled = false;
      const settle = (run: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        input.signal.removeEventListener("abort", abort);
        run();
      };
      const abort = () => {
        settle(() => reject(readHostedRuntimeResponseBodyAbortReason(input.signal)));
      };
      input.signal.addEventListener("abort", abort, { once: true });
      input.reader.read().then(
        (result) => settle(() => resolve(result)),
        (error: unknown) => settle(() => reject(error)),
      );
    });
  } finally {
    clearTimeout(timer);
    if (input.timing) {
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      input.timing.readWaitMs += elapsedMs;
      input.timing.maxReadWaitMs = Math.max(input.timing.maxReadWaitMs, elapsedMs);
    }
  }
}

function readHostedRuntimeResponseBodyAbortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error
    ? signal.reason
    : signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}
