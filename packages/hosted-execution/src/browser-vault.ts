import type {
  HostedBrowserVaultReplicaCursorRef,
  HostedBrowserVaultReplicaRef,
} from "./contracts.ts";

export type {
  HostedBrowserVaultReplicaCursorRef,
  HostedBrowserVaultReplicaRef,
} from "./contracts.ts";
export {
  getHostedBrowserVaultReplicaStorageKeyId,
} from "./contracts.ts";
export {
  parseHostedBrowserVaultReplicaRef,
} from "./parsers/cursor.ts";

export type BrowserVaultReplicaFreshness = "fresh" | "stale";

export interface BrowserVaultRefreshDecision {
  refresh: true;
}

export function getBrowserVaultReplicaFreshness(input: {
  replicaRef: HostedBrowserVaultReplicaRef | null;
}): BrowserVaultReplicaFreshness {
  return input.replicaRef ? "fresh" : "stale";
}

export function shouldScheduleBrowserVaultRefresh(input: {
  currentReplicaRef: HostedBrowserVaultReplicaRef | null;
}): BrowserVaultRefreshDecision | null {
  return input.currentReplicaRef ? null : { refresh: true };
}
