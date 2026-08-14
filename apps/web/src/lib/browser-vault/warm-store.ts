/**
 * Bounded, in-memory-only warm path for the browser vault.
 *
 * Holds at most one decrypted ready snapshot and one in-flight session load in
 * module memory so dashboard routes can share already-authorized shard work.
 * The public landing page deliberately does not start this private load.
 * Nothing here is persisted: no localStorage, sessionStorage,
 * IndexedDB, Cache Storage, cookies, or service worker. Auth loss clears the
 * snapshot and bumps a generation counter so an older request that resolves
 * after the clear cannot repopulate it.
 */
import {
  type BrowserVaultMetricBucketId,
  type BrowserVaultReplicaShardSelection,
} from "@murphai/query/browser-replica-client";
import { type HostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/browser-vault";

import {
  createBrowserVaultRouteQueryClient,
  isBrowserVaultAbortError,
  isBrowserVaultUnauthorizedError,
  loadBrowserVaultReplica,
  normalizeBrowserVaultError,
  selectBrowserVaultReplicaDemand,
  type BrowserVaultAnyQueryClient,
  type BrowserVaultSessionMetadata,
} from "./loader";
import {
  BROWSER_VAULT_REPLICA_SHARDS,
  normalizeBrowserVaultMetricBucketDemand,
  type BrowserVaultReplicaShard,
} from "./route-shards";
import {
  isBrowserVaultSessionEnding,
  subscribeBrowserVaultSessionInvalidation,
} from "./session-invalidation";

export interface BrowserVaultReadySnapshot {
  client: BrowserVaultAnyQueryClient;
  loadedMetricBuckets: readonly BrowserVaultMetricBucketId[];
  loadedShards: readonly BrowserVaultReplicaShard[];
  memberId: string;
  metadata: BrowserVaultSessionMetadata;
  ref: HostedBrowserVaultReplicaRef;
  shards: BrowserVaultReplicaShardSelection;
}

export type BrowserVaultWarmLoadOutcome =
  | { status: "ready"; snapshot: BrowserVaultReadySnapshot }
  | { status: "empty"; memberId: string | null; metadata: BrowserVaultSessionMetadata }
  | { status: "identity_changed" }
  | { status: "unauthorized"; httpStatus: 401 | 403; message: string }
  | { status: "error"; message: string }
  | { status: "session_ending" }
  | { status: "superseded" };

export interface StartBrowserVaultWarmLoadOptions {
  expectedMemberId?: string | null;
  requestedMetricBuckets?: readonly BrowserVaultMetricBucketId[];
  requestedShards?: readonly BrowserVaultReplicaShard[];
  requestRefresh?: boolean;
}

let readySnapshot: BrowserVaultReadySnapshot | null = null;
let inFlight: Promise<BrowserVaultWarmLoadOutcome> | null = null;
let inFlightController: AbortController | null = null;
let inFlightRequestsRefresh = false;
let inFlightRequestedShards: readonly BrowserVaultReplicaShard[] = [];
let inFlightRequestedMetricBuckets: readonly BrowserVaultMetricBucketId[] = [];
let generation = 0;
let stopSessionInvalidationListener: (() => void) | null = null;

export function getBrowserVaultReadySnapshot(): BrowserVaultReadySnapshot | null {
  return readySnapshot;
}

export function peekBrowserVaultInFlightLoad(): Promise<BrowserVaultWarmLoadOutcome> | null {
  return inFlight;
}

/**
 * Start (or reuse) the single warm load. The store owns reusable replica work;
 * callers that cross an authority boundary must separately decide when its
 * cached result may be published.
 */
export function startBrowserVaultWarmLoad(
  options: StartBrowserVaultWarmLoadOptions = {},
): Promise<BrowserVaultWarmLoadOutcome> {
  if (isBrowserVaultSessionEnding()) {
    clearBrowserVaultWarmState();
    return Promise.resolve({ status: "session_ending" });
  }

  ensureBrowserVaultSessionInvalidationListener();
  const requestedShards = options.requestedShards
    ?? BROWSER_VAULT_REPLICA_SHARDS;
  const requestedMetricBuckets = normalizeBrowserVaultMetricBucketDemand(
    options.requestedMetricBuckets ?? [],
  );

  if (inFlight) {
    if (
      (options.requestRefresh && !inFlightRequestsRefresh)
      || !browserVaultDemandsMatch(
        inFlightRequestedShards,
        inFlightRequestedMetricBuckets,
        requestedShards,
        requestedMetricBuckets,
      )
    ) {
      // A stronger request may wait for ordinary shared work, but it belongs
      // to the same authority generation. Abort, clear, or unmount must not
      // let that deferred continuation restart network work afterward.
      const queuedGeneration = generation;
      return inFlight.then(() =>
        queuedGeneration === generation
          ? startBrowserVaultWarmLoad(options)
          : { status: "superseded" }
      );
    }
    return inFlight;
  }

  const loadGeneration = generation;
  const controller = new AbortController();
  inFlightController = controller;
  inFlightRequestsRefresh = options.requestRefresh === true;
  inFlightRequestedShards = requestedShards;
  inFlightRequestedMetricBuckets = requestedMetricBuckets;

  const loadPromise = (async (): Promise<BrowserVaultWarmLoadOutcome> => {
    try {
      const result = await loadBrowserVaultReplica({
        emptyOnUnauthorized: false,
        expectedMemberId: options.expectedMemberId !== undefined
          ? options.expectedMemberId
          : readySnapshot?.memberId,
        knownShards: readySnapshot?.loadedShards ?? [],
        knownMetricBuckets: readySnapshot?.loadedMetricBuckets ?? [],
        knownReplicaShards: readySnapshot?.shards ?? null,
        knownReplicaRef: readySnapshot?.ref ?? null,
        requestedShards,
        requestedMetricBuckets,
        requestRefresh: options.requestRefresh,
        signal: controller.signal,
      });

      if (result.state === "identity_changed") {
        readySnapshot = null;
        return { status: "identity_changed" };
      }

      if (loadGeneration !== generation) {
        return { status: "superseded" };
      }

      const metadata: BrowserVaultSessionMetadata = {
        deviceSyncImportPending: result.deviceSyncImportPending,
        freshness: result.freshness,
        refreshPending: result.refreshPending,
        workspaceVersion: result.workspaceVersion,
      };

      if (result.state === "empty") {
        readySnapshot = null;
        return { status: "empty", memberId: result.memberId, metadata };
      }

      if (result.state === "not_modified") {
        // The known ref matched, so reuse the decrypted shards. Preserve the
        // existing client when it already covers the route; otherwise project
        // the newly requested capability without another decrypt.
        if (!readySnapshot) {
          return { status: "superseded" };
        }
        if (!requestedShards.every((shard) =>
          readySnapshot!.loadedShards.includes(shard)
        ) || !requestedMetricBuckets.every((bucketId) =>
          readySnapshot!.loadedMetricBuckets.includes(bucketId)
        )) {
          throw new Error(
            "Browser vault unchanged session did not cover the requested shards.",
          );
        }
        const exactDemand = browserVaultDemandsMatch(
          readySnapshot.loadedShards,
          readySnapshot.loadedMetricBuckets,
          requestedShards,
          requestedMetricBuckets,
        );
        const shards = exactDemand
          ? readySnapshot.shards
          : selectBrowserVaultReplicaDemand(
              readySnapshot.shards,
              requestedShards,
              requestedMetricBuckets,
            );
        const client = exactDemand
          ? readySnapshot.client
          : createBrowserVaultRouteQueryClient(
              shards,
              requestedShards,
              requestedMetricBuckets,
            );
        readySnapshot = {
          client,
          loadedMetricBuckets: requestedMetricBuckets,
          loadedShards: requestedShards,
          memberId: readySnapshot.memberId,
          metadata,
          ref: result.replicaRef,
          shards,
        };
        return { status: "ready", snapshot: readySnapshot };
      }

      readySnapshot = {
        client: result.client,
        loadedMetricBuckets: result.loadedMetricBuckets,
        loadedShards: result.loadedShards,
        memberId: result.memberId,
        metadata,
        ref: result.replicaRef,
        shards: result.shards,
      };
      return { status: "ready", snapshot: readySnapshot };
    } catch (loadError) {
      if (loadGeneration !== generation || isBrowserVaultAbortError(loadError)) {
        return { status: "superseded" };
      }
      if (isBrowserVaultUnauthorizedError(loadError)) {
        readySnapshot = null;
        return {
          status: "unauthorized",
          httpStatus: loadError.status,
          message: normalizeBrowserVaultError(loadError),
        };
      }
      // A failed load never discards the existing ready snapshot; callers keep
      // stale data instead of dropping to an error-only screen.
      return { status: "error", message: normalizeBrowserVaultError(loadError) };
    } finally {
      if (loadGeneration === generation) {
        inFlight = null;
        inFlightController = null;
        inFlightRequestsRefresh = false;
        inFlightRequestedShards = [];
        inFlightRequestedMetricBuckets = [];
      }
    }
  })();

  inFlight = loadPromise;
  return loadPromise;
}

function browserVaultDemandsMatch(
  leftShards: readonly BrowserVaultReplicaShard[],
  leftBuckets: readonly BrowserVaultMetricBucketId[],
  rightShards: readonly BrowserVaultReplicaShard[],
  rightBuckets: readonly BrowserVaultMetricBucketId[],
): boolean {
  return leftShards.length === rightShards.length
    && leftShards.every((shard) => rightShards.includes(shard))
    && leftBuckets.length === rightBuckets.length
    && leftBuckets.every((bucketId) => rightBuckets.includes(bucketId));
}

/**
 * Abort the in-flight load (e.g. on provider unmount) without discarding the
 * ready snapshot. Bumping the generation prevents an abort-ignoring request
 * from writing or clearing a newer load that starts before it settles.
 */
export function abortBrowserVaultInFlightLoad(): void {
  generation += 1;
  inFlightController?.abort();
  inFlightController = null;
  inFlight = null;
  inFlightRequestsRefresh = false;
  inFlightRequestedShards = [];
  inFlightRequestedMetricBuckets = [];
}

/**
 * Clear all warm state on auth loss: abort the in-flight load, drop the ready
 * snapshot, and bump the generation so a request started under the previous
 * identity cannot repopulate the snapshot after it resolves.
 */
export function clearBrowserVaultWarmState(): void {
  generation += 1;
  inFlightController?.abort();
  inFlightController = null;
  inFlight = null;
  inFlightRequestsRefresh = false;
  inFlightRequestedShards = [];
  inFlightRequestedMetricBuckets = [];
  readySnapshot = null;
  stopSessionInvalidationListener?.();
  stopSessionInvalidationListener = null;
}

function ensureBrowserVaultSessionInvalidationListener(): void {
  if (stopSessionInvalidationListener) {
    return;
  }

  stopSessionInvalidationListener = subscribeBrowserVaultSessionInvalidation(
    clearBrowserVaultWarmState,
  );
}
