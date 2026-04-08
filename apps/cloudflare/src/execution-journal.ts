import {
  gatewayProjectionSnapshotSchema,
  type GatewayProjectionSnapshot,
} from "@murphai/gateway-core";
import {
  type HostedAssistantDeliveryEffect,
  type HostedExecutionBundleRef,
  parseHostedAssistantDeliveryEffects,
  type HostedExecutionRunnerResult,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionBundleRef,
  sameHostedBundlePayloadRef,
  type HostedExecutionBundleRefIdentity,
} from "@murphai/runtime-state";

import {
  createHostedBundleStore,
  describeHostedBase64BundleRef,
  writeHostedBase64BundleIfChanged,
  type R2BucketLike,
} from "./bundle-store.js";
import {
  buildHostedStorageAad,
} from "./crypto-context.js";
import {
  hostedExecutionJournalObjectKey,
} from "./storage-paths.js";
import { readEncryptedR2Json, writeEncryptedR2Json } from "./crypto.js";

export interface HostedExecutionRunnerCommitRequest {
  bundleRef: HostedExecutionBundleRef | null;
}

export interface HostedExecutionCommittedResult {
  assistantDeliveryEffects: HostedAssistantDeliveryEffect[];
  sideEffects?: HostedAssistantDeliveryEffect[];
  bundleRef: HostedExecutionBundleRef | null;
  committedAt: string;
  eventId: string;
  finalizedAt: string | null;
  gatewayProjectionSnapshot: GatewayProjectionSnapshot | null;
  result: HostedExecutionRunnerResult["result"];
  userId: string;
}

export interface HostedExecutionCommitPayload {
  assistantDeliveryEffects?: HostedAssistantDeliveryEffect[];
  sideEffects?: HostedAssistantDeliveryEffect[];
  bundle: HostedExecutionRunnerResult["bundle"];
  gatewayProjectionSnapshot?: GatewayProjectionSnapshot | null;
  result: HostedExecutionRunnerResult["result"];
}

export interface HostedExecutionFinalizePayload {
  bundle: HostedExecutionRunnerResult["bundle"];
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
      if (!input.bucket.delete) {
        return;
      }

      await input.bucket.delete(
        await hostedExecutionJournalObjectKey(input.key, userId, eventId),
      );
    },

    async readCommittedResult(userId, eventId) {
      const objectKey = await hostedExecutionJournalObjectKey(input.key, userId, eventId);
      return await readEncryptedR2Json({
        aad: buildHostedStorageAad({
          eventId,
          key: objectKey,
          purpose: "execution-journal",
          userId,
        }),
        bucket: input.bucket,
        cryptoKey: input.key,
        cryptoKeysById: input.keysById,
        expectedKeyId: input.keyId,
        key: objectKey,
        parse(value) {
          return normalizeHostedExecutionCommittedResult(value as HostedExecutionCommittedResult);
        },
        scope: "execution-journal",
      });
    },

    async writeCommittedResult(userId, eventId, value) {
      const objectKey = await hostedExecutionJournalObjectKey(input.key, userId, eventId);
      await writeEncryptedR2Json({
        aad: buildHostedStorageAad({
          eventId,
          key: objectKey,
          purpose: "execution-journal",
          userId,
        }),
        bucket: input.bucket,
        cryptoKey: input.key,
        key: objectKey,
        keyId: input.keyId,
        scope: "execution-journal",
        value,
      });
    },
  };
}

