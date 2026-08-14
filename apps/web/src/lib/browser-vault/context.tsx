"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { type HostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/browser-vault";

import { reloadCurrentHostedAuthDocument } from "@/src/components/hosted-onboarding/hosted-auth-navigation";

import {
  getBrowserVaultMetricBucketId,
  selectBrowserVaultExperimentMetricKeys,
  type BrowserVaultExperimentRunCardLookup,
  type BrowserVaultLabsCapableQueryClient,
  type BrowserVaultMetricBucketId,
  type BrowserVaultMetricSeriesCapableQueryClient,
  type BrowserVaultQueryClient,
} from "@murphai/query/browser-replica-client";
import {
  type BrowserVaultAnyQueryClient,
  type BrowserVaultFreshness,
  type BrowserVaultSessionMetadata,
} from "./loader";
import { browserVaultReplicaRefsMatch } from "./ref";
import {
  normalizeBrowserVaultMetricBucketDemand,
  planBrowserVaultRouteShards,
} from "./route-shards";
import { subscribeBrowserVaultSessionInvalidation } from "./session-invalidation";
import {
  abortBrowserVaultInFlightLoad,
  clearBrowserVaultWarmState,
  getBrowserVaultReadySnapshot,
  peekBrowserVaultInFlightLoad,
  startBrowserVaultWarmLoad,
  type BrowserVaultReadySnapshot,
  type BrowserVaultWarmLoadOutcome,
} from "./warm-store";

export type BrowserVaultStatus = "loading" | "ready" | "empty" | "error";

const BROWSER_VAULT_STALE_POLL_INTERVAL_MS = 1_500;
const BROWSER_VAULT_STALE_POLL_WINDOW_MS = 20_000;
const BROWSER_VAULT_STALE_POLL_SLOW_INTERVAL_MS = 15_000;
const BROWSER_VAULT_RUNTIME_REFRESH_TIMEOUT_MS = 60_000;
const BROWSER_VAULT_POST_REQUEST_POLL_WINDOW_MS = 5 * 60 * 1_000;
const EMPTY_BROWSER_VAULT_SESSION_METADATA: BrowserVaultSessionMetadata = {
  deviceSyncImportPending: false,
  freshness: "stale",
  refreshPending: false,
  workspaceVersion: null,
};

type BrowserVaultRuntimeRefreshCompletion = (
  client: BrowserVaultAnyQueryClient,
  ref: HostedBrowserVaultReplicaRef,
) => boolean;

interface BrowserVaultRefreshOptions {
  background?: boolean;
  requestRuntimeRefreshUntil?: BrowserVaultRuntimeRefreshCompletion;
  /**
   * Treat the forced refresh response as a request-local admission boundary.
   * Only a later replica may run the completion predicate.
   */
  requestRuntimeRefreshUntilAfterRequest?: BrowserVaultRuntimeRefreshCompletion;
  /**
   * Observe the current replica, then re-signal an admitted post-request wait
   * whose bounded polling window made no progress.
   */
  retryRuntimeRefreshAfterRequest?: boolean;
}

type BrowserVaultRuntimeRefreshAdmission =
  | { status: "awaiting_request" }
  | {
      ref: HostedBrowserVaultReplicaRef | null;
      status: "admitted";
    };

export interface BrowserVaultContextValue {
  /**
   * Prefer useBrowserVaultSelector for page/component reads so consumers only receive
   * the projected data they need. This raw client remains for current callers and
   * narrow escape hatches.
   */
  client: BrowserVaultAnyQueryClient | null;
  dataVersion: string | null;
  deviceSyncImportPending: boolean;
  error: string | null;
  freshness: BrowserVaultFreshness;
  ref: HostedBrowserVaultReplicaRef | null;
  refreshPending: boolean;
  refresh(options?: BrowserVaultRefreshOptions): Promise<void>;
  runtimeRefreshPending: boolean;
  status: BrowserVaultStatus;
  workspaceVersion: string | null;
}

const BrowserVaultContext = createContext<BrowserVaultContextValue | null>(null);
type RegisterBrowserVaultMetricBucketDemand = (
  owner: symbol,
  pathname: string,
  bucketIds: readonly BrowserVaultMetricBucketId[],
) => () => void;
const BrowserVaultMetricDemandContext = createContext<
  RegisterBrowserVaultMetricBucketDemand
