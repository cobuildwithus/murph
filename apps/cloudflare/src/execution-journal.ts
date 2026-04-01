import {
  gatewayProjectionSnapshotSchema,
  type GatewayProjectionSnapshot,
} from "@murphai/gateway-core";
import {
  parseHostedExecutionSideEffects,
  type HostedExecutionSideEffect,
  type HostedExecutionRunnerResult,
} from "@murphai/hosted-execution";
import {
  sameHostedBundlePayloadRef,
  type HostedExecutionBundleRef,
  type HostedExecutionBundleRefIdentity,
} from "@murphai/runtime-state";

import {
  createHostedBundleStore,
  describeHostedBase64BundleRef,
  writeHostedBase64BundleIfChanged,
  type R2BucketLike,
} from "./bundle-store.js";
import { readEncryptedR2Json, writeEncryptedR2Json } from "./crypto.js";

export interface HostedExecutionRunnerCommitRequest {
  bundleRefs: {
    agentState: HostedExecutionBundleRef | null;
    vault: HostedExecutionBundleRef | null;
  };
}

export interface HostedExecutionCommittedResult {
  bundleRefs: {
    agentState: HostedExecutionBundleRef | null;
    vault: HostedExecutionBundleRef | null;
  };
  committedAt: string;
  eventId: string;
  finalizedAt: string | null;
  gatewayProjectionSnapshot: GatewayProjectionSnapshot | null;
  result: HostedExecutionRunnerResult["result"];
  sideEffects: HostedExecutionSideEffect[];
  userId: string;
}

export interface HostedExecutionCommitPayload {
  bundles: HostedExecutionRunnerResult["bundles"];
  gatewayProjectionSnapshot?: GatewayProjectionSnapshot | null;
  result: HostedExecutionRunnerResult["result"];
  sideEffects?: HostedExecutionSideEffect[];
}

export interface HostedExecutionFinalizePayload {
  bundles: HostedExecutionRunnerResult["bundles"];
  gatewayProjectionSnapshot?: GatewayProjectionSnapshot | null;
}

export interface HostedExecutionJournalStore {
  deleteCommittedResult(userId: string, eventId: string): Promise<void>;
  readCommittedResult(userId: string, eventId: string): Promise<HostedExecutionCommittedResult | null>;
  writeCommittedResult(userId: string, eventId: string, value: HostedExecutionCommittedResult): Promise<void>;
}

export function createHostedExecutionJournalStore(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
}): HostedExecutionJournalStore {
  return {
    async deleteCommittedResult(userId, eventId) {
      await input.bucket.delete?.(committedResultObjectKey(userId, eventId));
    },

    async readCommittedResult(userId, eventId) {
      return readEncryptedR2Json({
        bucket: input.bucket,
        cryptoKey: input.key,
        cryptoKeysById: input.keysById,
        expectedKeyId: input.keyId,
        key: committedResultObjectKey(userId, eventId),
        parse(value) {
          return normalizeHostedExecutionCommittedResult(value as HostedExecutionCommittedResult);
        },
      });
    },

    async writeCommittedResult(userId, eventId, value) {
      await writeEncryptedR2Json({
        bucket: input.bucket,
        cryptoKey: input.key,
        key: committedResultObjectKey(userId, eventId),
        keyId: input.keyId,
        value,
      });
    },
  };
}

export async function persistHostedExecutionCommit(input: {
  bucket: R2BucketLike;
  currentBundleRefs: HostedExecutionRunnerCommitRequest["bundleRefs"];
  eventId: string;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  payload: HostedExecutionCommitPayload;
  userId: string;
}): Promise<HostedExecutionCommittedResult> {
  const existing = await createHostedExecutionJournalStore({
    bucket: input.bucket,
    key: input.key,
    keyId: input.keyId,
    keysById: input.keysById,
  }).readCommittedResult(input.userId, input.eventId);

  if (existing) {
    assertEquivalentDuplicateCommit(existing, input);
    return existing;
  }

  const bundleStore = createHostedBundleStore({
    bucket: input.bucket,
    key: input.key,
    keyId: input.keyId,
    keysById: input.keysById,
  });
  const committedAt = new Date().toISOString();
  const committedResult: HostedExecutionCommittedResult = {
    bundleRefs: {
      agentState: await writeHostedBase64BundleIfChanged({
        bundleStore,
        currentRef: input.currentBundleRefs.agentState,
        kind: "agent-state",
        value: input.payload.bundles.agentState,
      }),
      vault: await writeHostedBase64BundleIfChanged({
        bundleStore,
        currentRef: input.currentBundleRefs.vault,
        kind: "vault",
        value: input.payload.bundles.vault,
      }),
    },
    committedAt,
    eventId: input.eventId,
    finalizedAt: null,
    gatewayProjectionSnapshot: input.payload.gatewayProjectionSnapshot ?? null,
    result: input.payload.result,
    sideEffects: parseHostedExecutionSideEffects(input.payload.sideEffects),
    userId: input.userId,
  };

  await createHostedExecutionJournalStore({
    bucket: input.bucket,
    key: input.key,
    keyId: input.keyId,
    keysById: input.keysById,
  }).writeCommittedResult(input.userId, input.eventId, committedResult);

  return committedResult;
}

