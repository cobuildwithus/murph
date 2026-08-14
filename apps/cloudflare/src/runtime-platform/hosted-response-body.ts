import {
  HostedRuntimeControlPlaneFetchError,
  combineAbortSignalsWithCleanup,
  isRetryableHostedRuntimeReplaySafeReadTransportError,
  shouldPreserveHostedRuntimeFetchError,
} from "./control-plane-fetch.ts";

export async function* readHostedRuntimeResponseBodyChunks(input: {
  body: ReadableStream<Uint8Array>;
  description: string;
  signal?: AbortSignal | null;
  timeoutMs: number;
}): AsyncIterable<Uint8Array> {
  const timeoutSignal = input.timeoutMs === 0
    ? AbortSignal.abort(new DOMException("The operation timed out.", "TimeoutError"))
    : AbortSignal.timeout(input.timeoutMs);
  const readSignal = combineAbortSignalsWithCleanup(input.signal ?? null, timeoutSignal);
  const reader = input.body.getReader();
  let streamDone = false;

  try {
    while (true) {
      const next = await readHostedRuntimeResponseBodyChunk({
        reader,
        signal: readSignal.signal,
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

    const wrappedError = new HostedRuntimeControlPlaneFetchError({
      cause: error,
      description: `${input.description} response body read`,
      signalState: {
        callerSignalAborted: input.signal?.aborted ?? false,
        requestSignalAborted: readSignal.signal.aborted,
        timeoutMs: input.timeoutMs,
        timeoutSignalAborted: timeoutSignal.aborted,
      },
    });

    if (isRetryableHostedRuntimeReplaySafeReadTransportError(wrappedError)) {
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

function readHostedRuntimeResponseBodyChunk(input: {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  signal: AbortSignal;
}): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (input.signal.aborted) {
    return Promise.reject(readHostedRuntimeResponseBodyAbortReason(input.signal));
  }

  return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
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
}

function readHostedRuntimeResponseBodyAbortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error
    ? signal.reason
    : signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}