>(() => () => {});
const DISABLED_BROWSER_VAULT_CONTEXT: BrowserVaultContextValue = {
  client: null,
  dataVersion: null,
  deviceSyncImportPending: false,
  error: null,
  freshness: "stale",
  ref: null,
  refresh: () => Promise.resolve(),
  refreshPending: false,
  runtimeRefreshPending: false,
  status: "empty",
  workspaceVersion: null,
};

function browserVaultSnapshotCoversDemand(
  snapshot: BrowserVaultReadySnapshot | null,
  requestedShards: readonly ("core" | "labs" | "metricsIndex")[],
  requestedMetricBuckets: readonly BrowserVaultMetricBucketId[],
): boolean {
  return snapshot !== null
    && requestedShards.every((shard) => snapshot.loadedShards.includes(shard))
    && requestedMetricBuckets.every((bucketId) =>
      snapshot.loadedMetricBuckets.includes(bucketId)
    );
}

export function BrowserVaultProvider({
  children,
  initialMemberId,
  loadEnabled = true,
}: {
  children: ReactNode;
  initialMemberId: string | null;
  loadEnabled?: boolean;
}) {
  if (!loadEnabled) {
    return (
      <DisabledBrowserVaultProvider>
        {children}
      </DisabledBrowserVaultProvider>
    );
  }

  return (
    <ActiveBrowserVaultProvider initialMemberId={initialMemberId}>
      {children}
    </ActiveBrowserVaultProvider>
  );
}

function DisabledBrowserVaultProvider({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    // Current server authority disables the payload owner. Drop any decrypted
    // dashboard snapshot before the blocked route can expose it.
    clearBrowserVaultWarmState();
  }, []);

  return (
    <BrowserVaultMetricDemandContext.Provider value={() => () => {}}>
      <BrowserVaultContext.Provider value={DISABLED_BROWSER_VAULT_CONTEXT}>
        {children}
      </BrowserVaultContext.Provider>
    </BrowserVaultMetricDemandContext.Provider>
  );
}

