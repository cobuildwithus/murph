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

// Compatibility-only dashboard-replica names for deploy skew.
// Deletion target: 2026-05-23, after web and Cloudflare have both cleared the
// browser-vault refresh compatibility window.
export type DashboardReplicaFreshness = BrowserVaultReplicaFreshness;
export type DashboardReplicaRefreshDecision = BrowserVaultRefreshDecision;

export function readDashboardReplicaSourceStateHash(
  snapshotRef: HostedExecutionSnapshotRefState,
): string | null {
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
