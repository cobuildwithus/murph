import { randomUUID } from "node:crypto";

import type {
  CloudflareHostedControlRuntimeEnsureProcessingTiming,
} from "@murphai/cloudflare-hosted-control/client";
import {
  HOSTED_RUNTIME_PROCESSING_COMMAND_RESPONSE_MARGIN_MS,
  MIN_HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS,
} from "@murphai/hosted-execution/contracts";

import { readHostedExecutionControlClientIfConfigured } from "./control";
import { describeHostedExecutionSafeLogErrorCode } from "./logging";

export type HostedDirectRuntimeWakeSource =
  | "assistant-ask-completion"
  | "assistant-ask-request"
  | "linq";

const HOSTED_DIRECT_RUNTIME_WAKE_DEADLINE_MS = 29_000;
const HOSTED_DIRECT_RUNTIME_WAKE_COMMAND_TIMEOUT_MS = 25_000;
const HOSTED_DIRECT_RUNTIME_WAKE_MAX_ATTEMPTS = 2;
const HOSTED_DIRECT_RUNTIME_WAKE_DISPATCH_WAIT_MS = 1_000;

export interface HostedDirectRuntimeWake {
  completion: Promise<void>;
  readyForTemporal: Promise<void>;
}

/**
 * Issues a consent-serialized container start hint and always settles. This
 * does not create a write fence, resolve processing ownership, or invoke
 * workspace work; the ordinary post-commit ensure remains authoritative for
 * all of those steps.
 */
export function startHostedRuntimeShellPrewarmBestEffort(input: {
  orchestrationAttemptId?: string;
  source:
    | "linq-instant-start"
    | "linq-message-routing"
    | "linq-typing-started";
  userId: string;
}): Promise<void> {
  const orchestrationAttemptId = input.orchestrationAttemptId
    ?? `web-prewarm-${randomUUID()}`;
  const requestStartedAtEpochMs = Date.now();
  const wakeSource = input.source;
  let client: ReturnType<typeof readHostedExecutionControlClientIfConfigured>;
  try {
    client = readHostedExecutionControlClientIfConfigured();
  } catch (error) {
    console.warn("Hosted runtime shell prewarm client is misconfigured.", {
      errorName: describeHostedExecutionSafeLogErrorCode(error),
      source: wakeSource,
    });
    return Promise.resolve();
  }
  if (!client) {
    return Promise.resolve();
  }

  try {
    return client
      .prewarmRuntimeShell({
        orchestrationAttemptId,
        requestStartedAtEpochMs,
        source: input.source,
        userId: input.userId,
      })
      .then((result) => {
        console.info("Hosted runtime shell prewarm accepted.", {
          accepted: result.accepted,
          orchestrationAttemptId,
          source: wakeSource,
        });
      })
      .catch((error: unknown) => {
        console.warn("Hosted runtime shell prewarm failed.", {
          errorName: describeHostedExecutionSafeLogErrorCode(error),
          orchestrationAttemptId,
          source: wakeSource,
        });
      });
  } catch (error) {
    console.warn("Hosted runtime shell prewarm failed.", {
      errorName: describeHostedExecutionSafeLogErrorCode(error),
      orchestrationAttemptId,
      source: wakeSource,
    });
    return Promise.resolve();
  }
}

/**
 * Starts the payloadless Cloudflare latency hint after the corresponding
 * mailbox work has committed. `readyForTemporal` settles after the first
 * request dispatches, the wake safely completes without dispatching, or the
 * short dispatch-only wait expires. `completion` always settles independently;
 * Temporal remains the durable recovery owner.
 */
export function startHostedDirectRuntimeWakeBestEffort(input: {
  onTiming?: (
    timing: CloudflareHostedControlRuntimeEnsureProcessingTiming,
  ) => Promise<void> | void;
  source: HostedDirectRuntimeWakeSource;
  userId: string;
}): HostedDirectRuntimeWake {
  const wakeSource = input.source;
  let client: ReturnType<typeof readHostedExecutionControlClientIfConfigured>;
  try {
    client = readHostedExecutionControlClientIfConfigured();
  } catch (error) {
    console.warn("Hosted direct ensure wake client is misconfigured.", {
      errorName: describeHostedExecutionSafeLogErrorCode(error),
      source: wakeSource,
    });
    return completedHostedDirectRuntimeWake();
  }
  if (!client) {
    return completedHostedDirectRuntimeWake();
  }

  try {
    let resolveRequestDispatched!: () => void;
    const requestDispatched = new Promise<void>((resolve) => {
      resolveRequestDispatched = resolve;
    });
    const completion = runHostedDirectRuntimeWakeBestEffort({
      client,
      input,
      onRequestDispatched: resolveRequestDispatched,
      wakeSource,
    });
    void completion.then(resolveRequestDispatched, resolveRequestDispatched);
    return {
      completion,
      readyForTemporal: waitForHostedDirectRuntimeWakeDispatch(requestDispatched),
    };
  } catch (error) {
    console.warn("Hosted direct ensure wake failed.", {
      errorName: describeHostedExecutionSafeLogErrorCode(error),
      source: wakeSource,
    });
    return completedHostedDirectRuntimeWake();
  }
}