export async function persistHostedExecutionCommit(input: {
  bucket: R2BucketLike;
  currentBundleRef: HostedExecutionRunnerCommitRequest["bundleRef"];
  eventId: string;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  payload: HostedExecutionCommitPayload;
  userId: string;
}): Promise<HostedExecutionCommittedResult> {
  const journalStore = createHostedExecutionJournalStore({
    bucket: input.bucket,
    key: input.key,
    keyId: input.keyId,
    keysById: input.keysById,
  });
  const existing = await journalStore.readCommittedResult(input.userId, input.eventId);

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
  const assistantDeliveryEffects = parseHostedAssistantDeliveryEffects(
    input.payload.assistantDeliveryEffects ?? input.payload.sideEffects,
  );
  const committedResult: HostedExecutionCommittedResult = {
    assistantDeliveryEffects,
    bundleRef: await writeHostedBase64BundleIfChanged({
      bundleStore,
      currentRef: input.currentBundleRef,
      kind: "vault",
      value: input.payload.bundle,
    }),
    committedAt,
    eventId: input.eventId,
    finalizedAt: null,
    gatewayProjectionSnapshot: input.payload.gatewayProjectionSnapshot ?? null,
    result: input.payload.result,
    sideEffects: assistantDeliveryEffects,
    userId: input.userId,
  };

  await journalStore.writeCommittedResult(input.userId, input.eventId, committedResult);

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
  const nextBundleRef = await writeHostedBase64BundleIfChanged({
    bundleStore,
    currentRef: existing.bundleRef,
    kind: "vault",
    value: input.payload.bundle,
  });

  if (
    sameHostedBundlePayloadRef(nextBundleRef, existing.bundleRef)
    && existing.finalizedAt !== null
  ) {
    return existing;
  }

  const finalizedResult: HostedExecutionCommittedResult = {
    ...existing,
    bundleRef: nextBundleRef,
    finalizedAt: existing.finalizedAt ?? new Date().toISOString(),
    gatewayProjectionSnapshot:
      input.payload.gatewayProjectionSnapshot ?? existing.gatewayProjectionSnapshot,
  };
  await journalStore.writeCommittedResult(input.userId, input.eventId, finalizedResult);
  return finalizedResult;
}

function normalizeHostedExecutionCommittedResult(
  value: HostedExecutionCommittedResult,
): HostedExecutionCommittedResult {
  const assistantDeliveryEffects = parseHostedAssistantDeliveryEffects(
    (value as { assistantDeliveryEffects?: unknown; sideEffects?: unknown })
      .assistantDeliveryEffects
    ?? (value as { assistantDeliveryEffects?: unknown; sideEffects?: unknown })
      .sideEffects,
  );
  return {
    ...value,
    assistantDeliveryEffects,
    bundleRef: parseHostedExecutionBundleRef(
      (value as { bundleRef?: unknown }).bundleRef,
      "Hosted execution committed result bundleRef",
    ),
    finalizedAt: value.finalizedAt ?? null,
    gatewayProjectionSnapshot:
      (value as { gatewayProjectionSnapshot?: unknown }).gatewayProjectionSnapshot === undefined
      || (value as { gatewayProjectionSnapshot?: unknown }).gatewayProjectionSnapshot === null
        ? null
        : gatewayProjectionSnapshotSchema.parse(
            (value as { gatewayProjectionSnapshot: unknown }).gatewayProjectionSnapshot,
          ),
    sideEffects: assistantDeliveryEffects,
    userId: requireCommittedResultString(
      (value as { userId?: unknown }).userId,
      "Hosted execution committed result userId",
    ),
  };
}

function requireCommittedResultString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function assertEquivalentDuplicateCommit(
  existing: HostedExecutionCommittedResult,
  input: {
    currentBundleRef: HostedExecutionRunnerCommitRequest["bundleRef"];
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

  const expectedAssistantDeliveryEffects = parseHostedAssistantDeliveryEffects(
    input.payload.assistantDeliveryEffects ?? input.payload.sideEffects,
  );
  if (!sameStructuredValue(existing.assistantDeliveryEffects, expectedAssistantDeliveryEffects)) {
    throw new Error(
      `Hosted execution commit ${input.eventId} assistant deliveries do not match the existing durable commit.`,
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

  const expectedBundleRef = resolveExpectedCommittedBundleRef(
    input.currentBundleRef,
    input.payload.bundle,
  );
  if (!sameHostedBundlePayloadRef(existing.bundleRef, expectedBundleRef)) {
    throw new Error(
      `Hosted execution commit ${input.eventId} vault bundle ref does not match the existing durable commit.`,
    );
  }
}

function resolveExpectedCommittedBundleRef(
  currentRef: HostedExecutionBundleRef | null,
  value: string | null,
): HostedExecutionBundleRefIdentity | null {
  const decoded = describeHostedBase64BundleRef({
    kind: "vault",
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
