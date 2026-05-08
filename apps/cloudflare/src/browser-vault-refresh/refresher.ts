import { createHash } from "node:crypto";

import {
  createHostedBrowserVaultReplicaForSourceState,
} from "@murphai/assistant-runtime";
import type {
  HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";

import {
  HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES,
  measureHostedBrowserVaultReplicaBytes,
} from "../browser-vault-limits.ts";
import {
  resolveHostedRunnerWarmWorkspaceVaultRoot,
} from "../node-runner-isolated.ts";
import type {
  buildHostedExecutionRuntimePlatform,
} from "../runtime-platform.ts";

type HostedRuntimePlatform = ReturnType<typeof buildHostedExecutionRuntimePlatform>;

export type BrowserVaultReplicaRefreshResult =
  | {
      byteLength: number;
      replicaRef: HostedBrowserVaultReplicaRef;
      status: "published";
    }
  | {
      byteLength: number;
      maxBytes: number;
      status: "refresh_failed_too_large";
    }
  | {
      status: "publish_conflict";
    };

export type BrowserVaultRefreshResult = BrowserVaultReplicaRefreshResult;

export async function refreshBrowserVaultReplicaFromLiveWorkspace(input: {
  generatedAt: string;
  platform: HostedRuntimePlatform;
  projectionHash: string;
  signal?: AbortSignal;
  userId: string;
}): Promise<BrowserVaultReplicaRefreshResult> {
  if (!input.platform.browserVaultReplicaPort?.write) {
    throw new TypeError("Browser-vault refresh requires a browser-vault replica write port.");
  }
  if (!input.platform.browserVaultReplicaPort.publishRef) {
    throw new TypeError("Browser-vault refresh requires a browser-vault replica publish port.");
  }

  const vaultRoot = resolveHostedRunnerWarmWorkspaceVaultRoot(input.userId);
  throwIfBrowserVaultRefreshAborted(input.signal);
  const replica = await createHostedBrowserVaultReplicaForSourceState({
    generatedAt: input.generatedAt,
    sourceStateHash: input.projectionHash,
    vaultRoot,
  });
  throwIfBrowserVaultRefreshAborted(input.signal);

  const byteLength = measureHostedBrowserVaultReplicaBytes(replica);
  if (byteLength > HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES) {
    return {
      byteLength,
      maxBytes: HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES,
      status: "refresh_failed_too_large",
    };
  }

  const replicaRef = await input.platform.browserVaultReplicaPort.write({ replica });
  assertBrowserVaultReplicaWriteResult({
    byteLength,
    projectionHash: input.projectionHash,
    replicaRef,
  });
  throwIfBrowserVaultRefreshAborted(input.signal);

  const publish = await input.platform.browserVaultReplicaPort.publishRef({
    replicaRef,
  });
  if (!publish.published) {
    return {
      status: "publish_conflict",
    };
  }

  return {
    byteLength: replicaRef.byteLength,
    replicaRef,
    status: "published",
  };
}

export function createLiveBrowserVaultProjectionHash(input: {
  generatedAt: string;
  userId: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      generatedAt: input.generatedAt,
      schema: "murph.browser-vault-live-projection.v1",
      userId: input.userId,
    }))
    .digest("hex");
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