function completedHostedDirectRuntimeWake(): HostedDirectRuntimeWake {
  const completion = Promise.resolve();
  return { completion, readyForTemporal: completion };
}

async function runHostedDirectRuntimeWakeBestEffort(input: {
  client: NonNullable<ReturnType<typeof readHostedExecutionControlClientIfConfigured>>;
  input: {
    onTiming?: (
      timing: CloudflareHostedControlRuntimeEnsureProcessingTiming,
    ) => Promise<void> | void;
    source: HostedDirectRuntimeWakeSource;
    userId: string;
  };
  onRequestDispatched: () => void;
  wakeSource: HostedDirectRuntimeWakeSource;
}): Promise<void> {
  const client = input.client;
  const onTiming = input.input.onTiming;
  const userId = input.input.userId;
  const wakeSource = input.wakeSource;
  const orchestrationAttemptId = `web-ingress-${randomUUID()}`;
  const deadlineAtEpochMs = Date.now() + HOSTED_DIRECT_RUNTIME_WAKE_DEADLINE_MS;
  const signal = AbortSignal.timeout(HOSTED_DIRECT_RUNTIME_WAKE_DEADLINE_MS);
  let timing: CloudflareHostedControlRuntimeEnsureProcessingTiming | null = null;

  try {
    for (
      let attemptNumber = 1;
      attemptNumber <= HOSTED_DIRECT_RUNTIME_WAKE_MAX_ATTEMPTS;
      attemptNumber += 1
    ) {
      const commandTimeoutMs = Math.min(
        HOSTED_DIRECT_RUNTIME_WAKE_COMMAND_TIMEOUT_MS,
        deadlineAtEpochMs - Date.now()
          - HOSTED_RUNTIME_PROCESSING_COMMAND_RESPONSE_MARGIN_MS,
      );
      if (commandTimeoutMs < MIN_HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS) {
        console.info("Hosted direct ensure wake retry skipped.", {
          attemptNumber,
          orchestrationAttemptId,
          reason: "deadline_exhausted",
          source: wakeSource,
        });
        return;
      }

      // Do not persist the previous parsed result if a later attempted request
      // fails before returning a parseable control response.
      timing = null;
      const ensureResult = await client.ensureRuntimeProcessing({
        commandTimeoutMs,
        onRequestDispatched: input.onRequestDispatched,
        onTiming: (value) => {
          timing = value;
        },
        orchestrationAttemptId,
        signal,
        userId,
      });
      if (!("kind" in ensureResult)) {
        console.info("Hosted direct ensure wake accepted.", {
          accepted: ensureResult.accepted,
          attemptNumber,
          orchestrationAttemptId,
          source: wakeSource,
        });
        return;
      }

      console.info("Hosted direct ensure wake completed.", {
        attemptNumber,
        kind: ensureResult.kind,
        orchestrationAttemptId,
        ...(ensureResult.kind === "runtime_processing_accepted"
          ? { action: ensureResult.action }
          : {}),
        source: wakeSource,
      });
      if (
        ensureResult.kind !== "retry_later"
        || attemptNumber === HOSTED_DIRECT_RUNTIME_WAKE_MAX_ATTEMPTS
      ) {
        return;
      }

      const retryAtEpochMs = Date.parse(ensureResult.retryAt);
      const retryDelayMs = Number.isFinite(retryAtEpochMs)
        ? Math.max(0, retryAtEpochMs - Date.now())
        : Number.POSITIVE_INFINITY;
      const remainingAfterDelayMs = deadlineAtEpochMs - Date.now() - retryDelayMs;
      if (
        !Number.isFinite(retryDelayMs)
        || remainingAfterDelayMs
          < MIN_HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS
            + HOSTED_RUNTIME_PROCESSING_COMMAND_RESPONSE_MARGIN_MS
      ) {
        console.info("Hosted direct ensure wake retry skipped.", {
          attemptNumber,
          orchestrationAttemptId,
          reason: "retry_outside_deadline",
          source: wakeSource,
        });
        return;
      }

      console.info("Hosted direct ensure wake retry scheduled.", {
        attemptNumber,
        orchestrationAttemptId,
        retryDelayMs,
        source: wakeSource,
      });
      await waitForHostedDirectRuntimeWakeRetry(retryDelayMs, signal);
    }
  } catch (error) {
    console.warn("Hosted direct ensure wake failed.", {
      errorName: describeHostedExecutionSafeLogErrorCode(error),
      orchestrationAttemptId,
      source: wakeSource,
    });
  } finally {
    if (timing && onTiming) {
      try {
        await onTiming(timing);
      } catch (error) {
        console.warn("Hosted direct ensure wake timing callback failed.", {
          errorName: describeHostedExecutionSafeLogErrorCode(error),
          orchestrationAttemptId,
          source: wakeSource,
        });
      }
    }
  }
}

function waitForHostedDirectRuntimeWakeDispatch(
  requestDispatched: Promise<void>,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(
      finish,
      HOSTED_DIRECT_RUNTIME_WAKE_DISPATCH_WAIT_MS,
    );
    void requestDispatched.then(finish, finish);
  });
}

function waitForHostedDirectRuntimeWakeRetry(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  if (delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
