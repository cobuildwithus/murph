import {
  decodeHostedBundleBase64,
  encodeHostedBundleBase64,
  sameHostedBundlePayloadRef,
} from "@murphai/runtime-state/node";
import { readHostedVerifiedEmailFromEnv } from "@murphai/runtime-state";
import {
  HOSTED_EXECUTION_BUNDLE_SLOTS,
  mapHostedExecutionBundleSlotsAsync,
  resolveHostedExecutionBundleKind,
  type HostedExecutionBundleRefs,
  type HostedExecutionBundleSlot,
  type HostedExecutionRunnerResult,
  type HostedExecutionUserEnvStatus,
} from "@murphai/hosted-execution";

import {
  ensureHostedEmailVerifiedSenderRouteAvailable,
  readHostedEmailConfig,
  reconcileHostedEmailVerifiedSenderRoute,
} from "../hosted-email.js";
import {
  createHostedBundleStore,
  createHostedUserEnvStore,
  writeHostedBundleBytesIfChanged,
  type HostedBundleStore,
  type R2BucketLike,
} from "../bundle-store.js";
import { HostedBundleGarbageCollector } from "../bundle-gc.js";
import {
  applyHostedUserEnvUpdate,
  decodeHostedUserEnvPayload,
  encodeHostedUserEnvPayload,
  listHostedUserEnvKeys,
  type HostedUserEnvUpdate,
} from "../user-env.js";
import { RunnerQueueStore } from "./runner-queue-store.js";
import {
  type RunnerBundleVersions,
  type RunnerStateRecord,
} from "./types.js";

const BUNDLE_SWAP_RETRY_LIMIT = 4;

export class RunnerBundleSync {
  private readonly garbageCollector: HostedBundleGarbageCollector;

  constructor(
    private readonly bucket: R2BucketLike,
    private readonly bundleEncryptionKey: Uint8Array,
    private readonly bundleEncryptionKeyId: string,
    private readonly bundleEncryptionKeysById: Readonly<Record<string, Uint8Array>>,
    private readonly queueStore: RunnerQueueStore,
    private readonly userEnvSource: Readonly<Record<string, string | undefined>>,
  ) {
    this.garbageCollector = new HostedBundleGarbageCollector(
      bucket,
      bundleEncryptionKey,
      bundleEncryptionKeyId,
      bundleEncryptionKeysById,
    );
  }

  async readBundlesForRunner(): Promise<HostedExecutionRunnerResult["bundles"]> {
    const store = this.createBundleStore();
    const bundleState = await this.queueStore.readBundleMetaState();
    return mapHostedExecutionBundleSlotsAsync(async (slot) =>
      encodeHostedBundleBase64(await readRequiredBundleForRunner({
        bundleStore: store,
        ref: bundleState.bundleRefs[slot],
        slot,
      }))
    );
  }

  async readUserEnv(userId: string): Promise<Record<string, string>> {
    return decodeHostedUserEnvPayload(
      await this.createUserEnvStore().readUserEnv(userId),
      this.userEnvSource,
    );
  }

  async updateUserEnv(
    userId: string,
    update: HostedUserEnvUpdate,
  ): Promise<HostedExecutionUserEnvStatus> {
    const currentUserEnv = await this.readUserEnv(userId);
    const nextUserEnv = applyHostedUserEnvUpdate({
      current: currentUserEnv,
      source: this.userEnvSource,
      update,
    });
    const hostedEmailConfig = readHostedEmailConfig(this.userEnvSource);
    const previousVerifiedEmailAddress = readHostedVerifiedEmailFromEnv(currentUserEnv)?.address ?? null;
    const nextVerifiedEmailAddress = readHostedVerifiedEmailFromEnv(nextUserEnv)?.address ?? null;

    await ensureHostedEmailVerifiedSenderRouteAvailable({
      bucket: this.bucket,
      config: hostedEmailConfig,
      key: this.bundleEncryptionKey,
      keyId: this.bundleEncryptionKeyId,
      keysById: this.bundleEncryptionKeysById,
      userId,
      verifiedEmailAddress: nextVerifiedEmailAddress,
    });

    if (Object.keys(nextUserEnv).length === 0) {
      await this.createUserEnvStore().clearUserEnv(userId);
      await reconcileHostedEmailVerifiedSenderRoute({
        bucket: this.bucket,
        config: hostedEmailConfig,
        key: this.bundleEncryptionKey,
        keyId: this.bundleEncryptionKeyId,
        keysById: this.bundleEncryptionKeysById,
        nextVerifiedEmailAddress,
        previousVerifiedEmailAddress,
        userId,
      });
      return {
        configuredUserEnvKeys: [],
        userId,
      };
    }

    await this.createUserEnvStore().writeUserEnv(
      userId,
      encodeHostedUserEnvPayload({
        env: nextUserEnv,
      }) as Uint8Array,
    );
    await reconcileHostedEmailVerifiedSenderRoute({
      bucket: this.bucket,
      config: hostedEmailConfig,
      key: this.bundleEncryptionKey,
      keyId: this.bundleEncryptionKeyId,
      keysById: this.bundleEncryptionKeysById,
      nextVerifiedEmailAddress,
      previousVerifiedEmailAddress,
      userId,
    });

    return {
      configuredUserEnvKeys: listHostedUserEnvKeys(nextUserEnv),
      userId,
    };
  }

