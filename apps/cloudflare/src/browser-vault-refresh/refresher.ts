import { createHash } from "node:crypto";

import {
  createHostedBrowserVaultReplicaRefreshFromWorkspace,
  type HostedBrowserVaultReplicaContentSummary,
  type HostedBrowserVaultReplicaRestoreSummary,
  type HostedBrowserVaultReplicaSourceSummary,
} from "@murphai/assistant-runtime";
import type {
  HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";

import {
  HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES,
  measureHostedBrowserVaultReplicaBytes,
} from "../browser-vault-limits.ts";
import type {
  buildHostedExecutionRuntimePlatform,
} from "../runtime-platform.ts";

type HostedRuntimePlatform = ReturnType<typeof buildHostedExecutionRuntimePlatform>;

export type BrowserVaultReplicaRefreshResult =
  | {
      byteLength: number;
      content: HostedBrowserVaultReplicaContentSummary;
      replicaRef: HostedBrowserVaultReplicaRef;
      restore: HostedBrowserVaultReplicaRestoreSummary;
      source: HostedBrowserVaultReplicaSourceSummary;
      status: "published";
    }
  | {
      byteLength: number;
      content: HostedBrowserVaultReplicaContentSummary;
      maxBytes: number;
      restore: HostedBrowserVaultReplicaRestoreSummary;
      source: HostedBrowserVaultReplicaSourceSummary;
      status: "refresh_failed_too_large";
    }
  | {
      content: HostedBrowserVaultReplicaContentSummary;
      restore: HostedBrowserVaultReplicaRestoreSummary;
      source: HostedBrowserVaultReplicaSourceSummary;
      status: "refresh_failed_empty_source";
    }
  | {
      content: HostedBrowserVaultReplicaContentSummary;
      restore: HostedBrowserVaultReplicaRestoreSummary;
      source: HostedBrowserVaultReplicaSourceSummary;
      status: "refresh_skipped_no_source";
    }
  | {
      status: "publish_conflict";
    }
  | {
      status: "workspace_missing";
    };

export type BrowserVaultRefreshResult = BrowserVaultReplicaRefreshResult;

export async function refreshBrowserVaultReplicaFromLiveWorkspace(input: {
  generatedAt: string;
  platform: HostedRuntimePlatform;
  projectionHash: string;
  signal?: AbortSignal;
  userId: string;
  vaultRoot: string;
  workspace: HostedWorkspaceState | null;
}): Promise<BrowserVaultReplicaRefreshResult> {
  if (!input.platform.browserVaultReplicaPort?.write) {
    throw new TypeError("Browser-vault refresh requires a browser-vault replica write port.");
  }
  if (!input.platform.browserVaultReplicaPort.publishRef) {
    throw new TypeError("Browser-vault refresh requires a browser-vault replica publish port.");
  }
  if (!input.workspace) {
    return {
      status: "workspace_missing",
    };
  }

  throwIfBrowserVaultRefreshAborted(input.signal);
  const prepared = await createHostedBrowserVaultReplicaRefreshFromWorkspace({
    generatedAt: input.generatedAt,
    platform: input.platform,
    sourceStateHash: input.projectionHash,
    vaultRoot: input.vaultRoot,
    workspace: input.workspace,
  });
  throwIfBrowserVaultRefreshAborted(input.signal);

  if (prepared.source.fileCount === 0) {
    return {
      content: prepared.content,
      restore: prepared.restore,
      source: prepared.source,
      status: "refresh_skipped_no_source",
    };
  }

  if (!prepared.content.hasPrivateContent) {
    return {
      content: prepared.content,
      restore: prepared.restore,
      source: prepared.source,
      status: "refresh_failed_empty_source",
    };
  }

  const byteLength = measureHostedBrowserVaultReplicaBytes(prepared.replica);
  if (byteLength > HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES) {
    return {
      byteLength,
      content: prepared.content,
      maxBytes: HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES,
      restore: prepared.restore,
      source: prepared.source,
      status: "refresh_failed_too_large",
    };
  }

  const replicaRef = await input.platform.browserVaultReplicaPort.write({
    replica: prepared.replica,
  });
  assertBrowserVaultReplicaWriteResult({
    byteLength,
    projectionHash: input.projectionHash,
    replicaRef,
  });

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
    content: prepared.content,
    replicaRef,
    restore: prepared.restore,
    source: prepared.source,
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
