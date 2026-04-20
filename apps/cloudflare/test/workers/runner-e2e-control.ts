import type {
  HostedAssistantRuntimeJobRequest,
  HostedAssistantRuntimeJobResult,
} from "@murphai/assistant-runtime";
import { buildHostedExecutionRuntimeTimerWake, createRuntimeTimerSyntheticWake } from "@murphai/hosted-execution";

import type { R2BucketLike } from "../../src/bundle-store.js";

type StoredPauseState = {
  cleared?: boolean;
  entered: boolean;
  released: boolean;
  request: HostedAssistantRuntimeJobRequest | null;
};

type StoredRunnerInvocationState = {
  count: number;
  eventIds: string[];
};

const pollIntervalMs = 50;

export async function armRunnerCommitPause(
  bucket: R2BucketLike,
  eventId: string,
): Promise<void> {
  await writePauseState(bucket, eventId, {
    entered: false,
    released: false,
    request: null,
  });
}

export async function readRunnerCommitPauseState(
  bucket: R2BucketLike,
  eventId: string,
): Promise<{
  armed: boolean;
  entered: boolean;
  hasRequest: boolean;
}> {
  const state = await readPauseState(bucket, eventId);

  return {
    armed: state !== null,
    entered: state?.entered ?? false,
    hasRequest: state?.request !== null && state?.request !== undefined,
  };
}

export async function releaseRunnerCommitPause(
  bucket: R2BucketLike,
  eventId: string,
): Promise<boolean> {
  const state = await readPauseState(bucket, eventId);

  if (!state) {
    return false;
  }

  await writePauseState(bucket, eventId, {
    ...state,
    released: true,
  });
  return true;
}

export async function clearRunnerCommitPause(
  bucket: R2BucketLike,
  eventId: string,
): Promise<void> {
  if (bucket.delete) {
    await bucket.delete(pauseStateObjectKey(eventId));
    return;
  }

  await bucket.put(pauseStateObjectKey(eventId), JSON.stringify({
    cleared: true,
    entered: false,
    released: false,
    request: null,
  } satisfies StoredPauseState));
}

export async function readRunnerInvocationState(
  bucket: R2BucketLike,
  userId: string,
): Promise<StoredRunnerInvocationState> {
  const object = await bucket.get(runnerInvocationStateObjectKey(userId));

  if (!object) {
    return {
      count: 0,
      eventIds: [],
    };
  }

  return JSON.parse(new TextDecoder().decode(await object.arrayBuffer())) as StoredRunnerInvocationState;
}

export async function recordRunnerInvocation(input: {
  bucket: R2BucketLike;
  eventId: string;
  userId: string;
}): Promise<void> {
  const current = await readRunnerInvocationState(input.bucket, input.userId);
  await input.bucket.put(runnerInvocationStateObjectKey(input.userId), JSON.stringify({
    count: current.count + 1,
    eventIds: [...current.eventIds, input.eventId],
  } satisfies StoredRunnerInvocationState));
}

export async function clearRunnerInvocationState(
  bucket: R2BucketLike,
  userId: string,
): Promise<void> {
  if (bucket.delete) {
    await bucket.delete(runnerInvocationStateObjectKey(userId));
    return;
  }

  await bucket.put(runnerInvocationStateObjectKey(userId), JSON.stringify({
    count: 0,
    eventIds: [],
  } satisfies StoredRunnerInvocationState));
}

export async function pauseRunnerCommitIfArmed(input: {
  bucket: R2BucketLike;
  request: HostedAssistantRuntimeJobRequest;
}): Promise<void> {
  if (input.request.runDrain.resumeFinalize) {
    return;
  }

  const eventId = await resolvePauseWakeEventId(input.bucket, input.request);
  const state = await readPauseState(input.bucket, eventId);

  if (!state) {
    return;
  }

  await writePauseState(input.bucket, eventId, {
    ...state,
    entered: true,
    request: structuredClone(input.request),
  });

  while (true) {
    const nextState = await readPauseState(input.bucket, eventId);

    if (!nextState || nextState.released) {
      return;
    }

    await sleep(pollIntervalMs);
  }
}

async function resolvePauseWakeEventId(
  bucket: R2BucketLike,
  request: HostedAssistantRuntimeJobRequest,
): Promise<string> {
  const [firstEvent] = request.runDrain.events;
  if (firstEvent?.wake) {
    return firstEvent.wake.eventId;
  }

  if (request.runDrain.triggerKind === "runtime_timer") {
    const wake = await readRunnerRuntimeTimerWake(bucket, request.runDrain.userId);
    if (wake) {
      return wake.eventId;
    }
  }

  return createRuntimeTimerSyntheticWake(request.runDrain).eventId;
}

export async function buildSeededDuplicateCommitPayload(
  bucket: R2BucketLike,
  eventId: string,
): Promise<HostedAssistantRuntimeJobResult | null> {
  const request = await readRunnerCommitPauseRequest(bucket, eventId);

  if (!request) {
    return null;
  }

  return buildSyntheticCommittedRunnerResult(request, {
    effectId: `outbox_seeded_${eventId.replace(/[^a-zA-Z0-9]+/g, "_")}`,
  });
}

export async function readRunnerCommitPauseRequest(
  bucket: R2BucketLike,
  eventId: string,
): Promise<HostedAssistantRuntimeJobRequest | null> {
  return (await readPauseState(bucket, eventId))?.request ?? null;
}

export async function persistRunnerRuntimeTimerWake(input: {
  bucket: R2BucketLike;
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>;
}): Promise<void> {
  await input.bucket.put(
    runnerRuntimeTimerWakeObjectKey(input.wake.userId),
    JSON.stringify(input.wake),
  );
}

