import {
  decodeHostedBundleBase64,
  encodeHostedBundleBase64,
  sameHostedBundlePayloadRef,
  type HostedExecutionBundleRef,
} from "@murph/runtime-state";
import type { HostedExecutionRunnerResult } from "@murph/hosted-execution";

import {
  createHostedBundleStore,
  createHostedUserEnvStore,
  writeHostedBundleBytesIfChanged,
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
    return {
      agentState: encodeHostedBundleBase64(await store.readBundle(bundleState.bundleRefs.agentState)),
      vault: encodeHostedBundleBase64(await store.readBundle(bundleState.bundleRefs.vault)),
    };
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
  ): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    const currentUserEnv = await this.readUserEnv(userId);
    const nextUserEnv = applyHostedUserEnvUpdate({
      current: currentUserEnv,
      source: this.userEnvSource,
      update,
    });

    if (Object.keys(nextUserEnv).length === 0) {
      await this.createUserEnvStore().clearUserEnv(userId);
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
    const nextAgentStateBytes = decodeHostedBundleBase64(bundles.agentState);
    const nextVaultBytes = decodeHostedBundleBase64(bundles.vault);

    for (let attempt = 0; attempt < BUNDLE_SWAP_RETRY_LIMIT; attempt += 1) {
      const bundleState = await this.queueStore.readBundleMetaState();
      const nextBundleRefs = {
        agentState: bundles.agentState === null
          ? null
          : await writeHostedBundleBytesIfChanged({
              bundleStore,
              currentRef: bundleState.bundleRefs.agentState,
              kind: "agent-state",
              plaintext: nextAgentStateBytes ?? new Uint8Array(),
            }),
        vault: bundles.vault === null
          ? null
          : await writeHostedBundleBytesIfChanged({
              bundleStore,
              currentRef: bundleState.bundleRefs.vault,
              kind: "vault",
              plaintext: nextVaultBytes ?? new Uint8Array(),
            }),
      };

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

      if (
        bundleState.bundleVersions.agentState !== nextExpectedVersions.agentState
        && !sameHostedBundlePayloadRef(bundleState.bundleRefs.agentState, nextBundleRefs.agentState)
      ) {
        throw new Error(`Hosted agent-state bundle changed during finalize for ${userId}.`);
      }

      if (
        bundleState.bundleVersions.vault !== nextExpectedVersions.vault
        && !sameHostedBundlePayloadRef(bundleState.bundleRefs.vault, nextBundleRefs.vault)
      ) {
        throw new Error(`Hosted vault bundle changed during finalize for ${userId}.`);
      }

      nextExpectedVersions = swapped.record.bundleVersions;
    }

    throw new Error(`Hosted bundle finalize for ${userId} conflicted too many times.`);
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
    nextBundleRefs: {
      agentState: HostedExecutionBundleRef | null;
      vault: HostedExecutionBundleRef | null;
    };
    previousBundleRefs: {
      agentState: HostedExecutionBundleRef | null;
      vault: HostedExecutionBundleRef | null;
    };
    userId: string;
  }): Promise<void> {
    try {
      await this.garbageCollector.cleanupBundleTransition(input);
    } catch {
      // Best-effort cleanup only; do not fail successful bundle swaps.
    }
  }
}
