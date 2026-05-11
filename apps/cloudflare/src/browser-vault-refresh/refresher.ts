import {
  createHostedBrowserVaultReplicaForSourceState,
  hashHostedBrowserVaultQuerySources,
  markHostedBrowserVaultRefreshClean,
  markHostedBrowserVaultRefreshFailed,
  readHostedBrowserVaultRefreshState,
} from "@murphai/assistant-runtime";
import type {
  HostedRuntimeBrowserVaultReplicaPort,
} from "@murphai/assistant-runtime";
import type {
  HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES,
  measureHostedBrowserVaultReplicaBytes,
} from "../browser-vault-limits.ts";

export type BrowserVaultBackgroundRefreshResult =
  | {
      byteLength: number;
      replicaRef: HostedBrowserVaultReplicaRef;
      sourceHash: string;
      status: "published";
    }
  | {
      sourceHash: string;
      status: "already_published";
    }
  | {
      status: "not_dirty";
    }
  | {
      nextAttemptAt: string;
      status: "backoff";
    }
  | {
      status: "source_changed_during_build";
    }
  | {
      byteLength: number;
      maxBytes: number;
      sourceHash: string;
      status: "refresh_failed_too_large";
    }
  | {
      status: "publish_conflict";
    };

export type BrowserVaultRefreshResult = BrowserVaultBackgroundRefreshResult;

export async function refreshBrowserVaultReplicaFromWarmVault(input: {
  beforeSourceHashAfterBuild?: () => Promise<void> | void;
  generatedAt: string;
  port: HostedRuntimeBrowserVaultReplicaPort;
  signal?: AbortSignal;
  vaultRoot: string;
}): Promise<BrowserVaultBackgroundRefreshResult> {
  if (!input.port.publishRef) {
    throw new TypeError("Browser-vault background refresh requires a publish port.");
  }

  const state = await readHostedBrowserVaultRefreshState({ vaultRoot: input.vaultRoot });
  if (!state.dirty) {
    return { status: "not_dirty" };
  }
  if (state.nextAttemptAt && Date.parse(state.nextAttemptAt) > Date.now()) {
    return {
      nextAttemptAt: state.nextAttemptAt,
      status: "backoff",
    };
  }

  try {
    throwIfBrowserVaultRefreshAborted(input.signal);
    const sourceBefore = await hashHostedBrowserVaultQuerySources({ vaultRoot: input.vaultRoot });
    if (sourceBefore.hash === state.lastPublishedSourceHash) {
      await markHostedBrowserVaultRefreshClean({
        lastPublishedSourceHash: sourceBefore.hash,
        vaultRoot: input.vaultRoot,
      });
      return {
        sourceHash: sourceBefore.hash,
        status: "already_published",
      };
    }

    const replica = await createHostedBrowserVaultReplicaForSourceState({
      generatedAt: input.generatedAt,
      sourceStateHash: sourceBefore.hash,
      vaultRoot: input.vaultRoot,
    });
    throwIfBrowserVaultRefreshAborted(input.signal);

    await input.beforeSourceHashAfterBuild?.();
    const sourceAfter = await hashHostedBrowserVaultQuerySources({ vaultRoot: input.vaultRoot });
    if (sourceBefore.hash !== sourceAfter.hash) {
      return {
        status: "source_changed_during_build",
      };
    }

    const byteLength = measureHostedBrowserVaultReplicaBytes(replica);
    if (byteLength > HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES) {
      await markHostedBrowserVaultRefreshFailed({ vaultRoot: input.vaultRoot });
      return {
        byteLength,
        maxBytes: HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES,
        sourceHash: sourceBefore.hash,
        status: "refresh_failed_too_large",
      };
    }

    const replicaRef = await input.port.write({
      expectedReplicaSourceHash: sourceBefore.hash,
      replica,
    });
    assertBrowserVaultReplicaWriteResult({
      byteLength,
      projectionHash: sourceBefore.hash,
      replicaRef,
    });
    const publish = await input.port.publishRef({
      replicaRef,
    });
    if (!publish.published) {
      await markHostedBrowserVaultRefreshFailed({ vaultRoot: input.vaultRoot });
      return { status: "publish_conflict" };
    }
    await markHostedBrowserVaultRefreshClean({
      lastPublishedSourceHash: sourceBefore.hash,
      vaultRoot: input.vaultRoot,
    });
    return {
      byteLength: replicaRef.byteLength,
      replicaRef,
      sourceHash: sourceBefore.hash,
      status: "published",
    };
  } catch (error) {
    if (!input.signal?.aborted) {
      await markHostedBrowserVaultRefreshFailed({ vaultRoot: input.vaultRoot });
    }
    throw error;
  }
}

function assertBrowserVaultReplicaWriteResult(input: {
  byteLength: number;
  projectionHash: string;
  replicaRef: HostedBrowserVaultReplicaRef;
}): void {
  if (input.replicaRef.sourceBundleHash !== input.projectionHash) {
    throw new Error("Browser-vault refresh wrote a mismatched live projection ref.");
  }

  if (
    input.byteLength !== input.replicaRef.byteLength
    || input.byteLength > HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES
  ) {
    throw new Error("Browser-vault refresh wrote invalid replica size metadata.");
  }
}

function throwIfBrowserVaultRefreshAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Browser-vault refresh aborted before publish.");
}
