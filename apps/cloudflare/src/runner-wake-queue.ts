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

export const RUNNER_WAKE_QUEUE_BINDING_NAME = "RUNNER_WAKE_QUEUE";
export const HOSTED_RUNNER_WAKE_QUEUE_MESSAGE_SCHEMA = "murph.hosted-runner.wake.v1";

const RUNNER_WAKE_QUEUE_RETRY_DELAY_SECONDS = 30;

export interface HostedRunnerWakeQueueMessage {
  readonly reason: "nudge";
  readonly requestedAt: string;
  readonly schema: typeof HOSTED_RUNNER_WAKE_QUEUE_MESSAGE_SCHEMA;
  readonly userId: string;
}

export async function enqueueHostedRunnerWake(input: {
  component: string;
  details?: HostedExecutionStructuredLogDetails | null;
  env: WorkerEnvironmentSource;
  userId: string;
}): Promise<{ queued: boolean; reason?: string }> {
  const queue = input.env.RUNNER_WAKE_QUEUE;
  if (!queue) {
    emitHostedExecutionStructuredLog({
      component: input.component,
      details: {
        ...(input.details ?? {}),
        reason: "runner-wake-queue-missing",
      },
      level: "warn",
      message: "Hosted runner wake queue binding is missing; relying on the Durable Object alarm fallback.",
      phase: "scheduled",
      userId: input.userId,
    });
    return { queued: false, reason: "missing-queue-binding" };
  }

  const message: HostedRunnerWakeQueueMessage = {
    reason: "nudge",
    requestedAt: new Date().toISOString(),
    schema: HOSTED_RUNNER_WAKE_QUEUE_MESSAGE_SCHEMA,
    userId: input.userId,
  };

  try {
    await queue.send(message);
    emitHostedExecutionStructuredLog({
      component: input.component,
      details: {
        ...(input.details ?? {}),
        reason: "runner-wake-queued",
      },
      level: "info",
      message: "Hosted runner wake queued.",
      phase: "scheduled",
      userId: input.userId,
    });
    return { queued: true };
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: input.component,
      details: {
        ...(input.details ?? {}),
        reason: "runner-wake-queue-send-failed",
      },
      error,
      level: "warn",
      message: "Hosted runner wake queue send failed; relying on the Durable Object alarm fallback.",
      phase: "scheduled",
      userId: input.userId,
    });
    return { queued: false, reason: "queue-send-failed" };
  }
}

export async function handleHostedRunnerWakeQueue(
  batch: WorkerQueueMessageBatchLike,
  env: WorkerEnvironmentSource,
): Promise<void> {
  for (const message of batch.messages) {
    const body = parseHostedRunnerWakeQueueMessage(message.body);
    if (!body) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          queue: batch.queue ?? "unknown",
          reason: "runner-wake-queue-message-invalid",
        },
        level: "warn",
        message: "Hosted runner wake queue discarded an invalid message.",
        phase: "failed",
      });
      message.ack();
      continue;
    }

    try {
      const stub = await resolveUserRunnerStub(env, body.userId);
      const result = await stub.runWhenIdleOrBudget({ reason: body.reason });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          queue: batch.queue ?? "unknown",
          reason: "runner-wake-queue-processed",
          runnerStatus: result.status,
        },
        level: "info",
        message: "Hosted runner wake queue processed a nudge.",
        phase: "wake.running",
        userId: body.userId,
      });
      message.ack();
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          queue: batch.queue ?? "unknown",
          reason: "runner-wake-queue-processing-failed",
        },
        error,
        level: "warn",
        message: "Hosted runner wake queue failed to process a nudge and will retry.",
        phase: "wake.running",
        userId: body.userId,
      });
      message.retry({ delaySeconds: RUNNER_WAKE_QUEUE_RETRY_DELAY_SECONDS });
    }
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
