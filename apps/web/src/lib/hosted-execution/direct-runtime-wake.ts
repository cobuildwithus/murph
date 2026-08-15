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

/**
 * Issues a consent-serialized container start hint and always settles. This
 * does not create a write fence, resolve processing ownership, or invoke
 * workspace work; the ordinary post-Temporal ensure remains authoritative for
 * all of those steps.
 */
export function startHostedRuntimeShellPrewarmBestEffort(input: {
  source: "linq-instant-start" | "linq-typing-started";
  userId: string;
}): Promise<void> {
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
        source: input.source,
        userId: input.userId,
      })
      .then((result) => {
        console.info("Hosted runtime shell prewarm accepted.", {
          accepted: result.accepted,
          source: wakeSource,
        });
      })
      .catch((error: unknown) => {
        console.warn("Hosted runtime shell prewarm failed.", {
          errorName: describeHostedExecutionSafeLogErrorCode(error),
          source: wakeSource,
        });
      });
  } catch (error) {
    console.warn("Hosted runtime shell prewarm failed.", {
      errorName: describeHostedExecutionSafeLogErrorCode(error),
      source: wakeSource,
    });
    return Promise.resolve();
  }
}

/**
 * Starts the payloadless Cloudflare latency hint and always settles. Temporal
 * must accept the durable mailbox signal before a caller invokes this helper.
 */
export function startHostedDirectRuntimeWakeBestEffort(input: {
  onTiming?: (
    timing: CloudflareHostedControlRuntimeEnsureProcessingTiming,
  ) => Promise<void> | void;
  source: HostedDirectRuntimeWakeSource;
  userId: string;
}): Promise<void> {
  const wakeSource = input.source;
  let client: ReturnType<typeof readHostedExecutionControlClientIfConfigured>;
  try {
    client = readHostedExecutionControlClientIfConfigured();
  } catch (error) {
    console.warn("Hosted direct ensure wake client is misconfigured.", {
      errorName: describeHostedExecutionSafeLogErrorCode(error),
      source: wakeSource,
    });
    return Promise.resolve();
  }
  if (!client) {
    return Promise.resolve();
  }

  try {
    return runHostedDirectRuntimeWakeBestEffort({
      client,
      input,
      wakeSource,
    });
  } catch (error) {
    console.warn("Hosted direct ensure wake failed.", {
      errorName: describeHostedExecutionSafeLogErrorCode(error),
      source: wakeSource,
    });
    return Promise.resolve();
  }
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
  wakeSource: HostedDirectRuntimeWakeSource;
}): Promise<void> {
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
          source: input.wakeSource,
        });
        return;
      }

      // Do not persist the previous parsed result if a later attempted request
      // fails before returning a parseable control response.
      timing = null;
      const ensureResult = await input.client.ensureRuntimeProcessing({
        commandTimeoutMs,
        onTiming: (value) => {
          timing = value;
        },
        orchestrationAttemptId,
        signal,
        userId: input.input.userId,
      });
      if (!("kind" in ensureResult)) {
        console.info("Hosted direct ensure wake accepted.", {
          accepted: ensureResult.accepted,
          attemptNumber,
          orchestrationAttemptId,
          source: input.wakeSource,
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
        source: input.wakeSource,
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
          source: input.wakeSource,
        });
        return;
      }

      console.info("Hosted direct ensure wake retry scheduled.", {
        attemptNumber,
        orchestrationAttemptId,
        retryDelayMs,
        source: input.wakeSource,
      });
      await waitForHostedDirectRuntimeWakeRetry(retryDelayMs, signal);
    }
  } catch (error) {
    console.warn("Hosted direct ensure wake failed.", {
      errorName: describeHostedExecutionSafeLogErrorCode(error),
      orchestrationAttemptId,
      source: input.wakeSource,
    });
  } finally {
    if (timing && input.input.onTiming) {
      try {
        await input.input.onTiming(timing);
      } catch (error) {
        console.warn("Hosted direct ensure wake timing callback failed.", {
          errorName: describeHostedExecutionSafeLogErrorCode(error),
          orchestrationAttemptId,
          source: input.wakeSource,
        });
      }
    }
  }
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
