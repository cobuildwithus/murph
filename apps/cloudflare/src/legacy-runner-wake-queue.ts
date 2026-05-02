import {
  emitHostedExecutionStructuredLog,
  type HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";

import type {
  WorkerQueueMessageBatchLike,
} from "./worker-contracts.ts";
import {
  resolveUserRunnerStub,
  type WorkerEnvironmentSource,
} from "./worker-routes/shared.ts";

export const LEGACY_RUNNER_WAKE_QUEUE_NAME = "murph-hosted-runner-wake";
export const HOSTED_RUNNER_WAKE_QUEUE_MESSAGE_SCHEMA = "murph.hosted-runner.wake.v1";

const LEGACY_RUNNER_WAKE_QUEUE_RETRY_DELAY_SECONDS = 30;

interface HostedRunnerWakeQueueMessage {
  readonly reason: "nudge";
  readonly requestedAt: string;
  readonly schema: typeof HOSTED_RUNNER_WAKE_QUEUE_MESSAGE_SCHEMA;
  readonly userId: string;
}

export async function handleLegacyHostedRunnerWakeQueue(
  batch: WorkerQueueMessageBatchLike,
  env: WorkerEnvironmentSource,
): Promise<void> {
  if (batch.queue && batch.queue !== LEGACY_RUNNER_WAKE_QUEUE_NAME) {
    retryQueueBatch(batch, {
      reason: "legacy-runner-wake-queue-unexpected-queue",
      queue: batch.queue,
    });
    return;
  }

  for (const message of batch.messages) {
    const body = parseHostedRunnerWakeQueueMessage(message.body);
    if (!body) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          queue: batch.queue ?? "unknown",
          reason: "legacy-runner-wake-queue-message-invalid",
        },
        level: "warn",
        message: "Hosted runner legacy wake queue discarded an invalid message.",
        phase: "failed",
      });
      message.ack();
      continue;
    }

    try {
      const stub = await resolveUserRunnerStub(env, body.userId);
      const result = await stub.nudgeHostedRunner();
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          accepted: result.accepted,
          alarmScheduled: result.alarmScheduled,
          alreadyRunning: result.alreadyRunning,
          inFlight: result.inFlight,
          queue: batch.queue ?? LEGACY_RUNNER_WAKE_QUEUE_NAME,
          reason: "legacy-runner-wake-queue-drained",
        },
        level: "info",
        message: "Hosted runner legacy wake queue drained a nudge through the Durable Object.",
        phase: "wake.running",
        userId: body.userId,
      });
      message.ack();
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          queue: batch.queue ?? LEGACY_RUNNER_WAKE_QUEUE_NAME,
          reason: "legacy-runner-wake-queue-processing-failed",
        },
        error,
        level: "warn",
        message: "Hosted runner legacy wake queue failed to drain a nudge and will retry.",
        phase: "wake.running",
        userId: body.userId,
      });
      message.retry({ delaySeconds: LEGACY_RUNNER_WAKE_QUEUE_RETRY_DELAY_SECONDS });
    }
  }
}

function retryQueueBatch(
  batch: WorkerQueueMessageBatchLike,
  details: HostedExecutionStructuredLogDetails,
): void {
  emitHostedExecutionStructuredLog({
    component: "hosted.runner",
    details,
    level: "warn",
    message: "Hosted runner legacy wake queue received an unexpected queue batch and will retry.",
    phase: "failed",
  });

  if (batch.retryAll) {
    batch.retryAll({ delaySeconds: LEGACY_RUNNER_WAKE_QUEUE_RETRY_DELAY_SECONDS });
    return;
  }

  for (const message of batch.messages) {
    message.retry({ delaySeconds: LEGACY_RUNNER_WAKE_QUEUE_RETRY_DELAY_SECONDS });
  }
}

function parseHostedRunnerWakeQueueMessage(
  value: unknown,
): HostedRunnerWakeQueueMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.schema !== HOSTED_RUNNER_WAKE_QUEUE_MESSAGE_SCHEMA) {
    return null;
  }

  if (value.reason !== "nudge") {
    return null;
  }

  if (!isNonEmptyString(value.userId)) {
    return null;
  }

  if (!isNonEmptyString(value.requestedAt) || Number.isNaN(Date.parse(value.requestedAt))) {
    return null;
  }

  return {
    reason: value.reason,
    requestedAt: value.requestedAt,
    schema: value.schema,
    userId: value.userId,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
