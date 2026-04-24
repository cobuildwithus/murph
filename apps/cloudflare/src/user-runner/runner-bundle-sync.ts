import {
  decodeHostedBundleBase64,
  encodeHostedBundleBase64,
} from "@murphai/runtime-state/node/hosted-bundle-codec";
import type {
  HostedExecutionBundleRef,
  HostedExecutionRunnerResult,
} from "@murphai/hosted-execution";

import {
  createHostedBundleStore,
  writeHostedBundleBytesIfChanged,
  type HostedBundleStore,
  type R2BucketLike,
} from "../bundle-store.js";
import {
  assertHostedBundleArchiveValid,
  HostedBundleArchiveValidationError,
  isHostedBundleArchiveValidationFailure,
} from "../hosted-bundle-validation.js";

interface RunnerBundleRefCacheReader {
  readCachedBundleRef(): Promise<HostedExecutionBundleRef | null>;
}

export interface RunnerBundleApplyResult {
  bundleRef: HostedExecutionBundleRef | null;
}

export class RunnerBundleSync {
  constructor(
    private readonly bucket: R2BucketLike,
    private readonly platformEnvelopeKey: Uint8Array,
    private readonly platformEnvelopeKeyId: string,
    private readonly platformEnvelopeKeysById: Readonly<Record<string, Uint8Array>>,
    private readonly bundleRefCacheReader?: RunnerBundleRefCacheReader,
  ) {}

  async readBundlesForRunner(
    currentBundleRef?: HostedExecutionBundleRef | null,
    userId?: string | null,
  ): Promise<HostedExecutionRunnerResult["bundle"]> {
    const store = this.createBundleStore(userId ?? undefined);
    const ref = await this.resolveCurrentBundleRef(currentBundleRef);
    return encodeHostedBundleBase64(await readRequiredBundleForRunner({
      bundleStore: store,
      ref,
    }));
  }

  async applyRunnerResultBundles(
    userId: string,
    currentBundleRefOrVersion: HostedExecutionBundleRef | number | null,
    bundle?: HostedExecutionRunnerResult["bundle"],
  ): Promise<RunnerBundleApplyResult> {
    const bundleStore = this.createBundleStore(userId);
    const currentBundleRef = await this.resolveCurrentBundleRef(currentBundleRefOrVersion);
    const nextBundle = bundle ?? null;
    const nextBundleBytes = decodeHostedBundleBase64(nextBundle);
    assertHostedBundleArchiveValid({
      bytes: nextBundleBytes,
      expectedKind: "vault",
      operation: "runner-output",
    });
    const nextBundleRef = nextBundle === null
      ? null
      : await writeHostedBundleBytesIfChanged({
          bundleStore,
          currentRef: currentBundleRef,
          kind: "vault",
          plaintext: nextBundleBytes ?? new Uint8Array(),
        });

    return {
      bundleRef: nextBundleRef,
    };
  }

  private createBundleStore(userId?: string) {
    return createHostedBundleStore({
      bucket: this.bucket,
      key: this.platformEnvelopeKey,
      keyId: this.platformEnvelopeKeyId,
      keysById: this.platformEnvelopeKeysById,
      userId: userId ?? null,
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
}

async function readRequiredBundleForRunner(input: {
  bundleStore: HostedBundleStore;
  ref: HostedExecutionBundleRef | null;
}): Promise<Uint8Array | null> {
  if (!input.ref) {
    return null;
  }

  let bytes: Uint8Array | null;
  try {
    bytes = await input.bundleStore.readBundle(input.ref);
  } catch (error) {
    if (isHostedBundleArchiveValidationFailure(error)) {
      throw new HostedBundleArchiveValidationError({
        cause: error,
        operation: "runner-input",
        ref: input.ref,
      });
    }
    throw error;
  }
  if (!bytes) {
    throw new Error(
      `Hosted vault bundle ${input.ref.key} is missing from R2.`,
    );
  }
  assertHostedBundleArchiveValid({
    bytes,
    expectedKind: "vault",
    operation: "runner-input",
    ref: input.ref,
  });

  return bytes;
}
