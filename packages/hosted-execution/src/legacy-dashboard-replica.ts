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
  readHostedExecutionSnapshotBaseRef,
  readHostedExecutionSnapshotDeltaRef,
} from "./parsers/cursor.ts";

// Published legacy names. Active code uses `./browser-vault.ts`; remove this
// compatibility surface only in a coordinated major release.
export type DashboardReplicaFreshness = BrowserVaultReplicaFreshness;
export type DashboardReplicaRefreshDecision = BrowserVaultRefreshDecision;

export function readDashboardReplicaSourceStateHash(
  snapshotRef: HostedExecutionSnapshotRefState,
): string | null {
  return readHostedExecutionSnapshotDeltaRef(snapshotRef)?.hash
    ?? readHostedExecutionSnapshotBaseRef(snapshotRef)?.hash
    ?? null;
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