function ActiveBrowserVaultProvider({ children, initialMemberId }: {
  children: ReactNode;
  initialMemberId: string | null;
}) {
  const pathname = usePathname();
  // Router payloads can be reused after server authority changes. Keep the
  // decrypted module snapshot hidden until a post-mount session response
  // revalidates current authority and member ownership.
  const [status, setStatus] = useState<BrowserVaultStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<BrowserVaultFreshness>("stale");
  const [sessionRefreshPending, setSessionRefreshPending] = useState(false);
  const [runtimeRefreshPending, setRuntimeRefreshPending] = useState(false);
  const [runtimeRefreshPolling, setRuntimeRefreshPolling] = useState(false);
  const [workspaceVersion, setWorkspaceVersion] = useState<string | null>(null);
  const [client, setClient] = useState<BrowserVaultAnyQueryClient | null>(null);
  const [deviceSyncImportPending, setDeviceSyncImportPending] = useState(false);
  const [ref, setRef] = useState<HostedBrowserVaultReplicaRef | null>(null);
  const [admittedPathname, setAdmittedPathname] = useState<string | null>(null);
  const [metricBucketDemands, setMetricBucketDemands] = useState(new Map<
    symbol,
    { bucketIds: readonly BrowserVaultMetricBucketId[]; pathname: string }
  >());
  const clientRef = useRef<BrowserVaultAnyQueryClient | null>(null);
  const authorityGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const providerStartedLoadRef = useRef(false);
  const runtimeRefreshCompletionRef =
    useRef<BrowserVaultRuntimeRefreshCompletion | null>(null);
  const runtimeRefreshAdmissionRef =
    useRef<BrowserVaultRuntimeRefreshAdmission | null>(null);
  const runtimeRefreshSignalSentRef = useRef(false);
  const runtimeRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const registerMetricBucketDemand = useCallback((
    owner: symbol,
    demandPathname: string,
    bucketIds: readonly BrowserVaultMetricBucketId[],
  ) => {
    const normalized = normalizeBrowserVaultMetricBucketDemand(bucketIds);
    setMetricBucketDemands((current) => {
      const next = new Map(current);
      next.set(owner, { bucketIds: normalized, pathname: demandPathname });
      return next;
    });
    return () => {
      setMetricBucketDemands((current) => {
        if (!current.has(owner)) return current;
        const next = new Map(current);
        next.delete(owner);
        return next;
      });
    };
  }, []);

  const activeMetricBucketDemand = useMemo(() => {
    const bucketIds: BrowserVaultMetricBucketId[] = [];
    for (const demand of metricBucketDemands.values()) {
      if (demand.pathname === pathname) bucketIds.push(...demand.bucketIds);
    }
    return normalizeBrowserVaultMetricBucketDemand(bucketIds);
  }, [metricBucketDemands, pathname]);
  const activeMetricBucketDemandRef = useRef(activeMetricBucketDemand);
  useLayoutEffect(() => {
    activeMetricBucketDemandRef.current = activeMetricBucketDemand;
  }, [activeMetricBucketDemand]);

  const clearRuntimeRefreshWait = useCallback(() => {
    runtimeRefreshCompletionRef.current = null;
    runtimeRefreshAdmissionRef.current = null;
    runtimeRefreshSignalSentRef.current = false;
    if (runtimeRefreshTimeoutRef.current) {
      clearTimeout(runtimeRefreshTimeoutRef.current);
      runtimeRefreshTimeoutRef.current = null;
    }
    setRuntimeRefreshPending(false);
    setRuntimeRefreshPolling(false);
  }, []);

  const armPostRequestPollingWindow = useCallback(() => {
    if (runtimeRefreshTimeoutRef.current) {
      clearTimeout(runtimeRefreshTimeoutRef.current);
    }
    runtimeRefreshSignalSentRef.current = true;
    setRuntimeRefreshPending(true);
    setRuntimeRefreshPolling(true);
    runtimeRefreshTimeoutRef.current = setTimeout(() => {
      runtimeRefreshTimeoutRef.current = null;
      runtimeRefreshSignalSentRef.current = false;
      abortBrowserVaultInFlightLoad();
      providerStartedLoadRef.current = false;
      if (mountedRef.current) {
        setRuntimeRefreshPolling(false);
      }
    }, BROWSER_VAULT_POST_REQUEST_POLL_WINDOW_MS);
  }, []);

  const pausePostRequestPolling = useCallback(() => {
    if (runtimeRefreshTimeoutRef.current) {
      clearTimeout(runtimeRefreshTimeoutRef.current);
      runtimeRefreshTimeoutRef.current = null;
    }
    runtimeRefreshSignalSentRef.current = false;
    if (mountedRef.current) {
      setRuntimeRefreshPolling(false);
    }
  }, []);

  const beginRuntimeRefreshWait = useCallback(
    (
      isComplete: BrowserVaultRuntimeRefreshCompletion,
      requirePostRequestReplica: boolean,
    ) => {
      runtimeRefreshCompletionRef.current = isComplete;
      runtimeRefreshAdmissionRef.current = requirePostRequestReplica
        ? { status: "awaiting_request" }
        : null;
      if (runtimeRefreshTimeoutRef.current) {
        clearTimeout(runtimeRefreshTimeoutRef.current);
        runtimeRefreshTimeoutRef.current = null;
      }
      setRuntimeRefreshPending(true);
      if (requirePostRequestReplica) {
        // The hosted runtime publishes Browser Vault state only after its
        // checkpoint floor. Bound automatic observation without discarding the
        // request-local admission boundary needed for explicit recovery.
        armPostRequestPollingWindow();
        return;
      }
      setRuntimeRefreshPolling(true);
      runtimeRefreshTimeoutRef.current = setTimeout(() => {
        runtimeRefreshCompletionRef.current = null;
        runtimeRefreshAdmissionRef.current = null;
        runtimeRefreshSignalSentRef.current = false;
        runtimeRefreshTimeoutRef.current = null;
        abortBrowserVaultInFlightLoad();
        providerStartedLoadRef.current = false;
        if (mountedRef.current) {
          setSessionRefreshPending(false);
          setRuntimeRefreshPending(false);
          setRuntimeRefreshPolling(false);
        }
      }, BROWSER_VAULT_RUNTIME_REFRESH_TIMEOUT_MS);
    },
    [armPostRequestPollingWindow],
  );

  const commitReady = useCallback((snapshot: BrowserVaultReadySnapshot) => {
    const isRuntimeRefreshComplete = runtimeRefreshCompletionRef.current;
    const admission = runtimeRefreshAdmissionRef.current;
    const crossedRequiredAdmission = admission === null
      || (
        admission.status === "admitted"
        && (
          admission.ref === null
          || !browserVaultReplicaRefsMatch(admission.ref, snapshot.ref)
        )
      );
    const awaitingRequestedReplacement = isRuntimeRefreshComplete !== null
      && (
        !crossedRequiredAdmission
        || !isRuntimeRefreshComplete(snapshot.client, snapshot.ref)
      );
    if (isRuntimeRefreshComplete && !awaitingRequestedReplacement) {
      // A stronger refresh may be queued behind the load that delivered this
      // matching snapshot. Fence that now-redundant continuation before it can
      // claim the shared slot without a remaining predicate or deadline.
      abortBrowserVaultInFlightLoad();
      clearRuntimeRefreshWait();
    }
    clientRef.current = snapshot.client;
    setClient(snapshot.client);
    setRef(snapshot.ref);
    setStatus("ready");
    setError(null);
    setDeviceSyncImportPending(snapshot.metadata.deviceSyncImportPending);
    setFreshness(snapshot.metadata.freshness);
    setSessionRefreshPending(snapshot.metadata.refreshPending);
    setWorkspaceVersion(snapshot.metadata.workspaceVersion);
  }, [clearRuntimeRefreshWait]);

  const commitEmpty = useCallback((metadata: BrowserVaultSessionMetadata) => {
    clientRef.current = null;
    setClient(null);
    setRef(null);
    setStatus("empty");
    setError(null);
    setDeviceSyncImportPending(metadata.deviceSyncImportPending);
    setFreshness(metadata.freshness);
    setSessionRefreshPending(metadata.refreshPending);
    setWorkspaceVersion(metadata.workspaceVersion);
  }, []);

  const clearDecryptedClient = useCallback(() => {
    authorityGenerationRef.current += 1;
    clearBrowserVaultWarmState();
    providerStartedLoadRef.current = false;
    clearRuntimeRefreshWait();
    commitEmpty(EMPTY_BROWSER_VAULT_SESSION_METADATA);
    setAdmittedPathname(null);
  }, [clearRuntimeRefreshWait, commitEmpty]);

  const applyOutcome = useCallback(
    (outcome: BrowserVaultWarmLoadOutcome, options: {
      authorityPathname?: string;
      background: boolean;
      requiredDemand: boolean;
    }) => {
      const { authorityPathname, background, requiredDemand } = options;
      if (outcome.status === "superseded") {
        return;
      }
      if (outcome.status === "session_ending") {
        clearRuntimeRefreshWait();
        commitEmpty(EMPTY_BROWSER_VAULT_SESSION_METADATA);
        if (authorityPathname !== undefined) {
          setAdmittedPathname(authorityPathname);
        }
        return;
      }
      if (outcome.status === "identity_changed") {
        clearDecryptedClient();
        reloadCurrentHostedAuthDocument();
        return;
      }
      if (outcome.status === "ready") {
        commitReady(outcome.snapshot);
        if (authorityPathname !== undefined) {
          setAdmittedPathname(authorityPathname);
        }
        return;
      }
      if (outcome.status === "unauthorized") {
        clearDecryptedClient();
        if (outcome.httpStatus === 401) {
          if (initialMemberId !== null) {
            reloadCurrentHostedAuthDocument();
          }
          return;
        }
        setStatus("error");
        setError(outcome.message);
        return;
      }
      if (outcome.status === "empty") {
        commitEmpty(outcome.metadata);
        if (authorityPathname !== undefined) {
          setAdmittedPathname(authorityPathname);
        }
        return;
      }
      // A failed optional revalidation keeps ready stale data visible. A load
      // that owns currently-required route demand must surface its recoverable
      // error, while preserving the already-admitted partial client.
      if (background && clientRef.current && !requiredDemand) {
        return;
      }
      setStatus("error");
      setError(outcome.message);
    },
    [
      clearDecryptedClient,
      clearRuntimeRefreshWait,
      commitEmpty,
      commitReady,
      initialMemberId,
    ],
  );

  const runProviderLoad = useCallback(
    async (options: BrowserVaultRefreshOptions & {
      authorityPathname?: string;
      retryPostRequestRefresh?: boolean;
    } = {}) => {
      const background = options.background ?? false;
      const { authorityPathname } = options;
      if (
        options.requestRuntimeRefreshUntil
        && options.requestRuntimeRefreshUntilAfterRequest
      ) {
        throw new TypeError(
          "Choose one Browser Vault runtime refresh completion mode.",
        );
      }
      const runtimeRefreshCompletion = options.requestRuntimeRefreshUntil
        ?? options.requestRuntimeRefreshUntilAfterRequest;
      const requirePostRequestReplica =
        options.requestRuntimeRefreshUntilAfterRequest !== undefined;
      const requestRuntimeRefresh = runtimeRefreshCompletion !== undefined
        || options.retryPostRequestRefresh === true;
      const authorityGeneration = authorityPathname === undefined
        ? authorityGenerationRef.current
        : authorityGenerationRef.current + 1;
      if (authorityPathname !== undefined) {
        // The provider persists across dashboard routes. Retire page-owned
        // runtime work before the destination authority request starts so an
        // older handoff deadline can never abort the new route's load.
        if (runtimeRefreshCompletionRef.current) {
          clearRuntimeRefreshWait();
          abortBrowserVaultInFlightLoad();
          providerStartedLoadRef.current = false;
        }
        authorityGenerationRef.current = authorityGeneration;
        setAdmittedPathname(null);
        setStatus("loading");
        setError(null);
      }

      const existing = peekBrowserVaultInFlightLoad();
      if (authorityPathname !== undefined && existing) {
        // Preserve the shared dashboard request. Its result stays private
        // module state until a second, post-boundary request proves authority
        // using the resulting known replica ref.
        await existing;
        if (
          !mountedRef.current
          || authorityGeneration !== authorityGenerationRef.current
        ) {
          return null;
        }
      }

      const sharedLoad = peekBrowserVaultInFlightLoad();
      const startedLoad = !sharedLoad;
      if (startedLoad) {
        // This provider originated the load, so it owns aborting it on unmount.
        providerStartedLoadRef.current = true;
        if (!background && authorityPathname === undefined) {
          setStatus("loading");
          setError(null);
        }
      }

      if (runtimeRefreshCompletion) {
        beginRuntimeRefreshWait(
          runtimeRefreshCompletion,
          requirePostRequestReplica,
        );
      }

      const targetPathname = authorityPathname ?? pathname;
      const routeShards = planBrowserVaultRouteShards(targetPathname);
      const requestedMetricBuckets = targetPathname === pathname
        ? activeMetricBucketDemandRef.current
        : [];
      const requestedShards = requestedMetricBuckets.length > 0
        && !routeShards.includes("metricsIndex")
        ? [...routeShards, "metricsIndex" as const]
        : routeShards;
      const outcome = await startBrowserVaultWarmLoad({
        expectedMemberId: initialMemberId,
        requestedMetricBuckets,
        requestedShards,
        requestRefresh: requestRuntimeRefresh,
      });
      if (startedLoad && !peekBrowserVaultInFlightLoad()) {
        providerStartedLoadRef.current = false;
      }
      if (
        !mountedRef.current
        || authorityGeneration !== authorityGenerationRef.current
      ) {
        return null;
      }

      const currentRouteShards = planBrowserVaultRouteShards(pathname);
      const currentMetricBuckets = activeMetricBucketDemandRef.current;
      const currentRequestedShards = currentMetricBuckets.length > 0
        && !currentRouteShards.includes("metricsIndex")
        ? [...currentRouteShards, "metricsIndex" as const]
        : currentRouteShards;
      const currentSnapshot = getBrowserVaultReadySnapshot();
      const requiredDemand = background
        && targetPathname === pathname
        && currentRequestedShards.every((shard) => requestedShards.includes(shard))
        && currentMetricBuckets.every((bucketId) =>
          requestedMetricBuckets.includes(bucketId)
        )
        && !browserVaultSnapshotCoversDemand(
          currentSnapshot,
          currentRequestedShards,
          currentMetricBuckets,
        );

      if (requirePostRequestReplica) {
        // The runtime schedules its Browser Vault rebuild after responding to
        // the forced request. Its response is therefore the causal baseline,
        // not evidence that the requested rebuild has already published.
        if (outcome.status === "ready") {
          runtimeRefreshAdmissionRef.current = {
            ref: outcome.snapshot.ref,
            status: "admitted",
          };
        } else if (outcome.status === "empty") {
          runtimeRefreshAdmissionRef.current = {
            ref: null,
            status: "admitted",
          };
        } else {
          // No request-local boundary was admitted. Release this failed
          // attempt so the caller may explicitly retry it.
          clearRuntimeRefreshWait();
        }
      }

      if (
        options.retryPostRequestRefresh
        && outcome.status !== "ready"
        && outcome.status !== "empty"
      ) {
        // Preserve the original causal boundary, but stop this failed recovery
        // window so another explicit check can retry it.
        pausePostRequestPolling();
      }

      applyOutcome(outcome, {
        authorityPathname,
        background,
        requiredDemand,
      });
      return outcome;
    },
    [
      applyOutcome,
      beginRuntimeRefreshWait,
      clearRuntimeRefreshWait,
      initialMemberId,
      pathname,
      pausePostRequestPolling,
    ],
  );

  const retryRuntimeRefreshAfterRequest = useCallback(async () => {
    const observed = await runProviderLoad({ background: true });
    const admission = runtimeRefreshAdmissionRef.current;
    const stillAtAdmission = admission?.status === "admitted"
      && (
        admission.ref === null
          ? observed?.status === "empty"
          : observed?.status === "ready"
            && browserVaultReplicaRefsMatch(
              admission.ref,
              observed.snapshot.ref,
            )
      );
    if (
      runtimeRefreshCompletionRef.current === null
      || !stillAtAdmission
      || runtimeRefreshSignalSentRef.current
    ) {
      return;
    }

    // Mark the signal before starting the request so concurrent or repeated
    // clicks can observe but cannot create duplicate refresh pressure.
    armPostRequestPollingWindow();
    await runProviderLoad({
      background: true,
      retryPostRequestRefresh: true,
    });
  }, [armPostRequestPollingWindow, runProviderLoad]);

  const refresh = useCallback(
    async (options: BrowserVaultRefreshOptions = {}) => {
      if (options.retryRuntimeRefreshAfterRequest) {
        if (
          options.requestRuntimeRefreshUntil
          || options.requestRuntimeRefreshUntilAfterRequest
        ) {
          throw new TypeError(
            "A Browser Vault runtime refresh retry cannot start a new completion wait.",
          );
        }
        await retryRuntimeRefreshAfterRequest();
        return;
      }
      await runProviderLoad(
        options.background
          ? {
              background: true,
              requestRuntimeRefreshUntil: options.requestRuntimeRefreshUntil,
              requestRuntimeRefreshUntilAfterRequest:
                options.requestRuntimeRefreshUntilAfterRequest,
            }
          : {
              authorityPathname: pathname,
              requestRuntimeRefreshUntil: options.requestRuntimeRefreshUntil,
              requestRuntimeRefreshUntilAfterRequest:
                options.requestRuntimeRefreshUntilAfterRequest,
            },
      );
    },
    [pathname, retryRuntimeRefreshAfterRequest, runProviderLoad],
  );

  const pollStaleReplica = useCallback(async () => {
    await runProviderLoad({ background: true });
  }, [runProviderLoad]);

  const revalidateAuthority = useCallback(async (authorityPathname: string) => {
    await runProviderLoad({ authorityPathname });
  }, [runProviderLoad]);

  useLayoutEffect(() => {
    const unsubscribe = subscribeBrowserVaultSessionInvalidation(clearDecryptedClient);
    const currentSnapshot = getBrowserVaultReadySnapshot();

    // Subscribing before the recheck closes both sides of the render-to-effect
    // gap: an earlier invalidation already cleared the store, while a later one
    // reaches this listener. A different client is a different decrypted owner.
    if (
      clientRef.current
      && (
        currentSnapshot?.client !== clientRef.current
      )
    ) {
      clearDecryptedClient();
    }

    return unsubscribe;
  }, [clearDecryptedClient]);

  // The disabled branch clears adopted warm work during layout. Retire this
  // branch in the same phase so abort settlement cannot start a replacement.
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const ownsRuntimeRefresh = runtimeRefreshCompletionRef.current !== null;
      runtimeRefreshCompletionRef.current = null;
      runtimeRefreshAdmissionRef.current = null;
      runtimeRefreshSignalSentRef.current = false;
      if (runtimeRefreshTimeoutRef.current) {
        clearTimeout(runtimeRefreshTimeoutRef.current);
        runtimeRefreshTimeoutRef.current = null;
      }
      if (ownsRuntimeRefresh || providerStartedLoadRef.current) {
        abortBrowserVaultInFlightLoad();
        providerStartedLoadRef.current = false;
      }
    };
  }, []);

  useEffect(() => {
    // The persistent route-group provider admits module memory only after a
    // current-session response reauthorizes this exact pathname and member.
    void Promise.resolve().then(() => {
      if (mountedRef.current) {
        return revalidateAuthority(pathname);
      }
    });
  }, [pathname, revalidateAuthority]);

  useEffect(() => {
    if (admittedPathname !== pathname || status !== "ready") {
      return;
    }
    const snapshot = getBrowserVaultReadySnapshot();
    if (!snapshot) {
      return;
    }
    const routeShards = planBrowserVaultRouteShards(pathname);
    const requestedShards = activeMetricBucketDemand.length > 0
      && !routeShards.includes("metricsIndex")
      ? [...routeShards, "metricsIndex" as const]
      : routeShards;
    const demandAlreadyLoaded = browserVaultSnapshotCoversDemand(
      snapshot,
      requestedShards,
      activeMetricBucketDemand,
    )
      && snapshot.loadedShards.length === requestedShards.length
      && snapshot.loadedMetricBuckets.length === activeMetricBucketDemand.length;
    if (demandAlreadyLoaded) {
      return;
    }
    void Promise.resolve().then(() => {
      if (mountedRef.current && admittedPathname === pathname) {
        return runProviderLoad({ background: true });
      }
    });
  }, [
    activeMetricBucketDemand,
    admittedPathname,
    pathname,
    runProviderLoad,
    status,
  ]);

  useEffect(() => {
    const refreshPending = sessionRefreshPending || runtimeRefreshPolling;
    if (status === "error" || !refreshPending) {
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = () => {
      if (cancelled) {
        return;
      }

      void pollStaleReplica().finally(() => {
        if (!cancelled) {
          const interval = Date.now() - startedAt <= BROWSER_VAULT_STALE_POLL_WINDOW_MS
            ? BROWSER_VAULT_STALE_POLL_INTERVAL_MS
            : BROWSER_VAULT_STALE_POLL_SLOW_INTERVAL_MS;
          timeoutId = setTimeout(poll, interval);
        }
      });
    };

    timeoutId = setTimeout(poll, BROWSER_VAULT_STALE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [freshness, pollStaleReplica, runtimeRefreshPolling, sessionRefreshPending, status]);

  useEffect(() => {
    const onFocus = () => {
      if (admittedPathname === pathname) {
        void pollStaleReplica();
        return;
      }
      void revalidateAuthority(pathname);
    };

    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [admittedPathname, pathname, pollStaleReplica, revalidateAuthority]);

  const authorityAdmitted = admittedPathname === pathname;
  const refreshPending = sessionRefreshPending || runtimeRefreshPending;
  const value = useMemo<BrowserVaultContextValue>(() => ({
    client: authorityAdmitted ? client : null,
    dataVersion: authorityAdmitted ? ref?.dataVersion ?? null : null,
    deviceSyncImportPending: authorityAdmitted
      ? deviceSyncImportPending
      : false,
    error: authorityAdmitted || status === "error" ? error : null,
    freshness: authorityAdmitted ? freshness : "stale",
    ref: authorityAdmitted ? ref : null,
    refreshPending: authorityAdmitted ? refreshPending : false,
    refresh,
    runtimeRefreshPending: authorityAdmitted ? runtimeRefreshPending : false,
    status: authorityAdmitted || status === "empty" || status === "error"
      ? status
      : "loading",
    workspaceVersion: authorityAdmitted ? workspaceVersion : null,
  }), [authorityAdmitted, client, deviceSyncImportPending, error, freshness, ref, refresh, refreshPending, runtimeRefreshPending, status, workspaceVersion]);

  return (
    <BrowserVaultMetricDemandContext.Provider value={registerMetricBucketDemand}>
      <BrowserVaultContext.Provider value={value}>
        {children}
      </BrowserVaultContext.Provider>
    </BrowserVaultMetricDemandContext.Provider>
  );
}

export function useBrowserVault(): BrowserVaultContextValue {
  const value = useContext(BrowserVaultContext);

  if (!value) {
    throw new Error("useBrowserVault must be used inside a BrowserVaultProvider.");
  }

  return value;
}

export function useBrowserVaultSelector<T>(selector: (client: BrowserVaultAnyQueryClient) => T): T | null {
  const { client } = useBrowserVault();

  return useMemo(() => client ? selector(client) : null, [client, selector]);
}

export function useBrowserVaultMetricsSelector<T>(
  selector: (client: BrowserVaultMetricSeriesCapableQueryClient) => T,
): T | null {
  const { client } = useBrowserVault();
  const metricsClient = isBrowserVaultMetricsCapable(client) ? client : null;
  return useMemo(
    () => metricsClient ? selector(metricsClient) : null,
    [metricsClient, selector],
  );
}

export function useBrowserVaultLabsSelector<T>(
  selector: (client: BrowserVaultLabsCapableQueryClient) => T,
): T | null {
  const { client } = useBrowserVault();
  const labsClient = isBrowserVaultLabsCapable(client) ? client : null;
  return useMemo(
    () => labsClient ? selector(labsClient) : null,
    [labsClient, selector],
  );
}

export function useBrowserVaultFullSelector<T>(
  selector: (client: BrowserVaultQueryClient) => T,
): T | null {
  const { client } = useBrowserVault();
  const fullClient = client?.capability === "core+metrics+labs" ? client : null;
  return useMemo(
    () => fullClient ? selector(fullClient) : null,
    [fullClient, selector],
  );
}

export function isBrowserVaultMetricsCapable(
  client: BrowserVaultAnyQueryClient | null,
): client is BrowserVaultMetricSeriesCapableQueryClient {
  return client?.capability === "core+metrics-partial"
    || client?.capability === "core+metrics-partial+labs"
    || client?.capability === "core+metrics"
    || client?.capability === "core+metrics+labs";
}

export function isBrowserVaultLabsCapable(
  client: BrowserVaultAnyQueryClient | null,
): client is BrowserVaultLabsCapableQueryClient {
  return client?.capability === "core+labs"
    || client?.capability === "core+metrics-partial+labs"
    || client?.capability === "core+metrics+labs";
}

export function useBrowserVaultMetricBucketDemand(
  bucketIds: readonly BrowserVaultMetricBucketId[],
): boolean {
  const { client } = useBrowserVault();
  const registerMetricBucketDemand = useContext(BrowserVaultMetricDemandContext);
  const pathname = usePathname();
  const ownerRef = useRef(Symbol("browser-vault-metric-bucket-demand"));
  const demandKey = [...new Set(bucketIds)].sort().join(",");
  const normalized = useMemo(
    () => normalizeBrowserVaultMetricBucketDemand(
      demandKey.length === 0
        ? []
        : demandKey.split(",") as BrowserVaultMetricBucketId[],
    ),
    [demandKey],
  );
  useEffect(() => registerMetricBucketDemand(
    ownerRef.current,
    pathname,
    normalized,
  ), [normalized, pathname, registerMetricBucketDemand]);
  if (normalized.length === 0) return true;
  if (
    client?.capability === "core+metrics"
    || client?.capability === "core+metrics+labs"
  ) return true;
  if (!client || !("loadedMetricBuckets" in client)) return false;
  return normalized.every((bucketId) => client.loadedMetricBuckets.includes(bucketId));
}

export function useBrowserVaultMetricKeyDemand(
  metricKeys: readonly string[],
): boolean {
  const [bucketIds, setBucketIds] = useState<BrowserVaultMetricBucketId[]>([]);
  const metricKeyDemand = [...new Set(metricKeys.filter((key) => key.length > 0))]
    .sort()
    .join("\n");
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      metricKeyDemand.length === 0
        ? []
        : metricKeyDemand.split("\n").map(getBrowserVaultMetricBucketId),
    ).then((resolved) => {
      if (!cancelled) setBucketIds(normalizeBrowserVaultMetricBucketDemand(resolved));
    });
    return () => {
      cancelled = true;
    };
  }, [metricKeyDemand]);
  const bucketsLoaded = useBrowserVaultMetricBucketDemand(bucketIds);
  return metricKeyDemand.length === 0 || (bucketIds.length > 0 && bucketsLoaded);
}

