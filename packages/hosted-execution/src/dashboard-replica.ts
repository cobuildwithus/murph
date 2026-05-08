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
  refresh: true;
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
  // Compatibility helper for older browser-vault clients. Active hosted
  // refresh now publishes the latest live projection ref instead of deriving
  // freshness from committed workspace snapshot source hashes.
  void input.snapshotRef;
  return input.replicaRef ? "fresh" : "stale";
}

export function shouldScheduleDashboardReplicaRefresh(input: {
  currentReplicaRef: HostedBrowserVaultReplicaRef | null;
  currentSnapshotRef: HostedExecutionSnapshotRefState;
  previousSnapshotRef?: HostedExecutionSnapshotRefState;
}): DashboardReplicaRefreshDecision | null {
  // Compatibility helper only. Active scheduling is a one-slot latest-live
  // refresh request owned by the runner, not a source-hash queue.
  if (!input.currentSnapshotRef) {
    return null;
  }
  void input.previousSnapshotRef;
  return input.currentReplicaRef ? null : { refresh: true };
}
