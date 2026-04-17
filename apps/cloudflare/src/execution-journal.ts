import {
  gatewayProjectionSnapshotSchema,
  type GatewayProjectionSnapshot,
} from "@murphai/gateway-core";
import { emitHostedExecutionStructuredLog } from "@murphai/hosted-execution";
import type {
  HostedExecutionBundleRef,
  HostedExecutionRunnerResult,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedAssistantDeliveryEffects,
  type HostedAssistantDeliveryEffect,
} from "@murphai/hosted-execution/side-effects";
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
import { sameStructuredJsonValue } from "./structured-json.js";

// Execution journals are recovery evidence for restore/finalize flows. They are
// not a second owner for product lifecycle semantics.
export interface HostedExecutionRunnerCommitRequest {
  bundleRef: HostedExecutionBundleRef | null;
}

export interface HostedExecutionCommittedResult {
  assistantDeliveryEffects: HostedAssistantDeliveryEffect[];
  bundleRef: HostedExecutionBundleRef | null;
  committedAt: string;
  eventId: string;
  finalizedAt: string | null;
  gatewayProjectionSnapshot: GatewayProjectionSnapshot | null;
  result: HostedExecutionRunnerResult["result"];
  userId: string;
}

export interface HostedExecutionCommitPayload {
  assistantDeliveryEffects: HostedAssistantDeliveryEffect[];
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
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        existingAssistantDeliveryCount: existing.assistantDeliveryEffects.length,
        existingCommittedAt: existing.committedAt,
        existingFinalizedAt: existing.finalizedAt,
        incomingAssistantDeliveryCount: requireAssistantDeliveryEffects(
          input.payload.assistantDeliveryEffects,
          "Hosted execution duplicate commit payload.assistantDeliveryEffects",
        ).length,
      },
      eventId: input.eventId,
      message: "Hosted duplicate durable commit attempt encountered an existing commit.",
      phase: "commit.recorded",
    });
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
  const assistantDeliveryEffects = requireAssistantDeliveryEffects(
    input.payload.assistantDeliveryEffects,
    "Hosted execution commit payload.assistantDeliveryEffects",
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

  const expectedBundleRef = resolveExpectedCommittedBundleRef(
    existing.bundleRef,
    input.payload.bundle,
  );
  const expectedGatewayProjectionSnapshot =
    input.payload.gatewayProjectionSnapshot ?? existing.gatewayProjectionSnapshot ?? null;

  if (existing.finalizedAt !== null) {
    assertEquivalentDuplicateFinalize(existing, {
      eventId: input.eventId,
      expectedBundleRef,
      expectedGatewayProjectionSnapshot,
    });
    return existing;
  }

  const nextBundleRef = sameHostedBundlePayloadRef(expectedBundleRef, existing.bundleRef)
    ? existing.bundleRef
    : await writeHostedBase64BundleIfChanged({
        bundleStore: createHostedBundleStore({
          bucket: input.bucket,
          key: input.key,
          keyId: input.keyId,
          keysById: input.keysById,
        }),
        currentRef: existing.bundleRef,
        kind: "vault",
        value: input.payload.bundle,
      });

  const finalizedResult: HostedExecutionCommittedResult = {
    ...existing,
    bundleRef: nextBundleRef,
    finalizedAt: new Date().toISOString(),
    gatewayProjectionSnapshot: expectedGatewayProjectionSnapshot,
  };
  await journalStore.writeCommittedResult(input.userId, input.eventId, finalizedResult);
  return finalizedResult;
}