export async function persistHostedExecutionFinalBundles(input: {
  bucket: R2BucketLike;
  eventId: string;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  payload: HostedExecutionFinalizePayload;
  userId: string;
}): Promise<HostedExecutionCommittedResult> {
  const journalStore = createHostedExecutionJournalStore({
    bucket: input.bucket,
    key: input.key,
    keyId: input.keyId,
    keysById: input.keysById,
  });
  const existing = await journalStore.readCommittedResult(input.userId, input.eventId);

  if (!existing) {
    throw new Error(
      `Hosted execution commit ${input.userId}/${input.eventId} was not found before finalize.`,
    );
  }

  const bundleStore = createHostedBundleStore({
    bucket: input.bucket,
    key: input.key,
    keyId: input.keyId,
    keysById: input.keysById,
  });
  const nextBundleRefs = {
    agentState: await writeHostedBase64BundleIfChanged({
      bundleStore,
      currentRef: existing.bundleRefs.agentState,
      kind: "agent-state",
      value: input.payload.bundles.agentState,
    }),
    vault: await writeHostedBase64BundleIfChanged({
      bundleStore,
      currentRef: existing.bundleRefs.vault,
      kind: "vault",
      value: input.payload.bundles.vault,
    }),
  };

  if (
    sameHostedBundlePayloadRef(nextBundleRefs.agentState, existing.bundleRefs.agentState)
    && sameHostedBundlePayloadRef(nextBundleRefs.vault, existing.bundleRefs.vault)
    && existing.finalizedAt !== null
  ) {
    return existing;
  }

  const finalizedResult: HostedExecutionCommittedResult = {
    ...existing,
    bundleRefs: nextBundleRefs,
    finalizedAt: existing.finalizedAt ?? new Date().toISOString(),
    gatewayProjectionSnapshot:
      input.payload.gatewayProjectionSnapshot ?? existing.gatewayProjectionSnapshot,
  };
  await journalStore.writeCommittedResult(input.userId, input.eventId, finalizedResult);
  return finalizedResult;
}

function committedResultObjectKey(userId: string, eventId: string): string {
  return `transient/execution-journal/${encodeURIComponent(userId)}/${encodeURIComponent(eventId)}.json`;
}

function normalizeHostedExecutionCommittedResult(
  value: HostedExecutionCommittedResult,
): HostedExecutionCommittedResult {
  return {
    ...value,
    finalizedAt: value.finalizedAt ?? null,
    gatewayProjectionSnapshot:
      (value as { gatewayProjectionSnapshot?: unknown }).gatewayProjectionSnapshot === undefined
      || (value as { gatewayProjectionSnapshot?: unknown }).gatewayProjectionSnapshot === null
        ? null
        : gatewayProjectionSnapshotSchema.parse(
            (value as { gatewayProjectionSnapshot: unknown }).gatewayProjectionSnapshot,
          ),
    sideEffects: parseHostedExecutionSideEffects((value as { sideEffects?: unknown }).sideEffects),
    userId: typeof (value as { userId?: unknown }).userId === "string"
      ? (value as { userId: string }).userId
      : "",
  };
}

function assertEquivalentDuplicateCommit(
  existing: HostedExecutionCommittedResult,
  input: {
    currentBundleRefs: HostedExecutionRunnerCommitRequest["bundleRefs"];
    eventId: string;
    payload: HostedExecutionCommitPayload;
    userId: string;
  },
): void {
  if (existing.userId !== input.userId) {
    throw new Error(
      `Hosted execution commit ${input.eventId} was already persisted for user ${existing.userId}, not ${input.userId}.`,
    );
  }

  if (!sameStructuredValue(existing.result, input.payload.result)) {
    throw new Error(
      `Hosted execution commit ${input.eventId} result does not match the existing durable commit.`,
    );
  }

  const expectedSideEffects = parseHostedExecutionSideEffects(input.payload.sideEffects);
  if (!sameStructuredValue(existing.sideEffects, expectedSideEffects)) {
    throw new Error(
      `Hosted execution commit ${input.eventId} side effects do not match the existing durable commit.`,
    );
  }

  const expectedGatewayProjectionSnapshot = input.payload.gatewayProjectionSnapshot ?? null;
  if (
    !sameStructuredValue(
      existing.gatewayProjectionSnapshot ?? null,
      expectedGatewayProjectionSnapshot,
    )
  ) {
    throw new Error(
      `Hosted execution commit ${input.eventId} gateway projection snapshot does not match the existing durable commit.`,
    );
  }

  const expectedBundleRefs = {
    agentState: resolveExpectedCommittedBundleRef(
      "agent-state",
      input.currentBundleRefs.agentState,
      input.payload.bundles.agentState,
    ),
    vault: resolveExpectedCommittedBundleRef(
      "vault",
      input.currentBundleRefs.vault,
      input.payload.bundles.vault,
    ),
  };

  if (!sameHostedBundlePayloadRef(existing.bundleRefs.agentState, expectedBundleRefs.agentState)) {
    throw new Error(
      `Hosted execution commit ${input.eventId} agent-state bundle ref does not match the existing durable commit.`,
    );
  }

  if (!sameHostedBundlePayloadRef(existing.bundleRefs.vault, expectedBundleRefs.vault)) {
    throw new Error(
      `Hosted execution commit ${input.eventId} vault bundle ref does not match the existing durable commit.`,
    );
  }
}

function resolveExpectedCommittedBundleRef(
  kind: "agent-state" | "vault",
  currentRef: HostedExecutionBundleRef | null,
  value: string | null,
): HostedExecutionBundleRefIdentity | null {
  const decoded = describeHostedBase64BundleRef({
    kind,
    value,
  });

  if (!decoded) {
    return null;
  }

  return sameHostedBundlePayloadRef(currentRef, decoded.ref)
    ? currentRef
    : decoded.ref;
}

function sameStructuredValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
