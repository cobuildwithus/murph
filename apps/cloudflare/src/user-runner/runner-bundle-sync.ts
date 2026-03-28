import {
  decodeHostedBundleBase64,
  encodeHostedBundleBase64,
  sha256HostedBundleHex,
} from "@murph/runtime-state";
import type {
  HostedExecutionBundleRef,
  HostedExecutionBundleKind,
  HostedExecutionRunnerResult,
} from "@murph/hosted-execution";

import {
  createHostedBundleStore,
  createHostedUserEnvStore,
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
  sameBundleRef,
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
    private readonly queueStore: RunnerQueueStore,
    private readonly userEnvSource: Readonly<Record<string, string | undefined>>,
  ) {
    this.garbageCollector = new HostedBundleGarbageCollector(
      bucket,
      bundleEncryptionKey,
      bundleEncryptionKeyId,
    );
  }

  async readBundlesForRunner(userId: string): Promise<HostedExecutionRunnerResult["bundles"]> {
    const store = this.createBundleStore();
    const bundleState = await this.queueStore.readBundleState();
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
    const nextAgentStateBytes = decodeHostedBundleBase64(bundles.agentState);
    const nextVaultBytes = decodeHostedBundleBase64(bundles.vault);

    for (let attempt = 0; attempt < BUNDLE_SWAP_RETRY_LIMIT; attempt += 1) {
      const bundleState = await this.queueStore.readBundleState();
      const nextBundleRefs = {
        agentState: await this.resolveNextBundleRef(
          userId,
          "agent-state",
          nextAgentStateBytes,
          bundles.agentState,
          bundleState.bundleRefs.agentState,
        ),
        vault: await this.resolveNextBundleRef(
          userId,
          "vault",
          nextVaultBytes,
          bundles.vault,
          bundleState.bundleRefs.vault,
        ),
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
        && !sameBundleRef(bundleState.bundleRefs.agentState, nextBundleRefs.agentState)
      ) {
        throw new Error(`Hosted agent-state bundle changed during finalize for ${userId}.`);
      }

      if (
        bundleState.bundleVersions.vault !== nextExpectedVersions.vault
        && !sameBundleRef(bundleState.bundleRefs.vault, nextBundleRefs.vault)
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
    });
  }

  private createUserEnvStore() {
    return createHostedUserEnvStore({
      bucket: this.bucket,
      key: this.bundleEncryptionKey,
      keyId: this.bundleEncryptionKeyId,
    });
  }

  private async resolveNextBundleRef(
    userId: string,
    kind: HostedExecutionBundleKind,
    decodedBundle: Uint8Array | null,
    encodedBundle: string | null,
    currentRef: HostedExecutionBundleRef | null,
  ): Promise<HostedExecutionBundleRef | null> {
    if (encodedBundle === null) {
      return null;
    }

    return this.writeBundleBytes(
      kind,
      decodedBundle ?? new Uint8Array(),
      currentRef,
    );
  }

  private async writeBundleBytes(
    kind: HostedExecutionBundleKind,
    plaintext: Uint8Array,
    currentRef: HostedExecutionBundleRef | null,
  ) {
    const hash = sha256HostedBundleHex(plaintext);
    if (currentRef && currentRef.hash === hash && currentRef.size === plaintext.byteLength) {
      return currentRef;
    }

    const ref = await this.createBundleStore().writeBundle(kind, plaintext);
    return {
      ...ref,
      size: ref.size ?? plaintext.byteLength,
    };
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