export function useBrowserVaultExperimentMetricBucketDemand(input: {
  experimentId?: string;
  lookups?: readonly BrowserVaultExperimentRunCardLookup[];
}): boolean {
  const { client } = useBrowserVault();
  const lookups = input.lookups ?? [];
  const lookupKey = JSON.stringify(lookups);
  const stableLookups = useMemo(
    () => JSON.parse(lookupKey) as BrowserVaultExperimentRunCardLookup[],
    [lookupKey],
  );
  const card = useMemo(() => {
    if (!client) return null;
    if (input.experimentId) {
      const exact = client.experimentRunCards.get(input.experimentId);
      if (exact) return exact;
    }
    return stableLookups.map((lookup) => client.experimentRunCards.find(lookup))
      .find((candidate) => candidate !== null) ?? null;
  }, [client, input.experimentId, stableLookups]);
  const entityMetricKeys = useMemo(() => {
    if (!client || card) return null;
    if (input.experimentId) {
      const exact = selectBrowserVaultExperimentMetricKeys(client, {
        experimentId: input.experimentId,
      });
      if (exact !== null) return exact;
    }
    for (const lookup of stableLookups) {
      const match = selectBrowserVaultExperimentMetricKeys(client, lookup);
      if (match !== null) return match;
    }
    return null;
  }, [card, client, input.experimentId, stableLookups]);
  const cardBucketsLoaded = useBrowserVaultMetricBucketDemand(
    card?.requiredMetricBuckets ?? [],
  );
  const entityMetricKeysLoaded = useBrowserVaultMetricKeyDemand(entityMetricKeys ?? []);
  return client !== null && (
    card ? cardBucketsLoaded : entityMetricKeys === null || entityMetricKeysLoaded
  );
}
