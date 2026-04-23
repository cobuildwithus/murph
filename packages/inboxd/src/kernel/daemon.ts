import type { Cursor, PollConnector } from "../connectors/types.ts";
import type { InboxPipeline } from "./pipeline.ts";
import { createCaptureCheckpoint, relayAbort, waitForAbortOrTimeout } from "../shared.ts";

const DEFAULT_CONNECTOR_RESTART_BACKOFF_MS = Object.freeze([1_000, 5_000, 15_000, 30_000]);
const DEFAULT_CONNECTOR_RESTART_DELAY_MS = 1_000;
const DEFAULT_MAX_CONNECTOR_RESTART_DELAY_MS = 30_000;

export interface ConnectorRestartPolicy {
  enabled?: boolean;
  backoffMs?: readonly number[];
  maxAttempts?: number | null;
}

interface ResolvedConnectorRestartPolicy {
  enabled: boolean;
  backoffMs: readonly number[];
  maxAttempts: number | null;
}

export interface RunPollConnectorInput {
  connector: PollConnector;
  pipeline: InboxPipeline;
  accountId?: string | null;
  signal: AbortSignal;
  restartConnectorOnFailure?: boolean;
  connectorRestartDelayMs?: number;
  maxConnectorRestartDelayMs?: number;
}

export interface RunPollConnectorBackfillInput {
  connector: PollConnector;
  pipeline: InboxPipeline;
  accountId?: string | null;
}

export interface RunPollConnectorBackfillResult {
  cursor: Cursor | null;
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
  const cursorState = createPollConnectorCursorState({
    connector,
    pipeline,
    accountId: cursorAccountId,
  });

  try {
    if (connector.capabilities.backfill) {
      cursorState.writeTerminalCursor(
        await connector.backfill(cursorState.getCursor(), cursorState.emit),
      );
    }

    if (!signal.aborted && connector.capabilities.watch) {
      let nextRestartDelayMs = normalizedRestartDelayMs;

      while (!signal.aborted) {
        try {
          await connector.watch(
            cursorState.getCursor(),
            cursorState.emit,
            signal,
          );
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

export async function runPollConnectorBackfill({
  connector,
  pipeline,
  accountId = null,
}: RunPollConnectorBackfillInput): Promise<RunPollConnectorBackfillResult> {
  const cursorState = createPollConnectorCursorState({
    connector,
    pipeline,
    accountId,
  });

  try {
    if (!connector.capabilities.backfill) {
      return { cursor: cursorState.getCursor() };
    }

    return {
      cursor: cursorState.writeTerminalCursor(
        await connector.backfill(cursorState.getCursor(), cursorState.emit),
        {
          preserveLatestEmittedCursor: true,
        },
      ),
    };
  } finally {
    await connector.close?.();
  }
}

export async function runInboxDaemon(input: {
  pipeline: InboxPipeline;
  connectors: PollConnector[];
  signal: AbortSignal;
  continueOnConnectorFailure?: boolean;
  connectorRestartPolicy?: ConnectorRestartPolicy;
}): Promise<void> {
  const controller = new AbortController();
  const releaseAbortRelay = relayAbort(input.signal, controller);
  const continueOnConnectorFailure = input.continueOnConnectorFailure ?? false;
  const connectorRestartPolicy = resolveConnectorRestartPolicy(
    input.connectorRestartPolicy,
  );
  const runners = input.connectors.map((connector) =>
    runConnectorWithRestart({
      connector,
      pipeline: input.pipeline,
      signal: controller.signal,
      restartPolicy: connectorRestartPolicy,
    }).catch((error: unknown) => {
      if (!continueOnConnectorFailure) {
        controller.abort();
      }
      throw error;
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

async function runConnectorWithRestart(input: {
  connector: PollConnector;
  pipeline: InboxPipeline;
  signal: AbortSignal;
  restartPolicy: ResolvedConnectorRestartPolicy;
}): Promise<void> {
  let restartAttempts = 0;

  while (true) {
    if (input.signal.aborted) {
      return;
    }

    try {
      await runPollConnector({
        connector: input.connector,
        pipeline: input.pipeline,
        signal: input.signal,
      });
      return;
    } catch (error) {
      if (input.signal.aborted) {
        return;
      }

      if (!shouldRetryConnectorFailure(input.restartPolicy, restartAttempts)) {
        throw createConnectorFailure(input.connector, error);
      }

      restartAttempts += 1;
      await waitForAbortOrTimeout(
        input.signal,
        resolveConnectorRestartDelayMs(input.restartPolicy, restartAttempts),
      );
    }
  }
}

function createPollConnectorCursorState(input: {
  connector: PollConnector;
  pipeline: InboxPipeline;
  accountId?: string | null;
}) {
  const cursorAccountId = input.accountId ?? input.connector.accountId ?? null;
  let cursor = input.pipeline.runtime.getCursor(
    input.connector.source,
    cursorAccountId,
  );

  return {
    emit: async (
      capture: Parameters<InboxPipeline["processCapture"]>[0],
      checkpoint?: Cursor | null,
    ) => {
      const result = await input.pipeline.processCapture(capture);
      const nextCursor =
        checkpoint === undefined
          ? createCaptureCheckpoint(capture)
          : (checkpoint ?? null);
      cursor = nextCursor;
      input.pipeline.runtime.setCursor(
        input.connector.source,
        cursorAccountId ?? capture.accountId ?? null,
        nextCursor,
      );
      return result;
    },
    getCursor: (): Cursor | null => cursor,
    writeTerminalCursor: (
      nextCursor: Cursor | null,
      options?: {
        preserveLatestEmittedCursor?: boolean;
      },
    ): Cursor | null => {
      const resolvedCursor =
        nextCursor === null && options?.preserveLatestEmittedCursor
          ? cursor ?? null
          : nextCursor;
      cursor = resolvedCursor;
      input.pipeline.runtime.setCursor(
        input.connector.source,
        cursorAccountId,
        resolvedCursor,
      );
      return resolvedCursor;
    },
  };
}

function shouldRetryConnectorFailure(
  policy: ResolvedConnectorRestartPolicy,
  restartAttempts: number,
): boolean {
  if (!policy.enabled) {
    return false;
  }

  return policy.maxAttempts === null || restartAttempts < policy.maxAttempts;
}

function resolveConnectorRestartDelayMs(
  policy: ResolvedConnectorRestartPolicy,
  restartAttempt: number,
): number {
  const index = Math.min(
    Math.max(restartAttempt - 1, 0),
    policy.backoffMs.length - 1,
  );

  return policy.backoffMs[index] ?? policy.backoffMs[policy.backoffMs.length - 1] ?? 0;
}

function resolveConnectorRestartPolicy(
  policy: ConnectorRestartPolicy | undefined,
): ResolvedConnectorRestartPolicy {
  return {
    enabled: policy?.enabled ?? false,
    backoffMs: normalizeRestartBackoffMs(policy?.backoffMs),
    maxAttempts: normalizeRestartMaxAttempts(policy?.maxAttempts),
  };
}

function normalizeRestartBackoffMs(
  value?: readonly number[],
): readonly number[] {
  if (!value || value.length === 0) {
    return DEFAULT_CONNECTOR_RESTART_BACKOFF_MS;
  }

  const normalized = value
    .map((entry) => Math.max(0, Math.floor(entry)))
    .filter((entry) => Number.isFinite(entry));

  return normalized.length > 0
    ? Object.freeze(normalized)
    : DEFAULT_CONNECTOR_RESTART_BACKOFF_MS;
}

function normalizeRestartMaxAttempts(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.floor(value));
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