function normalizeHostedExecutionCommittedResult(
  value: HostedExecutionCommittedResult,
): HostedExecutionCommittedResult {
  const record = value as {
    assistantDeliveryEffects?: unknown;
    sideEffects?: unknown;
  };
  rejectRemovedHostedExecutionField(
    record,
    "sideEffects",
    "Hosted execution committed result",
  );
  const assistantDeliveryEffects = requireAssistantDeliveryEffects(
    record.assistantDeliveryEffects,
    "Hosted execution committed result.assistantDeliveryEffects",
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

function assertEquivalentDuplicateFinalize(
  existing: HostedExecutionCommittedResult,
  input: {
    eventId: string;
    expectedBundleRef: HostedExecutionBundleRefIdentity | null;
    expectedGatewayProjectionSnapshot: GatewayProjectionSnapshot | null;
  },
): void {
  if (!sameHostedBundlePayloadRef(existing.bundleRef, input.expectedBundleRef)) {
    throw new Error(
      `Hosted execution finalize ${input.eventId} vault bundle ref does not match the existing durable finalize.`,
    );
  }

  if (
    !sameStructuredJsonValue(
      existing.gatewayProjectionSnapshot ?? null,
      input.expectedGatewayProjectionSnapshot,
    )
  ) {
    throw new Error(
      `Hosted execution finalize ${input.eventId} gateway projection snapshot does not match the existing durable finalize.`,
    );
  }
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

  if (!sameStructuredJsonValue(existing.result, input.payload.result)) {
    throw new Error(
      `Hosted execution commit ${input.eventId} result does not match the existing durable commit.`,
    );
  }

  const expectedAssistantDeliveryEffects = requireAssistantDeliveryEffects(
    input.payload.assistantDeliveryEffects,
    "Hosted execution commit payload.assistantDeliveryEffects",
  );
  if (
    !sameStructuredJsonValue(
      sortHostedAssistantDeliveryCommitEquivalenceSummary(
        summarizeHostedAssistantDeliveryCommitEquivalence(existing.assistantDeliveryEffects),
      ),
      sortHostedAssistantDeliveryCommitEquivalenceSummary(
        summarizeHostedAssistantDeliveryCommitEquivalence(expectedAssistantDeliveryEffects),
      ),
    )
  ) {
    emitHostedDuplicateCommitMismatchLog({
      eventId: input.eventId,
      existing,
      mismatch: "assistant_delivery_effects",
      payload: input.payload,
    });
    throw new Error(
      `Hosted execution commit ${input.eventId} assistant deliveries do not match the existing durable commit.`,
    );
  }

  const expectedGatewayProjectionSnapshot = input.payload.gatewayProjectionSnapshot ?? null;
  if (
    !sameStructuredJsonValue(
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

type HostedDuplicateCommitMismatchKind =
  | "assistant_delivery_effects";

function emitHostedDuplicateCommitMismatchLog(input: {
  eventId: string;
  existing: HostedExecutionCommittedResult;
  mismatch: HostedDuplicateCommitMismatchKind;
  payload: HostedExecutionCommitPayload;
}): void {
  const existingAssistantDeliveriesInOrder = summarizeHostedAssistantDeliveryEffects(
    input.existing.assistantDeliveryEffects,
  );
  const incomingAssistantDeliveriesInOrder = summarizeHostedAssistantDeliveryEffects(
    requireAssistantDeliveryEffects(
      input.payload.assistantDeliveryEffects,
      "Hosted execution duplicate commit payload.assistantDeliveryEffects",
    ),
  );
  const existingAssistantDeliveriesSorted = sortHostedAssistantDeliveryEffectsSummary(
    existingAssistantDeliveriesInOrder,
  );
  const incomingAssistantDeliveriesSorted = sortHostedAssistantDeliveryEffectsSummary(
    incomingAssistantDeliveriesInOrder,
  );
  const existingAssistantDeliveryReplayIdentitiesSorted =
    sortHostedAssistantDeliveryReplayIdentitySummary(
      summarizeHostedAssistantDeliveryReplayIdentities(input.existing.assistantDeliveryEffects),
    );
  const incomingAssistantDeliveryReplayIdentitiesSorted =
    sortHostedAssistantDeliveryReplayIdentitySummary(
      summarizeHostedAssistantDeliveryReplayIdentities(
        requireAssistantDeliveryEffects(
          input.payload.assistantDeliveryEffects,
          "Hosted execution duplicate commit payload.assistantDeliveryEffects",
        ),
      ),
    );

  emitHostedExecutionStructuredLog({
    component: "runner",
    details: {
      existingAssistantDeliveryCount: existingAssistantDeliveriesInOrder.length,
      existingAssistantDeliveriesInOrder,
      existingAssistantDeliveryReplayIdentitiesSorted,
      existingAssistantDeliveriesSorted,
      existingCommittedAt: input.existing.committedAt,
      existingFinalizedAt: input.existing.finalizedAt,
      incomingAssistantDeliveryCount: incomingAssistantDeliveriesInOrder.length,
      incomingAssistantDeliveriesInOrder,
      incomingAssistantDeliveryReplayIdentitiesSorted,
      incomingAssistantDeliveriesSorted,
      mismatch: input.mismatch,
      sortedAssistantDeliveryReplayIdentitiesMatch: sameStructuredJsonValue(
        existingAssistantDeliveryReplayIdentitiesSorted,
        incomingAssistantDeliveryReplayIdentitiesSorted,
      ),
      sortedAssistantDeliveriesMatch: sameStructuredJsonValue(
        existingAssistantDeliveriesSorted,
        incomingAssistantDeliveriesSorted,
      ),
    },
    eventId: input.eventId,
    level: "error",
    message: "Hosted duplicate durable commit payload diverged from the existing commit.",
    phase: "failed",
  });
}

function summarizeHostedAssistantDeliveryEffects(
  effects: readonly HostedAssistantDeliveryEffect[],
): {
  effectId: string;
  fingerprint: string;
  payload: HostedAssistantDeliveryPayloadSummary;
}[] {
  return effects.map((effect) => ({
    effectId: effect.effectId,
    fingerprint: effect.fingerprint,
    payload: summarizeHostedAssistantDeliveryPayload(effect.payload),
  }));
}

function summarizeHostedAssistantDeliveryReplayIdentities(
  effects: readonly HostedAssistantDeliveryEffect[],
): {
  fingerprint: string;
  kind: HostedAssistantDeliveryEffect["kind"];
}[] {
  return effects.map((effect) => ({
    fingerprint: effect.fingerprint,
    kind: effect.kind,
  }));
}

function summarizeHostedAssistantDeliveryCommitEquivalence(
  effects: readonly HostedAssistantDeliveryEffect[],
): {
  fingerprint: string;
  payload: HostedAssistantDeliveryPayloadSummary;
}[] {
  return effects.map((effect) => ({
    fingerprint: effect.fingerprint,
    payload: summarizeHostedAssistantDeliveryPayload(effect.payload),
  }));
}

function sortHostedAssistantDeliveryEffectsSummary(input: readonly {
  effectId: string;
  fingerprint: string;
  payload: HostedAssistantDeliveryPayloadSummary;
}[]): {
  effectId: string;
  fingerprint: string;
  payload: HostedAssistantDeliveryPayloadSummary;
}[] {
  return [...input].sort((left, right) => {
    const effectIdOrder = left.effectId.localeCompare(right.effectId);
    if (effectIdOrder !== 0) {
      return effectIdOrder;
    }

    return left.fingerprint.localeCompare(right.fingerprint);
  });
}

function sortHostedAssistantDeliveryReplayIdentitySummary(input: readonly {
  fingerprint: string;
  kind: HostedAssistantDeliveryEffect["kind"];
}[]): {
  fingerprint: string;
  kind: HostedAssistantDeliveryEffect["kind"];
}[] {
  return [...input].sort((left, right) => {
    const fingerprintOrder = left.fingerprint.localeCompare(right.fingerprint);
    if (fingerprintOrder !== 0) {
      return fingerprintOrder;
    }

    return left.kind.localeCompare(right.kind);
  });
}

function sortHostedAssistantDeliveryCommitEquivalenceSummary(input: readonly {
  fingerprint: string;
  payload: HostedAssistantDeliveryPayloadSummary;
}[]): {
  fingerprint: string;
  payload: HostedAssistantDeliveryPayloadSummary;
}[] {
  return [...input].sort((left, right) => {
    const fingerprintOrder = left.fingerprint.localeCompare(right.fingerprint);
    if (fingerprintOrder !== 0) {
      return fingerprintOrder;
    }

    return JSON.stringify(left.payload).localeCompare(JSON.stringify(right.payload));
  });
}

type HostedAssistantDeliveryPayloadSummary = {
  actorId: string | null;
  bindingDeliveryKind: HostedAssistantDeliveryEffect["payload"]["bindingDeliveryKind"];
  bindingDeliveryTarget: string | null;
  channel: string | null;
  explicitTarget: string | null;
  identityId: string | null;
  idempotencyKey: string;
  message: string;
  subject: string | null;
  replyToMessageId: string | null;
  sessionId: string;
  threadId: string | null;
  threadIsDirect: boolean | null;
  transportIdempotent: boolean;
  turnId: string;
};

function summarizeHostedAssistantDeliveryPayload(
  payload: HostedAssistantDeliveryEffect["payload"],
): HostedAssistantDeliveryPayloadSummary {
  return {
    actorId: payload.actorId,
    bindingDeliveryKind: payload.bindingDeliveryKind,
    bindingDeliveryTarget: payload.bindingDeliveryTarget,
    channel: payload.channel,
    explicitTarget: payload.explicitTarget,
    identityId: payload.identityId,
    idempotencyKey: payload.idempotencyKey,
    message: payload.message,
    subject: payload.subject,
    replyToMessageId: payload.replyToMessageId,
    sessionId: payload.sessionId,
    threadId: payload.threadId,
    threadIsDirect: payload.threadIsDirect,
    transportIdempotent: payload.transportIdempotent,
    turnId: payload.turnId,
  };
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

function rejectRemovedHostedExecutionField(
  record: Record<string, unknown>,
  field: string,
  label: string,
): void {
  if (record[field] !== undefined) {
    throw new TypeError(`${label}.${field} is no longer supported.`);
  }
}

function requireAssistantDeliveryEffects(
  value: unknown,
  label: string,
): HostedAssistantDeliveryEffect[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return parseHostedAssistantDeliveryEffects(value);
}
