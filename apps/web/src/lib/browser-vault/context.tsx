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
import { type BrowserVaultQueryClient } from "@murphai/query/browser-replica-client";
import { type HostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/browser-vault";

import { reloadCurrentHostedAuthDocument } from "@/src/components/hosted-onboarding/hosted-auth-navigation";

import { type BrowserVaultFreshness, type BrowserVaultSessionMetadata } from "./loader";
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
const EMPTY_BROWSER_VAULT_SESSION_METADATA: BrowserVaultSessionMetadata = {
  deviceSyncImportPending: false,
  freshness: "stale",
  refreshPending: false,
  workspaceVersion: null,
};

export interface BrowserVaultContextValue {
  /**
   * Prefer useBrowserVaultSelector for page/component reads so consumers only receive
   * the projected data they need. This raw client remains for current callers and
   * narrow escape hatches.
   */
  client: BrowserVaultQueryClient | null;
  dataVersion: string | null;
  deviceSyncImportPending: boolean;
  error: string | null;
  freshness: BrowserVaultFreshness;
  ref: HostedBrowserVaultReplicaRef | null;
  refreshPending: boolean;
  refresh(options?: {
    background?: boolean;
    requestRuntimeRefreshUntil?: (client: BrowserVaultQueryClient) => boolean;
  }): Promise<void>;
  runtimeRefreshPending: boolean;
  status: BrowserVaultStatus;
  workspaceVersion: string | null;
}

const BrowserVaultContext = createContext<BrowserVaultContextValue | null>(null);
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
    // A landing-page warm load may predate the server consent check. Drop any
    // decrypted snapshot before the blocked dashboard can expose it.
    clearBrowserVaultWarmState();
  }, []);

  return (
    <BrowserVaultContext.Provider value={DISABLED_BROWSER_VAULT_CONTEXT}>
      {children}
    </BrowserVaultContext.Provider>
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
  const [workspaceVersion, setWorkspaceVersion] = useState<string | null>(null);
  const [client, setClient] = useState<BrowserVaultQueryClient | null>(null);
  const [deviceSyncImportPending, setDeviceSyncImportPending] = useState(false);
  const [ref, setRef] = useState<HostedBrowserVaultReplicaRef | null>(null);
  const [admittedPathname, setAdmittedPathname] = useState<string | null>(null);
  const clientRef = useRef<BrowserVaultQueryClient | null>(null);
  const authorityGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const providerStartedLoadRef = useRef(false);
  const runtimeRefreshCompletionRef = useRef<
    ((client: BrowserVaultQueryClient) => boolean) | null
  >(null);
  const runtimeRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const clearRuntimeRefreshWait = useCallback(() => {
    runtimeRefreshCompletionRef.current = null;
    if (runtimeRefreshTimeoutRef.current) {
      clearTimeout(runtimeRefreshTimeoutRef.current);
      runtimeRefreshTimeoutRef.current = null;
    }
    setRuntimeRefreshPending(false);
  }, []);

  const beginRuntimeRefreshWait = useCallback(
    (isComplete: (client: BrowserVaultQueryClient) => boolean) => {
      runtimeRefreshCompletionRef.current = isComplete;
      if (runtimeRefreshTimeoutRef.current) {
        clearTimeout(runtimeRefreshTimeoutRef.current);
      }
      setRuntimeRefreshPending(true);
      runtimeRefreshTimeoutRef.current = setTimeout(() => {
        runtimeRefreshCompletionRef.current = null;
        runtimeRefreshTimeoutRef.current = null;
        abortBrowserVaultInFlightLoad();
        providerStartedLoadRef.current = false;
        if (mountedRef.current) {
          setSessionRefreshPending(false);
          setRuntimeRefreshPending(false);
        }
      }, BROWSER_VAULT_RUNTIME_REFRESH_TIMEOUT_MS);
    },
    [],
  );

  const commitReady = useCallback((snapshot: BrowserVaultReadySnapshot) => {
    const isRuntimeRefreshComplete = runtimeRefreshCompletionRef.current;
    const awaitingRequestedReplacement = isRuntimeRefreshComplete !== null
      && !isRuntimeRefreshComplete(snapshot.client);
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
    }) => {
      const { authorityPathname, background } = options;
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
      // A failed background revalidation keeps the ready stale data visible
      // instead of replacing it with an error-only screen. Foreground loads and
      // cold mounts with no client still surface the error.
      if (background && clientRef.current) {
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
    async (options: {
      authorityPathname?: string;
      background?: boolean;
      requestRuntimeRefreshUntil?: (client: BrowserVaultQueryClient) => boolean;
    } = {}) => {
      const background = options.background ?? false;
      const { authorityPathname } = options;
      const runtimeRefreshCompletion = options.requestRuntimeRefreshUntil;
      const requestRuntimeRefresh = runtimeRefreshCompletion !== undefined;
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
        // Preserve the landing warm request. Its result stays private module
        // state until a second, post-boundary request proves current authority
        // using the resulting known replica ref.
        await existing;
        if (
          !mountedRef.current
          || authorityGeneration !== authorityGenerationRef.current
        ) {
          return;
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
        beginRuntimeRefreshWait(runtimeRefreshCompletion);
      }

      const outcome = await startBrowserVaultWarmLoad({
        expectedMemberId: initialMemberId,
        requestRefresh: requestRuntimeRefresh,
      });
      if (startedLoad && !peekBrowserVaultInFlightLoad()) {
        providerStartedLoadRef.current = false;
      }
      if (
        !mountedRef.current
        || authorityGeneration !== authorityGenerationRef.current
      ) {
        return;
      }

      applyOutcome(outcome, { authorityPathname, background });
    },
    [
      applyOutcome,
      beginRuntimeRefreshWait,
      clearRuntimeRefreshWait,
      initialMemberId,
    ],
  );

  const refresh = useCallback(
    async (options: {
      background?: boolean;
      requestRuntimeRefreshUntil?: (client: BrowserVaultQueryClient) => boolean;
    } = {}) => {
      await runProviderLoad(
        options.background
          ? {
              background: true,
              requestRuntimeRefreshUntil: options.requestRuntimeRefreshUntil,
            }
          : {
              authorityPathname: pathname,
              requestRuntimeRefreshUntil: options.requestRuntimeRefreshUntil,
            },
      );
    },
    [pathname, runProviderLoad],
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
    const refreshPending = sessionRefreshPending || runtimeRefreshPending;
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
  }, [freshness, pollStaleReplica, runtimeRefreshPending, sessionRefreshPending, status]);

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
    <BrowserVaultContext.Provider value={value}>
      {children}
    </BrowserVaultContext.Provider>
  );
}

export function useBrowserVault(): BrowserVaultContextValue {
  const value = useContext(BrowserVaultContext);

  if (!value) {
    throw new Error("useBrowserVault must be used inside a BrowserVaultProvider.");
  }

  return value;
}

export function useBrowserVaultSelector<T>(selector: (client: BrowserVaultQueryClient) => T): T | null {
  const { client } = useBrowserVault();

  return useMemo(() => client ? selector(client) : null, [client, selector]);
}