  async applyRunnerResultBundles(
    userId: string,
    expectedVersions: RunnerBundleVersions,
    bundles: HostedExecutionRunnerResult["bundles"],
  ): Promise<RunnerStateRecord> {
    let nextExpectedVersions = expectedVersions;
    const bundleStore = this.createBundleStore();
    const nextBundleBytesBySlot = await mapHostedExecutionBundleSlotsAsync((slot) =>
      decodeHostedBundleBase64(bundles[slot])
    );

    for (let attempt = 0; attempt < BUNDLE_SWAP_RETRY_LIMIT; attempt += 1) {
      const bundleState = await this.queueStore.readBundleMetaState();
      const nextBundleRefs = await mapHostedExecutionBundleSlotsAsync(async (slot) =>
        bundles[slot] === null
          ? null
          : writeHostedBundleBytesIfChanged({
              bundleStore,
              currentRef: bundleState.bundleRefs[slot],
              kind: resolveHostedExecutionBundleKind(slot),
              plaintext: nextBundleBytesBySlot[slot] ?? new Uint8Array(),
            })
      );

      const swapped = await this.queueStore.compareAndSwapBundleRefs({
        expectedVersions: nextExpectedVersions,
        nextBundleRefs,
      });

      if (swapped.applied) {
        await this.cleanupBundleTransitionBestEffort({
          nextBundleRefs,
          previousBundleRefs: bundleState.bundleRefs,
          userId,
        });
        return swapped.record;
      }

      assertBundleRefsStillCompatible({
        currentBundleRefs: swapped.record.bundleRefs,
        currentVersions: swapped.record.bundleVersions,
        nextBundleRefs,
        previousExpectedVersions: nextExpectedVersions,
        userId,
      });

      nextExpectedVersions = swapped.record.bundleVersions;
    }

    throw new Error(`Hosted bundle update for ${userId} conflicted too many times.`);
  }

  private createBundleStore() {
    return createHostedBundleStore({
      bucket: this.bucket,
      key: this.bundleEncryptionKey,
      keyId: this.bundleEncryptionKeyId,
      keysById: this.bundleEncryptionKeysById,
    });
  }

  private createUserEnvStore() {
    return createHostedUserEnvStore({
      bucket: this.bucket,
      key: this.bundleEncryptionKey,
      keyId: this.bundleEncryptionKeyId,
      keysById: this.bundleEncryptionKeysById,
    });
  }

  private async cleanupBundleTransitionBestEffort(input: {
    nextBundleRefs: HostedExecutionBundleRefs;
    previousBundleRefs: HostedExecutionBundleRefs;
    userId: string;
  }): Promise<void> {
    try {
      await this.garbageCollector.cleanupBundleTransition(input);
    } catch {
      // Best-effort cleanup only; do not fail successful bundle swaps.
    }
  }
}

async function readRequiredBundleForRunner(input: {
  bundleStore: HostedBundleStore;
  ref: HostedExecutionBundleRefs[HostedExecutionBundleSlot];
  slot: HostedExecutionBundleSlot;
}): Promise<Uint8Array | null> {
  if (!input.ref) {
    return null;
  }

  const bytes = await input.bundleStore.readBundle(input.ref);
  if (!bytes) {
    throw new Error(
      `Hosted ${resolveHostedExecutionBundleKind(input.slot)} bundle ${input.ref.key} is missing from R2.`,
    );
  }

  return bytes;
}

function assertBundleRefsStillCompatible(input: {
  currentBundleRefs: RunnerStateRecord["bundleRefs"];
  currentVersions: RunnerBundleVersions;
  nextBundleRefs: RunnerStateRecord["bundleRefs"];
  previousExpectedVersions: RunnerBundleVersions;
  userId: string;
}): void {
  for (const slot of HOSTED_EXECUTION_BUNDLE_SLOTS) {
    if (
      input.currentVersions[slot] === input.previousExpectedVersions[slot]
      || sameHostedBundlePayloadRef(
        input.currentBundleRefs[slot],
        input.nextBundleRefs[slot],
      )
    ) {
      continue;
    }

    throw new Error(
      `Hosted ${resolveHostedExecutionBundleKind(slot)} bundle changed while applying the runner result for ${input.userId}.`,
    );
  }
}
