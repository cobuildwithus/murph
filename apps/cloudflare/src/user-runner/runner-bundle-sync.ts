import {
  decodeHostedBundleBase64,
  encodeHostedBundleBase64,
  sameHostedBundlePayloadRef,
} from "@murphai/runtime-state/node";
import {
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
import { RunnerQueueStore } from "./runner-queue-store.js";
import {
  type RunnerBundleVersion,
  type RunnerStateRecord,
} from "./types.js";

const BUNDLE_SWAP_RETRY_LIMIT = 4;

export class RunnerBundleSync {
  private readonly garbageCollector: HostedBundleGarbageCollector;

  constructor(
    private readonly bucket: R2BucketLike,
    private readonly platformEnvelopeKey: Uint8Array,
    private readonly platformEnvelopeKeyId: string,
    private readonly platformEnvelopeKeysById: Readonly<Record<string, Uint8Array>>,
    private readonly queueStore: RunnerQueueStore,
  ) {
    this.garbageCollector = new HostedBundleGarbageCollector(
      bucket,
      platformEnvelopeKey,
      platformEnvelopeKeyId,
      platformEnvelopeKeysById,
    );
  }

  async readBundlesForRunner(): Promise<HostedExecutionRunnerResult["bundle"]> {
    const store = this.createBundleStore();
    const bundleState = await this.queueStore.readBundleMetaState();
    return encodeHostedBundleBase64(await readRequiredBundleForRunner({
      bundleStore: store,
      ref: bundleState.bundleRef,
    }));
  }

  async applyRunnerResultBundles(
    userId: string,
    expectedVersion: RunnerBundleVersion,
    bundle: HostedExecutionRunnerResult["bundle"],
  ): Promise<RunnerStateRecord> {
    let nextExpectedVersion = expectedVersion;
    const bundleStore = this.createBundleStore();
    const nextBundleBytes = decodeHostedBundleBase64(bundle);

    for (let attempt = 0; attempt < BUNDLE_SWAP_RETRY_LIMIT; attempt += 1) {
      const bundleState = await this.queueStore.readBundleMetaState();
      const nextBundleRef = bundle === null
        ? null
        : await writeHostedBundleBytesIfChanged({
            bundleStore,
            currentRef: bundleState.bundleRef,
            kind: "vault",
            plaintext: nextBundleBytes ?? new Uint8Array(),
          });

      const swapped = await this.queueStore.compareAndSwapBundleRefs({
        expectedVersion: nextExpectedVersion,
        nextBundleRef,
      });

      if (swapped.applied) {
        await this.cleanupBundleTransitionBestEffort({
          nextBundleRef,
          previousBundleRef: bundleState.bundleRef,
          userId,
        });
        return swapped.record;
      }

      assertBundleRefsStillCompatible({
        currentBundleRef: swapped.record.bundleRef,
        currentVersion: swapped.record.bundleVersion,
        nextBundleRef,
        previousExpectedVersion: nextExpectedVersion,
        userId,
      });

      nextExpectedVersion = swapped.record.bundleVersion;
    }

    throw new Error(`Hosted bundle update for ${userId} conflicted too many times.`);
  }

  private createBundleStore() {
    return createHostedBundleStore({
      bucket: this.bucket,
      key: this.platformEnvelopeKey,
      keyId: this.platformEnvelopeKeyId,
      keysById: this.platformEnvelopeKeysById,
    });
  }

  private async cleanupBundleTransitionBestEffort(input: {
    nextBundleRef: HostedExecutionBundleRef | null;
    previousBundleRef: HostedExecutionBundleRef | null;
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

function assertBundleRefsStillCompatible(input: {
  currentBundleRef: RunnerStateRecord["bundleRef"];
  currentVersion: RunnerBundleVersion;
  nextBundleRef: RunnerStateRecord["bundleRef"];
  previousExpectedVersion: RunnerBundleVersion;
  userId: string;
}): void {
  if (
    input.currentVersion !== input.previousExpectedVersion
    && !sameHostedBundlePayloadRef(input.currentBundleRef, input.nextBundleRef)
  ) {
    throw new Error(
      `Hosted vault bundle changed while applying the runner result for ${input.userId}.`,
    );
  }
}
