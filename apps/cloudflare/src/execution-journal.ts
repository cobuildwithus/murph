import {
  decodeHostedBundleBase64,
  sha256HostedBundleHex,
  type HostedExecutionBundleRef,
  type HostedExecutionRunnerResult,
} from "@murph/runtime-state";
import {
  parseHostedExecutionSideEffects,
  type HostedExecutionSideEffect,
} from "@murph/assistant-runtime";

import { createHostedBundleStore, type R2BucketLike } from "./bundle-store.js";
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
  result: HostedExecutionRunnerResult["result"];
  sideEffects: HostedExecutionSideEffect[];
}

export interface HostedExecutionCommitPayload {
  bundles: HostedExecutionRunnerResult["bundles"];
  result: HostedExecutionRunnerResult["result"];
  sideEffects?: HostedExecutionSideEffect[];
}

export interface HostedExecutionFinalizePayload {
  bundles: HostedExecutionRunnerResult["bundles"];
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
}): HostedExecutionJournalStore {
  return {
    async deleteCommittedResult(userId, eventId) {
      for (const key of committedResultObjectKeys(userId, eventId)) {
        await input.bucket.delete?.(key);
      }
    },

    async readCommittedResult(userId, eventId) {
      for (const key of committedResultObjectKeys(userId, eventId)) {
        const result = await readEncryptedR2Json({
          bucket: input.bucket,
          cryptoKey: input.key,
          key,
          parse(value) {
            return normalizeHostedExecutionCommittedResult(value as HostedExecutionCommittedResult);
          },
        });

        if (result) {
          return result;
        }
      }

      return null;
    },

    async writeCommittedResult(userId, eventId, value) {
      await writeEncryptedR2Json({
        bucket: input.bucket,
        cryptoKey: input.key,
        key: committedResultPrimaryObjectKey(userId, eventId),
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
  payload: HostedExecutionCommitPayload;
  userId: string;
}): Promise<HostedExecutionCommittedResult> {
  const existing = await createHostedExecutionJournalStore({
    bucket: input.bucket,
    key: input.key,
    keyId: input.keyId,
  }).readCommittedResult(input.userId, input.eventId);

  if (existing) {
    return existing;
  }

  const bundleStore = createHostedBundleStore({
    bucket: input.bucket,
    key: input.key,
    keyId: input.keyId,
  });
  const committedAt = new Date().toISOString();
  const committedResult: HostedExecutionCommittedResult = {
    bundleRefs: {
      agentState: await writeCommittedBundle({
        bundleStore,
        currentRef: input.currentBundleRefs.agentState,
        kind: "agent-state",
        value: input.payload.bundles.agentState,
      }),
      vault: await writeCommittedBundle({
        bundleStore,
        currentRef: input.currentBundleRefs.vault,
        kind: "vault",
        value: input.payload.bundles.vault,
      }),
    },
    committedAt,
    eventId: input.eventId,
    finalizedAt: null,
    result: input.payload.result,
    sideEffects: parseHostedExecutionSideEffects(input.payload.sideEffects),
  };

  await createHostedExecutionJournalStore({
    bucket: input.bucket,
    key: input.key,
    keyId: input.keyId,
  }).writeCommittedResult(input.userId, input.eventId, committedResult);

  return committedResult;
}

export async function persistHostedExecutionFinalBundles(input: {
  bucket: R2BucketLike;
  eventId: string;
  key: Uint8Array;
  keyId: string;
  payload: HostedExecutionFinalizePayload;
  userId: string;
}): Promise<HostedExecutionCommittedResult> {
  const journalStore = createHostedExecutionJournalStore({
    bucket: input.bucket,
    key: input.key,
    keyId: input.keyId,
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
  });
  const nextBundleRefs = {
    agentState: await writeCommittedBundle({
      bundleStore,
      currentRef: existing.bundleRefs.agentState,
      kind: "agent-state",
      value: input.payload.bundles.agentState,
    }),
    vault: await writeCommittedBundle({
      bundleStore,
      currentRef: existing.bundleRefs.vault,
      kind: "vault",
      value: input.payload.bundles.vault,
    }),
  };

  if (
    sameHostedBundleRef(nextBundleRefs.agentState, existing.bundleRefs.agentState)
    && sameHostedBundleRef(nextBundleRefs.vault, existing.bundleRefs.vault)
    && existing.finalizedAt !== null
  ) {
    return existing;
  }

  const finalizedResult: HostedExecutionCommittedResult = {
    ...existing,
    bundleRefs: nextBundleRefs,
    finalizedAt: existing.finalizedAt ?? new Date().toISOString(),
  };
  await journalStore.writeCommittedResult(input.userId, input.eventId, finalizedResult);
  return finalizedResult;
}

async function writeCommittedBundle(input: {
  bundleStore: ReturnType<typeof createHostedBundleStore>;
  currentRef: HostedExecutionBundleRef | null;
  kind: "agent-state" | "vault";
  value: string | null;
}): Promise<HostedExecutionBundleRef | null> {
  if (input.value === null) {
    return null;
  }

  const plaintext = decodeHostedBundleBase64(input.value) ?? new Uint8Array();
  const hash = sha256HostedBundleHex(plaintext);

  if (
    input.currentRef
    && input.currentRef.hash === hash
    && input.currentRef.size === plaintext.byteLength
  ) {
    return input.currentRef;
  }

  const ref = await input.bundleStore.writeBundle(input.kind, plaintext);

  return {
    ...ref,
    size: ref.size ?? plaintext.byteLength,
  };
}

function committedResultPrimaryObjectKey(userId: string, eventId: string): string {
  return `transient/execution-journal/${encodeURIComponent(userId)}/${encodeURIComponent(eventId)}.json`;
}

function committedResultLegacyObjectKey(userId: string, eventId: string): string {
  return `users/${encodeURIComponent(userId)}/execution-journal/${encodeURIComponent(eventId)}.json`;
}

function committedResultObjectKeys(userId: string, eventId: string): string[] {
  return [
    committedResultPrimaryObjectKey(userId, eventId),
    committedResultLegacyObjectKey(userId, eventId),
  ];
}

function normalizeHostedExecutionCommittedResult(
  value: HostedExecutionCommittedResult,
): HostedExecutionCommittedResult {
  return {
    ...value,
    finalizedAt: value.finalizedAt ?? null,
    sideEffects: parseHostedExecutionSideEffects((value as { sideEffects?: unknown }).sideEffects),
  };
}

function sameHostedBundleRef(
  left: HostedExecutionBundleRef | null,
  right: HostedExecutionBundleRef | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.hash === right.hash
    && left.key === right.key
    && left.size === right.size
    && left.updatedAt === right.updatedAt
  );
}
