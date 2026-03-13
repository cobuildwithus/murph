import type { PollConnector } from "../connectors/types.js";
import type { InboxPipeline } from "./pipeline.js";
import { createCaptureCheckpoint } from "../shared.js";

export interface RunPollConnectorInput {
  connector: PollConnector;
  pipeline: InboxPipeline;
  accountId?: string | null;
  signal: AbortSignal;
}

export async function runPollConnector({
  connector,
  pipeline,
  accountId = null,
  signal,
}: RunPollConnectorInput): Promise<void> {
  const cursorAccountId = accountId ?? connector.accountId ?? null;
  let cursor = pipeline.runtime.getCursor(connector.source, cursorAccountId);

  const emit = async (capture: Parameters<InboxPipeline["processCapture"]>[0]) => {
    const result = await pipeline.processCapture(capture);
    pipeline.runtime.setCursor(
      connector.source,
      cursorAccountId ?? capture.accountId ?? null,
      createCaptureCheckpoint(capture),
    );
    return result;
  };

  try {
    if (connector.capabilities.backfill) {
      cursor = await connector.backfill(cursor, emit);
      pipeline.runtime.setCursor(connector.source, cursorAccountId, cursor);
    }

    if (!signal.aborted && connector.capabilities.watch) {
      await connector.watch(cursor, emit, signal);
    }
  } finally {
    await connector.close?.();
  }
}

export async function runInboxDaemon(input: {
  pipeline: InboxPipeline;
  connectors: PollConnector[];
  signal: AbortSignal;
}): Promise<void> {
  const controller = new AbortController();
  const releaseAbortRelay = relayAbort(input.signal, controller);
  const runners = input.connectors.map((connector) =>
    runPollConnector({
      connector,
      pipeline: input.pipeline,
      signal: controller.signal,
    }).catch((error: unknown) => {
      controller.abort();
      throw createConnectorFailure(connector, error);
    }),
  );

  try {
    const settled = await Promise.allSettled(runners);
    const failures = settled.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );

    if (failures.length === 1) {
      throw failures[0];
    }

    if (failures.length > 1) {
      throw new AggregateError(failures, "Inbox daemon stopped after connector failures.");
    }
  } finally {
    releaseAbortRelay();
  }
}

function relayAbort(signal: AbortSignal, controller: AbortController): () => void {
  if (signal.aborted) {
    controller.abort();
    return () => {};
  }

  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

function createConnectorFailure(connector: PollConnector, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  const failure = new Error(`Connector "${connector.id}" (${connector.source}) failed: ${detail}`);

  if (error instanceof Error) {
    Object.assign(failure, {
      cause: error,
    });
  }

  return failure;
}
