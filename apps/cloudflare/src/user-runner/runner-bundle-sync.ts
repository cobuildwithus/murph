import {
  decodeHostedBundleBase64,
  encodeHostedBundleBase64,
} from "@murphai/runtime-state/node/hosted-bundle-codec";
import {
  emitHostedExecutionStructuredLog,
  type HostedExecutionBundleRef,
  type HostedExecutionRunnerResult,
} from "@murphai/hosted-execution";

import {
  createHostedBundleStore,
  writeHostedBundleBytesIfChanged,
  type HostedBundleStore,
  type R2BucketLike,
} from "../bundle-store.js";
import { HostedBundleGarbageCollector } from "../bundle-gc.js";

interface RunnerBundleRefCacheReader {
  readCachedBundleRef(): Promise<HostedExecutionBundleRef | null>;
}

export interface RunnerBundleApplyResult {
  bundleRef: HostedExecutionBundleRef | null;
}

export class RunnerBundleSync {
  private readonly garbageCollector: HostedBundleGarbageCollector;

  constructor(
    private readonly bucket: R2BucketLike,
    private readonly platformEnvelopeKey: Uint8Array,
    private readonly platformEnvelopeKeyId: string,
    private readonly platformEnvelopeKeysById: Readonly<Record<string, Uint8Array>>,
    private readonly bundleRefCacheReader?: RunnerBundleRefCacheReader,
  ) {
    this.garbageCollector = new HostedBundleGarbageCollector(
      bucket,
      platformEnvelopeKey,
      platformEnvelopeKeyId,
      platformEnvelopeKeysById,
    );
  }

  async readBundlesForRunner(
    currentBundleRef?: HostedExecutionBundleRef | null,
  ): Promise<HostedExecutionRunnerResult["bundle"]> {
    const store = this.createBundleStore();
    return encodeHostedBundleBase64(await readRequiredBundleForRunner({
      bundleStore: store,
      ref: await this.resolveCurrentBundleRef(currentBundleRef),
    }));
  }

  async applyRunnerResultBundles(
    userId: string,
    currentBundleRefOrVersion: HostedExecutionBundleRef | number | null,
    bundle?: HostedExecutionRunnerResult["bundle"],
  ): Promise<RunnerBundleApplyResult> {
    const bundleStore = this.createBundleStore();
    const currentBundleRef = await this.resolveCurrentBundleRef(currentBundleRefOrVersion);
    const nextBundle = bundle ?? null;
    const nextBundleBytes = decodeHostedBundleBase64(nextBundle);
    const nextBundleRef = nextBundle === null
      ? null
      : await writeHostedBundleBytesIfChanged({
          bundleStore,
          currentRef: currentBundleRef,
          kind: "vault",
          plaintext: nextBundleBytes ?? new Uint8Array(),
        });

    await this.cleanupBundleTransitionBestEffort({
      nextBundleRef,
      previousBundleRef: currentBundleRef,
      userId,
    });
    return {
      bundleRef: nextBundleRef,
    };
  }

  private createBundleStore() {
    return createHostedBundleStore({
      bucket: this.bucket,
      key: this.platformEnvelopeKey,
      keyId: this.platformEnvelopeKeyId,
      keysById: this.platformEnvelopeKeysById,
    });
  }

  private async resolveCurrentBundleRef(
    currentBundleRefOrVersion: HostedExecutionBundleRef | number | null | undefined,
  ): Promise<HostedExecutionBundleRef | null> {
    if (currentBundleRefOrVersion && typeof currentBundleRefOrVersion === "object") {
      return currentBundleRefOrVersion;
    }

    return this.bundleRefCacheReader?.readCachedBundleRef() ?? null;
  }

  private async cleanupBundleTransitionBestEffort(input: {
    nextBundleRef: HostedExecutionBundleRef | null;
    previousBundleRef: HostedExecutionBundleRef | null;
    userId: string;
  }): Promise<void> {
    try {
      await this.garbageCollector.cleanupBundleTransition(input);
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          nextBundleRefKey: input.nextBundleRef?.key ?? null,
          previousBundleRefKey: input.previousBundleRef?.key ?? null,
          userId: input.userId,
        },
        error,
        level: "warn",
        message:
          "Hosted bundle cleanup failed after a successful bundle swap; continuing without cleanup.",
        phase: "completed",
        run: null,
        userId: input.userId,
      });
    }
  }
}

async function readRequiredBundleForRunner(input: {
  bundleStore: HostedBundleStore;
  ref: HostedExecutionBundleRef | null;
}): Promise<Uint8Array | null> {
  if (!input.ref) {
    return null;
  }

  const bytes = await input.bundleStore.readBundle(input.ref);
  if (!bytes) {
    throw new Error(
      `Hosted vault bundle ${input.ref.key} is missing from R2.`,
    );
  }

  return bytes;
}
