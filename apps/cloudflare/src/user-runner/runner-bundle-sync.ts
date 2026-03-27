import {
  decodeHostedBundleBase64,
  encodeHostedBundleBase64,
  sha256HostedBundleHex,
  type HostedExecutionBundleRef,
  type HostedExecutionBundleKind,
  type HostedExecutionRunnerResult,
} from "@healthybob/runtime-state";

import { createHostedBundleStore, type R2BucketLike } from "../bundle-store.js";
import {
  applyHostedUserEnvUpdate,
  listHostedUserEnvKeys,
  readHostedUserEnvFromAgentStateBundle,
  writeHostedUserEnvToAgentStateBundle,
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
  constructor(
    private readonly bucket: R2BucketLike,
    private readonly bundleEncryptionKey: Uint8Array,
    private readonly bundleEncryptionKeyId: string,
    private readonly queueStore: RunnerQueueStore,
    private readonly userEnvSource: Readonly<Record<string, string | undefined>>,
  ) {}

  async readBundlesForRunner(userId: string): Promise<HostedExecutionRunnerResult["bundles"]> {
    const store = this.createBundleStore();
    return {
      agentState: encodeHostedBundleBase64(await store.readBundle(userId, "agent-state")),
      vault: encodeHostedBundleBase64(await store.readBundle(userId, "vault")),
    };
  }

  async readUserEnv(userId: string): Promise<Record<string, string>> {
    return readHostedUserEnvFromAgentStateBundle(
      await this.createBundleStore().readBundle(userId, "agent-state"),
      this.userEnvSource,
    );
  }

  async updateUserEnv(
    userId: string,
    update: HostedUserEnvUpdate,
  ): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    for (let attempt = 0; attempt < BUNDLE_SWAP_RETRY_LIMIT; attempt += 1) {
      const bundleState = await this.queueStore.readBundleState(userId);
      const currentBundle = await this.createBundleStore().readBundle(userId, "agent-state");
      const currentUserEnv = readHostedUserEnvFromAgentStateBundle(currentBundle, this.userEnvSource);
      const nextUserEnv = applyHostedUserEnvUpdate({
        current: currentUserEnv,
        source: this.userEnvSource,
        update,
      });

      if (currentBundle === null && Object.keys(nextUserEnv).length === 0) {
        return {
          configuredUserEnvKeys: [],
          userId,
        };
      }

      const nextBundle = writeHostedUserEnvToAgentStateBundle({
        agentStateBundle: currentBundle,
        env: nextUserEnv,
      });
      const nextAgentStateRef = await this.writeBundleBytes(
        userId,
        "agent-state",
        nextBundle,
        bundleState.bundleRefs.agentState,
      );
      const swapped = await this.queueStore.compareAndSwapBundleRefs(userId, {
        expectedVersions: bundleState.bundleVersions,
        nextBundleRefs: {
          agentState: nextAgentStateRef,
          vault: bundleState.bundleRefs.vault,
        },
      });

      if (swapped.applied) {
        return {
          configuredUserEnvKeys: listHostedUserEnvKeys(nextUserEnv),
          userId,
        };
      }
    }

    throw new Error(`Hosted user env update for ${userId} conflicted too many times.`);
  }

  async applyRunnerResultBundles(
    userId: string,
    expectedVersions: RunnerBundleVersions,
    bundles: HostedExecutionRunnerResult["bundles"],
  ): Promise<RunnerStateRecord> {
    let nextExpectedVersions = expectedVersions;
    let nextAgentStateBytes = decodeHostedBundleBase64(bundles.agentState);
    const nextVaultBytes = decodeHostedBundleBase64(bundles.vault);

    for (let attempt = 0; attempt < BUNDLE_SWAP_RETRY_LIMIT; attempt += 1) {
      const bundleState = await this.queueStore.readBundleState(userId);
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

      const swapped = await this.queueStore.compareAndSwapBundleRefs(userId, {
        expectedVersions: nextExpectedVersions,
        nextBundleRefs,
      });

      if (swapped.applied) {
        return swapped.record;
      }

      if (
        bundleState.bundleVersions.vault !== nextExpectedVersions.vault
        && !sameBundleRef(bundleState.bundleRefs.vault, nextBundleRefs.vault)
      ) {
        throw new Error(`Hosted vault bundle changed during finalize for ${userId}.`);
      }

      nextExpectedVersions = swapped.record.bundleVersions;

      if (bundles.agentState === null) {
        return swapped.record;
      }

      nextAgentStateBytes = await this.mergeLatestUserEnvIntoAgentStateBundle(userId, bundles.agentState);
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

  private async mergeLatestUserEnvIntoAgentStateBundle(
    userId: string,
    encodedAgentStateBundle: string | null,
  ): Promise<Uint8Array | null> {
    if (encodedAgentStateBundle === null) {
      return null;
    }

    const latestAgentStateBundle = await this.createBundleStore().readBundle(userId, "agent-state");
    const latestUserEnv = readHostedUserEnvFromAgentStateBundle(
      latestAgentStateBundle,
      this.userEnvSource,
    );

    return writeHostedUserEnvToAgentStateBundle({
      agentStateBundle: decodeHostedBundleBase64(encodedAgentStateBundle) ?? new Uint8Array(),
      env: latestUserEnv,
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
      userId,
      kind,
      decodedBundle ?? new Uint8Array(),
      currentRef,
    );
  }

  private async writeBundleBytes(
    userId: string,
    kind: HostedExecutionBundleKind,
    plaintext: Uint8Array,
    currentRef: HostedExecutionBundleRef | null,
  ) {
    const hash = sha256HostedBundleHex(plaintext);
    if (currentRef && currentRef.hash === hash && currentRef.size === plaintext.byteLength) {
      return currentRef;
    }

    const ref = await this.createBundleStore().writeBundle(userId, kind, plaintext);
    return {
      ...ref,
      size: ref.size ?? plaintext.byteLength,
    };
  }
}
