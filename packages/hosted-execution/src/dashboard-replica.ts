import type {
  HostedBrowserVaultReplicaRef,
} from "./contracts.ts";
import type {
  HostedExecutionSnapshotRefState,
} from "./bundles.ts";
import {
  getBrowserVaultReplicaFreshness,
  shouldScheduleBrowserVaultRefresh,
  type BrowserVaultRefreshDecision,
  type BrowserVaultReplicaFreshness,
} from "./browser-vault.ts";
import {
  readHostedBrowserVaultSourceStateHash,
} from "./parsers/cursor.ts";

// Legacy dashboard-replica names are kept only for deploy-skew callers. Active
// code should import browser-vault refresh helpers from `./browser-vault.ts`.
export type DashboardReplicaFreshness = BrowserVaultReplicaFreshness;
export type DashboardReplicaRefreshDecision = BrowserVaultRefreshDecision;

export function readDashboardReplicaSourceStateHash(
  snapshotRef: HostedExecutionSnapshotRefState,
): string | null {
  // Legacy source-hash compatibility helper. Active browser-vault refresh
  // publishes the latest live projection ref instead of deriving freshness from
  // committed workspace snapshot source hashes.
  return readHostedBrowserVaultSourceStateHash(snapshotRef);
}

export function getDashboardReplicaFreshness(input: {
  replicaRef: HostedBrowserVaultReplicaRef | null;
  snapshotRef: HostedExecutionSnapshotRefState;
}): DashboardReplicaFreshness {
  void input.snapshotRef;
  return getBrowserVaultReplicaFreshness({
    replicaRef: input.replicaRef,
  });
}

export function shouldScheduleDashboardReplicaRefresh(input: {
  currentReplicaRef: HostedBrowserVaultReplicaRef | null;
  currentSnapshotRef: HostedExecutionSnapshotRefState;
  previousSnapshotRef?: HostedExecutionSnapshotRefState;
}): DashboardReplicaRefreshDecision | null {
  if (!input.currentSnapshotRef) {
    return null;
  }
  void input.previousSnapshotRef;
  return shouldScheduleBrowserVaultRefresh({
    currentReplicaRef: input.currentReplicaRef,
  });
}
