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
import { executeHostedRuntimeOwnerCommand } from "./runtime-owner-control";
import { getPrisma } from "../prisma";

export type HostedDirectRuntimeWakeTiming = CloudflareHostedControlRuntimeEnsureProcessingTiming & {
  directWakeStartedAtEpochMs: number;
  directWakeAttemptCount: number;
  directWakeRetryWaitMs: number;
};

export type HostedDirectRuntimeWakeSource =
  | "assistant-ask-completion"
  | "assistant-ask-request"
  | "linq"
  | "telegram";

const HOSTED_DIRECT_RUNTIME_WAKE_DEADLINE_MS = 29_000;
const HOSTED_DIRECT_RUNTIME_WAKE_COMMAND_TIMEOUT_MS = 25_000;
const HOSTED_DIRECT_RUNTIME_WAKE_MAX_ATTEMPTS = 2;

/**
 * Starts the control-only Cloudflare latency hint and always settles. Temporal
 * must own the durable mailbox signal. A caller may overlap its acknowledgement
 * only after the signal owner has validated access and started the request.
 */
export function startHostedDirectRuntimeWakeBestEffort(input: {
  onTiming?: (
    timing: HostedDirectRuntimeWakeTiming,
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
      timing: HostedDirectRuntimeWakeTiming,
    ) => Promise<void> | void;
    source: HostedDirectRuntimeWakeSource;
    userId: string;
  };
  wakeSource: HostedDirectRuntimeWakeSource;
}): Promise<void> {
  const client = input.client;
  const onTiming = input.input.onTiming;
  const userId = input.input.userId;
  const wakeSource = input.wakeSource;
  const orchestrationAttemptId = `web-ingress-${randomUUID()}`;
  const directWakeStartedAtEpochMs = Date.now();
  const deadlineAtEpochMs = directWakeStartedAtEpochMs + HOSTED_DIRECT_RUNTIME_WAKE_DEADLINE_MS;
  let directWakeAttemptCount = 0;
  let directWakeRetryWaitMs = 0;
  const signal = AbortSignal.timeout(HOSTED_DIRECT_RUNTIME_WAKE_DEADLINE_MS);
  const timing: { latest: CloudflareHostedControlRuntimeEnsureProcessingTiming | null } = { latest: null };

  try {
    for (
      let attemptNumber = 1;
      attemptNumber <= HOSTED_DIRECT_RUNTIME_WAKE_MAX_ATTEMPTS;
      attemptNumber += 1
    ) {
      signal.throwIfAborted();
      const admission = await executeHostedRuntimeOwnerCommand({
        prisma: getPrisma(), userId, command: { operation: "claim", processingMode: "default" },
      });
      if (admission.cutover !== "postgres" || !admission.owner
        || (admission.status !== "claimed" && admission.status !== "existing")) return;
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
      timing.latest = null;
      directWakeAttemptCount = attemptNumber;
      const ensureResult = await client.ensureRuntimeProcessing({
        admission,
        commandTimeoutMs,
        onTiming: (value) => {
          timing.latest = value;
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
      const retryWaitStartedAtEpochMs = Date.now();
      try {
        await waitForHostedDirectRuntimeWakeRetry(retryDelayMs, signal);
      } finally {
        directWakeRetryWaitMs += Math.max(0, Date.now() - retryWaitStartedAtEpochMs);
      }
    }
  } catch (error) {
    console.warn("Hosted direct ensure wake failed.", {
      errorName: describeHostedExecutionSafeLogErrorCode(error),
      orchestrationAttemptId,
      source: wakeSource,
    });
  } finally {
    if (timing.latest && onTiming) {
      try {
        await onTiming({ ...timing.latest, directWakeStartedAtEpochMs, directWakeAttemptCount, directWakeRetryWaitMs });
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
