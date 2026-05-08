import type {
  HostedBrowserVaultReplicaRef,
} from "./contracts.ts";
import type {
  HostedExecutionSnapshotRefState,
} from "./bundles.ts";
import {
  readHostedBrowserVaultSourceStateHash,
} from "./parsers/cursor.ts";

export type DashboardReplicaFreshness = "fresh" | "stale";

export interface DashboardReplicaRefreshDecision {
  sourceStateHash: string;
}

export function readDashboardReplicaSourceStateHash(
  snapshotRef: HostedExecutionSnapshotRefState,
): string | null {
  return readHostedBrowserVaultSourceStateHash(snapshotRef);
}

export function getDashboardReplicaFreshness(input: {
  replicaRef: HostedBrowserVaultReplicaRef | null;
  snapshotRef: HostedExecutionSnapshotRefState;
}): DashboardReplicaFreshness {
  const sourceStateHash = readDashboardReplicaSourceStateHash(input.snapshotRef);
  return input.replicaRef
    && sourceStateHash
    && input.replicaRef.sourceBundleHash === sourceStateHash
    ? "fresh"
    : "stale";
}

export function shouldScheduleDashboardReplicaRefresh(input: {
  currentReplicaRef: HostedBrowserVaultReplicaRef | null;
  currentSnapshotRef: HostedExecutionSnapshotRefState;
  previousSnapshotRef?: HostedExecutionSnapshotRefState;
}): DashboardReplicaRefreshDecision | null {
  const sourceStateHash = readDashboardReplicaSourceStateHash(input.currentSnapshotRef);
  if (!sourceStateHash) {
    return null;
  }

  if (input.currentReplicaRef?.sourceBundleHash === sourceStateHash) {
    return null;
  }

  if (input.previousSnapshotRef !== undefined) {
    const previousSourceStateHash = readDashboardReplicaSourceStateHash(
      input.previousSnapshotRef,
    );
    if (previousSourceStateHash === sourceStateHash) {
      return null;
    }
  }

  return { sourceStateHash };
}
