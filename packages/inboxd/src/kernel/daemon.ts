import type { PollConnector } from "../connectors/types.js";
import type { InboxPipeline } from "./pipeline.js";
import { createCaptureCheckpoint } from "../shared.js";

const DEFAULT_CONNECTOR_RESTART_DELAY_MS = 1_000;
const DEFAULT_MAX_CONNECTOR_RESTART_DELAY_MS = 30_000;

export interface RunPollConnectorInput {
  connector: PollConnector;
  pipeline: InboxPipeline;
  accountId?: string | null;
  signal: AbortSignal;
  restartConnectorOnFailure?: boolean;
  connectorRestartDelayMs?: number;
  maxConnectorRestartDelayMs?: number;
}

export async function runPollConnector({
  connector,
  pipeline,
  accountId = null,
  signal,
  restartConnectorOnFailure = false,
  connectorRestartDelayMs = DEFAULT_CONNECTOR_RESTART_DELAY_MS,
  maxConnectorRestartDelayMs = DEFAULT_MAX_CONNECTOR_RESTART_DELAY_MS,
}: RunPollConnectorInput): Promise<void> {
  const cursorAccountId = accountId ?? connector.accountId ?? null;
  const normalizedRestartDelayMs = normalizeRestartDelay(
    connectorRestartDelayMs,
    "Connector restart delay",
  );
  const normalizedMaxRestartDelayMs = normalizeRestartDelay(
    maxConnectorRestartDelayMs,
    "Connector max restart delay",
  );
  if (normalizedMaxRestartDelayMs < normalizedRestartDelayMs) {
    throw new TypeError("Connector max restart delay must be at least the restart delay.");
  }
  let cursor = pipeline.runtime.getCursor(connector.source, cursorAccountId);

  const emit = async (
    capture: Parameters<InboxPipeline["processCapture"]>[0],
    checkpoint?: Record<string, unknown> | null,
  ) => {
    const result = await pipeline.processCapture(capture);
    const nextCursor =
      checkpoint === undefined ? createCaptureCheckpoint(capture) : checkpoint;
    cursor = nextCursor;
    pipeline.runtime.setCursor(
      connector.source,
      cursorAccountId ?? capture.accountId ?? null,
      nextCursor,
    );
    return result;
  };

  try {
    if (connector.capabilities.backfill) {
      cursor = await connector.backfill(cursor, emit);
      pipeline.runtime.setCursor(connector.source, cursorAccountId, cursor);
    }

    if (!signal.aborted && connector.capabilities.watch) {
      let nextRestartDelayMs = normalizedRestartDelayMs;

      while (!signal.aborted) {
        try {
          await connector.watch(cursor, emit, signal);
          break;
        } catch (error) {
          if (!restartConnectorOnFailure || signal.aborted) {
            throw error;
          }

          try {
            await connector.close?.();
          } catch (closeError) {
            throw createConnectorRestartCleanupError(error, closeError);
          }

          await waitForAbortOrTimeout(signal, nextRestartDelayMs);
          nextRestartDelayMs = Math.min(
            nextRestartDelayMs * 2,
            normalizedMaxRestartDelayMs,
          );
        }
      }
    }
  } finally {
    await connector.close?.();
  }
}

export async function runInboxDaemon(input: {
  pipeline: InboxPipeline;
  connectors: PollConnector[];
  signal: AbortSignal;
  continueOnConnectorFailure?: boolean;
  restartConnectorOnFailure?: boolean;
  connectorRestartDelayMs?: number;
  maxConnectorRestartDelayMs?: number;
}): Promise<void> {
  const controller = new AbortController();
  const releaseAbortRelay = relayAbort(input.signal, controller);
  const continueOnConnectorFailure = input.continueOnConnectorFailure ?? false;
  const runners = input.connectors.map((connector) =>
    runPollConnector({
      connector,
      pipeline: input.pipeline,
      signal: controller.signal,
      restartConnectorOnFailure: input.restartConnectorOnFailure ?? false,
      connectorRestartDelayMs: input.connectorRestartDelayMs,
      maxConnectorRestartDelayMs: input.maxConnectorRestartDelayMs,
    }).catch((error: unknown) => {
      if (!continueOnConnectorFailure) {
        controller.abort();
      }
      throw createConnectorFailure(connector, error);
    }),
  );

  try {
    const settled = await Promise.allSettled(runners);
    const failures = settled.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );

    if (failures.length === 0) {
      return;
    }

    if (!continueOnConnectorFailure || failures.length === settled.length) {
      if (failures.length === 1) {
        throw failures[0];
      }

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

function createConnectorRestartCleanupError(
  originalError: unknown,
  cleanupError: unknown,
): AggregateError {
  const originalDetail =
    originalError instanceof Error ? originalError.message : String(originalError);
  const cleanupDetail =
    cleanupError instanceof Error ? cleanupError.message : String(cleanupError);

  return new AggregateError(
    [originalError, cleanupError],
    `Connector watch failed (${originalDetail}) and cleanup before restart also failed (${cleanupDetail}).`,
  );
}

function normalizeRestartDelay(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 1) {
    throw new TypeError(`${label} must be at least 1ms.`);
  }

  return Math.floor(value);
}

async function waitForAbortOrTimeout(
  signal: AbortSignal,
  milliseconds: number,
): Promise<void> {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);

    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}
