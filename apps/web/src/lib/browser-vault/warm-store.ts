/**
 * Bounded, in-memory-only warm path for the browser vault.
 *
 * Holds at most one decrypted ready snapshot and one in-flight session load in
 * module memory so an authenticated landing page can warm the replica before
 * the dashboard mounts, and so every dashboard route shares one decrypted
 * replica. Nothing here is persisted: no localStorage, sessionStorage,
 * IndexedDB, Cache Storage, cookies, or service worker. Auth loss clears the
 * snapshot and bumps a generation counter so an older request that resolves
 * after the clear cannot repopulate it.
 */
import { type BrowserVaultQueryClient } from "@murphai/query/browser-replica-client";
import { type HostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/browser-vault";

import {
  isBrowserVaultAbortError,
  isBrowserVaultUnauthorizedError,
  loadBrowserVaultReplica,
  normalizeBrowserVaultError,
  type BrowserVaultSessionMetadata,
} from "./loader";
import {
  isBrowserVaultSessionEnding,
  subscribeBrowserVaultSessionInvalidation,
} from "./session-invalidation";

export interface BrowserVaultReadySnapshot {
  client: BrowserVaultQueryClient;
  memberId: string;
  metadata: BrowserVaultSessionMetadata;
  ref: HostedBrowserVaultReplicaRef;
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
  requestRefresh?: boolean;
}

let readySnapshot: BrowserVaultReadySnapshot | null = null;
let inFlight: Promise<BrowserVaultWarmLoadOutcome> | null = null;
let inFlightController: AbortController | null = null;
let inFlightRequestsRefresh = false;
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

  if (inFlight) {
    if (options.requestRefresh && !inFlightRequestsRefresh) {
      return inFlight.then(() => startBrowserVaultWarmLoad(options));
    }
    return inFlight;
  }

  const loadGeneration = generation;
  const controller = new AbortController();
  inFlightController = controller;
  inFlightRequestsRefresh = options.requestRefresh === true;

  const loadPromise = (async (): Promise<BrowserVaultWarmLoadOutcome> => {
    try {
      const result = await loadBrowserVaultReplica({
        emptyOnUnauthorized: false,
        expectedMemberId: options.expectedMemberId !== undefined
          ? options.expectedMemberId
          : readySnapshot?.memberId,
        knownReplicaRef: readySnapshot?.ref ?? null,
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
        // The known ref matched the server's replica, so keep the decrypted
        // client we already hold. If the snapshot was cleared mid-flight there
        // is nothing to keep and the outcome is treated as superseded.
        if (!readySnapshot) {
          return { status: "superseded" };
        }
        readySnapshot = {
          client: readySnapshot.client,
          memberId: readySnapshot.memberId,
          metadata,
          ref: result.replicaRef,
        };
        return { status: "ready", snapshot: readySnapshot };
      }

      readySnapshot = {
        client: result.client,
        memberId: result.memberId,
        metadata,
        ref: result.replicaRef,
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
      }
    }
  })();

  inFlight = loadPromise;
  return loadPromise;
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