export async function readRunnerRuntimeTimerWake(
  bucket: R2BucketLike,
  userId: string,
): Promise<ReturnType<typeof buildHostedExecutionRuntimeTimerWake> | null> {
  const object = await bucket.get(runnerRuntimeTimerWakeObjectKey(userId));

  if (!object) {
    return null;
  }

  return JSON.parse(new TextDecoder().decode(await object.arrayBuffer())) as ReturnType<
    typeof buildHostedExecutionRuntimeTimerWake
  >;
}

export function buildSyntheticCommittedRunnerResult(
  request: HostedAssistantRuntimeJobRequest,
  input?: {
    effectId?: string;
  },
): HostedAssistantRuntimeJobResult {
  const generatedAt = resolveSyntheticGeneratedAt(request);
  const nextWakeAt = resolveSyntheticNextWakeAt(request);

  return {
    committedAssistantDeliveryEffects: buildSyntheticAssistantDeliveryEffects(request, input),
    committedGatewayProjectionSnapshot: {
      conversations: [],
      generatedAt,
      messages: [],
      permissions: [],
      schema: "murph.gateway-projection-snapshot.v1",
    },
    phase: "prepared",
    result: {
      bundle: request.bundle ?? btoa(`vault:${resolvePrimaryWake(request).eventId}`),
      result: {
        eventsHandled: 1,
        ...(nextWakeAt === null ? {} : { nextWakeAt }),
        summary: `runtime:${resolvePrimaryWake(request).eventId}`,
      },
    },
  };
}

export function buildSyntheticCompletedRunnerResult(
  request: HostedAssistantRuntimeJobRequest,
): HostedAssistantRuntimeJobResult {
  const generatedAt = resolveSyntheticGeneratedAt(request);
  const nextWakeAt = resolveSyntheticNextWakeAt(request);

  return {
    finalGatewayProjectionSnapshot: {
      conversations: [],
      generatedAt,
      messages: [],
      permissions: [],
      schema: "murph.gateway-projection-snapshot.v1",
    },
    result: {
      bundle: request.bundle ?? btoa(`vault:${resolvePrimaryWake(request).eventId}`),
      result: {
        eventsHandled: 1,
        ...(nextWakeAt === null ? {} : { nextWakeAt }),
        summary: `runtime:${resolvePrimaryWake(request).eventId}`,
      },
    },
    phase: "completed",
  };
}

function buildSyntheticAssistantDeliveryEffects(
  request: HostedAssistantRuntimeJobRequest,
  input?: {
    effectId?: string;
  },
) {
  const wake = resolvePrimaryWake(request);

  if (wake.kind !== "assistant.notification.requested") {
    return [];
  }

  const effectId = input?.effectId ?? `outbox_${crypto.randomUUID().replace(/-/g, "")}`;

  return [
    {
      effectId,
      fingerprint: `signup-welcome:${wake.eventId}`,
      kind: "assistant.delivery" as const,
      payload: {
        actorId: "actor_123",
        bindingDeliveryKind: "participant" as const,
        bindingDeliveryTarget: "chat_123",
        channel: "telegram",
        explicitTarget: null,
        idempotencyKey: `assistant-outbox:${effectId}`,
        identityId: "identity_123",
        message: "hello from runner e2e",
        subject: null,
        replyToMessageId: null,
        sessionId: `session_${wake.eventId}`,
        threadId: "thread_123",
        threadIsDirect: true,
        transportIdempotent: false,
        turnId: `turn_${wake.eventId}`,
      },
    },
  ];
}

async function readPauseState(
  bucket: R2BucketLike,
  eventId: string,
): Promise<StoredPauseState | null> {
  const object = await bucket.get(pauseStateObjectKey(eventId));

  if (!object) {
    return null;
  }

  const parsed = JSON.parse(new TextDecoder().decode(await object.arrayBuffer())) as StoredPauseState;

  return parsed.cleared ? null : parsed;
}

async function writePauseState(
  bucket: R2BucketLike,
  eventId: string,
  state: StoredPauseState,
): Promise<void> {
  await bucket.put(pauseStateObjectKey(eventId), JSON.stringify(state));
}

function pauseStateObjectKey(eventId: string): string {
  return `test/runner-pauses/${encodeURIComponent(eventId)}.json`;
}

function runnerInvocationStateObjectKey(userId: string): string {
  return `test/runner-invocations/${encodeURIComponent(userId)}.json`;
}

function runnerRuntimeTimerWakeObjectKey(userId: string): string {
  return `test/runtime-timer-wakes/${encodeURIComponent(userId)}.json`;
}

function resolveSyntheticGeneratedAt(request: HostedAssistantRuntimeJobRequest): string {
  return resolvePrimaryWake(request).occurredAt;
}

function resolveSyntheticNextWakeAt(request: HostedAssistantRuntimeJobRequest): string | null {
  const wake = resolvePrimaryWake(request);

  if (wake.kind !== "member.activated") {
    return null;
  }

  const occurredAtMs = Date.parse(wake.occurredAt);
  if (Number.isNaN(occurredAtMs)) {
    return "1970-01-01T00:01:00.000Z";
  }

  return new Date(occurredAtMs + 60_000).toISOString();
}

function resolvePrimaryWake(
  request: HostedAssistantRuntimeJobRequest,
) {
  const [firstEvent] = request.runDrain.events;
  return firstEvent?.wake ?? createRuntimeTimerSyntheticWake(request.runDrain);
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
