import type {
  HostedAssistantRuntimeJobRequest,
  HostedAssistantRuntimeJobResult,
} from "@murphai/assistant-runtime";

import type { R2BucketLike } from "../../src/bundle-store.js";

type StoredPauseState = {
  cleared?: boolean;
  entered: boolean;
  released: boolean;
  request: HostedAssistantRuntimeJobRequest | null;
};

type StoredDispatchPayloadReadPauseState = {
  cleared?: boolean;
  entered: boolean;
  eventId: string;
  expectedKey: string;
  key: string | null;
  released: boolean;
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

export async function armDispatchPayloadReadPause(
  input: {
    bucket: R2BucketLike;
    eventId: string;
    expectedKey: string;
  },
): Promise<void> {
  await writeDispatchPayloadReadPauseState(input.bucket, {
    entered: false,
    eventId: input.eventId,
    expectedKey: input.expectedKey,
    key: null,
    released: false,
  });
}

export async function readDispatchPayloadReadPauseState(
  bucket: R2BucketLike,
  eventId: string,
): Promise<{
  armed: boolean;
  entered: boolean;
  hasKey: boolean;
  matchedExpectedKey: boolean;
}> {
  const state = await readDispatchPayloadReadPauseStateObject(bucket);

  if (!state || state.eventId !== eventId) {
    return {
      armed: false,
      entered: false,
      hasKey: false,
      matchedExpectedKey: false,
    };
  }

  return {
    armed: true,
    entered: state.entered,
    hasKey: state.key !== null,
    matchedExpectedKey: state.key === state.expectedKey,
  };
}

export async function releaseDispatchPayloadReadPause(
  bucket: R2BucketLike,
  eventId: string,
): Promise<boolean> {
  const state = await readDispatchPayloadReadPauseStateObject(bucket);

  if (!state || state.eventId !== eventId) {
    return false;
  }

  await writeDispatchPayloadReadPauseState(bucket, {
    ...state,
    released: true,
  });
  return true;
}

export async function clearDispatchPayloadReadPause(
  bucket: R2BucketLike,
  eventId: string,
): Promise<void> {
  const state = await readDispatchPayloadReadPauseStateObject(bucket);

  if (!state || state.eventId !== eventId) {
    return;
  }

  if (bucket.delete) {
    await bucket.delete(dispatchPayloadReadPauseStateObjectKey());
    return;
  }

  await bucket.put(dispatchPayloadReadPauseStateObjectKey(), JSON.stringify({
    ...state,
    cleared: true,
    entered: false,
    key: null,
    released: false,
  } satisfies StoredDispatchPayloadReadPauseState));
}

export async function pauseDispatchPayloadReadIfArmed(input: {
  bucket: R2BucketLike;
  key: string;
}): Promise<void> {
  const state = await readDispatchPayloadReadPauseStateObject(input.bucket);

  if (
    !state
    || state.entered
    || state.released
    || input.key !== state.expectedKey
  ) {
    return;
  }

  await writeDispatchPayloadReadPauseState(input.bucket, {
    ...state,
    entered: true,
    key: input.key,
  });

  while (true) {
    const nextState = await readDispatchPayloadReadPauseStateObject(input.bucket);

    if (!nextState || nextState.released) {
      return;
    }

    await sleep(pollIntervalMs);
  }
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
  if (input.request.resume) {
    return;
  }

  const state = await readPauseState(input.bucket, input.request.dispatch.eventId);

  if (!state) {
    return;
  }

  await writePauseState(input.bucket, input.request.dispatch.eventId, {
    ...state,
    entered: true,
    request: structuredClone(input.request),
  });

  while (true) {
    const nextState = await readPauseState(input.bucket, input.request.dispatch.eventId);

    if (!nextState || nextState.released) {
      return;
    }

    await sleep(pollIntervalMs);
  }
}

export async function buildSeededDuplicateCommitPayload(
  bucket: R2BucketLike,
  eventId: string,
): Promise<HostedAssistantRuntimeJobResult | null> {
  const request = (await readPauseState(bucket, eventId))?.request ?? null;

  if (!request) {
    return null;
  }

  return buildSyntheticCommittedRunnerResult(request, {
    effectId: `outbox_seeded_${eventId.replace(/[^a-zA-Z0-9]+/g, "_")}`,
  });
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
    phase: "committed",
    result: {
      bundle: request.bundle ?? btoa(`vault:${request.dispatch.eventId}`),
      result: {
        eventsHandled: 1,
        ...(nextWakeAt === null ? {} : { nextWakeAt }),
        summary: `runtime:${request.dispatch.eventId}`,
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
      bundle: request.bundle ?? btoa(`vault:${request.dispatch.eventId}`),
      result: {
        eventsHandled: 1,
        ...(nextWakeAt === null ? {} : { nextWakeAt }),
        summary: `runtime:${request.dispatch.eventId}`,
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
  if (
    request.dispatch.event.kind !== "member.activated"
    || request.dispatch.event.firstContact == null
  ) {
    return [];
  }

  const effectId = input?.effectId ?? `outbox_${crypto.randomUUID().replace(/-/g, "")}`;

  return [
    {
      effectId,
      fingerprint: `first-contact:${request.dispatch.eventId}`,
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
        replyToMessageId: null,
        sessionId: `session_${request.dispatch.eventId}`,
        threadId: "thread_123",
        threadIsDirect: true,
        transportIdempotent: false,
        turnId: `turn_${request.dispatch.eventId}`,
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

async function readDispatchPayloadReadPauseStateObject(
  bucket: R2BucketLike,
): Promise<StoredDispatchPayloadReadPauseState | null> {
  const object = await bucket.get(dispatchPayloadReadPauseStateObjectKey());

  if (!object) {
    return null;
  }

  const parsed = JSON.parse(
    new TextDecoder().decode(await object.arrayBuffer()),
  ) as StoredDispatchPayloadReadPauseState;

  return parsed.cleared ? null : parsed;
}

async function writeDispatchPayloadReadPauseState(
  bucket: R2BucketLike,
  state: StoredDispatchPayloadReadPauseState,
): Promise<void> {
  await bucket.put(dispatchPayloadReadPauseStateObjectKey(), JSON.stringify(state));
}

function dispatchPayloadReadPauseStateObjectKey(): string {
  return "test/dispatch-payload-read-pause.json";
}

function runnerInvocationStateObjectKey(userId: string): string {
  return `test/runner-invocations/${encodeURIComponent(userId)}.json`;
}

function resolveSyntheticGeneratedAt(request: HostedAssistantRuntimeJobRequest): string {
  return request.dispatch.occurredAt;
}

function resolveSyntheticNextWakeAt(request: HostedAssistantRuntimeJobRequest): string | null {
  if (request.dispatch.event.kind !== "member.activated") {
    return null;
  }

  const occurredAtMs = Date.parse(request.dispatch.occurredAt);
  if (Number.isNaN(occurredAtMs)) {
    return "1970-01-01T00:01:00.000Z";
  }

  return new Date(occurredAtMs + 60_000).toISOString();
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
