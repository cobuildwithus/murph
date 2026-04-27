import { buildHostedExecutionRuntimeTimerWake } from "@murphai/hosted-execution";

import type { R2BucketLike } from "../../src/bundle-store.js";

type StoredRunnerInvocationState = {
  count: number;
  eventIds: string[];
};

type StoredRunnerOutputBundleFaultState = {
  invalidArchiveInvocationsRemaining: number;
};

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

export async function armInvalidRunnerOutputBundleFault(input: {
  bucket: R2BucketLike;
  invocations: number;
  userId: string;
}): Promise<void> {
  await input.bucket.put(runnerOutputBundleFaultObjectKey(input.userId), JSON.stringify({
    invalidArchiveInvocationsRemaining: Math.max(0, Math.trunc(input.invocations)),
  } satisfies StoredRunnerOutputBundleFaultState));
}

export async function clearRunnerOutputBundleFault(
  bucket: R2BucketLike,
  userId: string,
): Promise<void> {
  if (bucket.delete) {
    await bucket.delete(runnerOutputBundleFaultObjectKey(userId));
    return;
  }

  await bucket.put(runnerOutputBundleFaultObjectKey(userId), JSON.stringify({
    invalidArchiveInvocationsRemaining: 0,
  } satisfies StoredRunnerOutputBundleFaultState));
}

export async function consumeInvalidRunnerOutputBundleFault(input: {
  bucket: R2BucketLike;
  userId: string;
}): Promise<boolean> {
  const state = await readRunnerOutputBundleFault(input.bucket, input.userId);
  if (!state || state.invalidArchiveInvocationsRemaining <= 0) {
    return false;
  }

  const remaining = state.invalidArchiveInvocationsRemaining - 1;
  if (remaining <= 0) {
    await clearRunnerOutputBundleFault(input.bucket, input.userId);
  } else {
    await input.bucket.put(runnerOutputBundleFaultObjectKey(input.userId), JSON.stringify({
      invalidArchiveInvocationsRemaining: remaining,
    } satisfies StoredRunnerOutputBundleFaultState));
  }

  return true;
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

function runnerInvocationStateObjectKey(userId: string): string {
  return `test/runner-invocations/${encodeURIComponent(userId)}.json`;
}

function runnerRuntimeTimerWakeObjectKey(userId: string): string {
  return `test/runtime-timer-wakes/${encodeURIComponent(userId)}.json`;
}

function runnerOutputBundleFaultObjectKey(userId: string): string {
  return `test/runner-output-bundle-faults/${encodeURIComponent(userId)}.json`;
}

async function readRunnerOutputBundleFault(
  bucket: R2BucketLike,
  userId: string,
): Promise<StoredRunnerOutputBundleFaultState | null> {
  const object = await bucket.get(runnerOutputBundleFaultObjectKey(userId));

  if (!object) {
    return null;
  }

  return JSON.parse(new TextDecoder().decode(await object.arrayBuffer())) as StoredRunnerOutputBundleFaultState;
}
