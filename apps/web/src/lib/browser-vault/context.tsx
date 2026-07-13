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

import { navigateHostedAuthRedirect } from "@/src/components/hosted-onboarding/hosted-auth-navigation";

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
  refresh(): Promise<void>;
  status: BrowserVaultStatus;
  workspaceVersion: string | null;
}

const BrowserVaultContext = createContext<BrowserVaultContextValue | null>(null);

const anonymousBrowserVaultContext: BrowserVaultContextValue = {
  client: null,
  dataVersion: null,
  deviceSyncImportPending: false,
  error: null,
  freshness: "stale",
  ref: null,
  refreshPending: false,
  refresh: async () => undefined,
  status: "empty",
  workspaceVersion: null,
};

export function BrowserVaultProvider({
  authorized,
  children,
  memberId,
}: {
  authorized: boolean;
  children: ReactNode;
  memberId: string | null;
}) {
  // The route template's current server result owns vault authority. Hide the
  // client synchronously and clear denied or mismatched memory before paint.
  useLayoutEffect(() => {
    const snapshot = getBrowserVaultReadySnapshot();
    if (!authorized || !memberId || (snapshot && snapshot.memberId !== memberId)) {
      clearBrowserVaultWarmState();
    }
  }, [authorized, memberId]);

  if (!authorized || !memberId) {
    return (
      <BrowserVaultContext.Provider value={anonymousBrowserVaultContext}>
        {children}
      </BrowserVaultContext.Provider>
    );
  }

  return (
    <AuthenticatedBrowserVaultProvider key={memberId} memberId={memberId}>
      {children}
    </AuthenticatedBrowserVaultProvider>
  );
}

function AuthenticatedBrowserVaultProvider({
  children,
  memberId,
}: {
  children: ReactNode;
  memberId: string;
}) {
  const pathname = usePathname();
  // Seed lazily from the module-memory ready snapshot so a warmed landing page
  // shows decrypted data on the first paint and revalidates in the background.
  const warmSnapshot = getBrowserVaultReadySnapshot();
  const initialSnapshot = warmSnapshot?.memberId === memberId ? warmSnapshot : null;
  const [status, setStatus] = useState<BrowserVaultStatus>(initialSnapshot ? "ready" : "loading");
  const [error, setError] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<BrowserVaultFreshness>(
    initialSnapshot?.metadata.freshness ?? "stale",
  );
  const [refreshPending, setRefreshPending] = useState(
    initialSnapshot?.metadata.refreshPending ?? false,
  );
  const [workspaceVersion, setWorkspaceVersion] = useState<string | null>(
    initialSnapshot?.metadata.workspaceVersion ?? null,
  );
  const [client, setClient] = useState<BrowserVaultQueryClient | null>(
    initialSnapshot?.client ?? null,
  );
  const [deviceSyncImportPending, setDeviceSyncImportPending] = useState(
    initialSnapshot?.metadata.deviceSyncImportPending ?? false,
  );
  const [ref, setRef] = useState<HostedBrowserVaultReplicaRef | null>(
    initialSnapshot?.ref ?? null,
  );
  const clientRef = useRef<BrowserVaultQueryClient | null>(initialSnapshot?.client ?? null);
  const authorityGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const providerStartedLoadRef = useRef(false);
  const lastRevalidatedPathnameRef = useRef(pathname);

  const commitReady = useCallback((snapshot: BrowserVaultReadySnapshot) => {
    clientRef.current = snapshot.client;
    setClient(snapshot.client);
    setRef(snapshot.ref);
    setStatus("ready");
    setError(null);
    setDeviceSyncImportPending(snapshot.metadata.deviceSyncImportPending);
    setFreshness(snapshot.metadata.freshness);
    setRefreshPending(snapshot.metadata.refreshPending);
    setWorkspaceVersion(snapshot.metadata.workspaceVersion);
  }, []);

  const commitEmpty = useCallback((metadata: BrowserVaultSessionMetadata) => {
    clientRef.current = null;
    setClient(null);
    setRef(null);
    setStatus("empty");
    setError(null);
    setDeviceSyncImportPending(metadata.deviceSyncImportPending);
    setFreshness(metadata.freshness);
    setRefreshPending(metadata.refreshPending);
    setWorkspaceVersion(metadata.workspaceVersion);
  }, []);

  const clearDecryptedClient = useCallback(() => {
    authorityGenerationRef.current += 1;
    clearBrowserVaultWarmState();
    providerStartedLoadRef.current = false;
    commitEmpty(EMPTY_BROWSER_VAULT_SESSION_METADATA);
  }, [commitEmpty]);

  const applyOutcome = useCallback(
    (outcome: BrowserVaultWarmLoadOutcome, background: boolean) => {
      if (outcome.status === "superseded") {
        return;
      }
      if (outcome.status === "ready") {
        if (outcome.snapshot.memberId !== memberId) {
          clearDecryptedClient();
          return;
        }
        commitReady(outcome.snapshot);
        return;
      }
      if (outcome.status === "unauthorized") {
        clearDecryptedClient();
        if (outcome.httpStatus === 401) {
          navigateHostedAuthRedirect("/");
          return;
        }
        setStatus("error");
        setError(outcome.message);
        return;
      }
      if (outcome.status === "empty") {
        commitEmpty(outcome.metadata);
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
    [clearDecryptedClient, commitEmpty, commitReady, memberId],
  );

  const runProviderLoad = useCallback(
    async (options: { background?: boolean } = {}) => {
      const background = options.background ?? false;
      const authorityGeneration = authorityGenerationRef.current;
      const existing = peekBrowserVaultInFlightLoad();
      if (!existing) {
        // This provider originated the load, so it owns aborting it on unmount.
        providerStartedLoadRef.current = true;
        if (!background) {
          setStatus("loading");
          setError(null);
        }
      }

      const outcome = await (existing ?? startBrowserVaultWarmLoad());
      if (
        !mountedRef.current
        || authorityGeneration !== authorityGenerationRef.current
      ) {
        return;
      }

      applyOutcome(outcome, background);
      providerStartedLoadRef.current = false;
    },
    [applyOutcome],
  );

  const refresh = useCallback(async () => {
    await runProviderLoad({ background: false });
  }, [runProviderLoad]);

  const pollStaleReplica = useCallback(async () => {
    await runProviderLoad({ background: true });
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
        || currentSnapshot.memberId !== memberId
      )
    ) {
      clearDecryptedClient();
    }

    return unsubscribe;
  }, [clearDecryptedClient, memberId]);

  useEffect(() => {
    mountedRef.current = true;
    // A seeded ready snapshot revalidates in the background so stale data stays
    // visible; a cold mount loads in the foreground, reusing any in-flight
    // landing warm request instead of issuing a second fetch.
    void runProviderLoad({ background: clientRef.current !== null });

    return () => {
      mountedRef.current = false;
      if (providerStartedLoadRef.current) {
        abortBrowserVaultInFlightLoad();
        providerStartedLoadRef.current = false;
      }
    };
  }, [runProviderLoad]);

  useEffect(() => {
    if (lastRevalidatedPathnameRef.current === pathname) {
      return;
    }

    lastRevalidatedPathnameRef.current = pathname;
    void pollStaleReplica();
  }, [pathname, pollStaleReplica]);

  useEffect(() => {
    if (status === "error" || !refreshPending) {
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = () => {
      if (cancelled || Date.now() - startedAt > BROWSER_VAULT_STALE_POLL_WINDOW_MS) {
        return;
      }

      void pollStaleReplica().finally(() => {
        if (!cancelled && Date.now() - startedAt <= BROWSER_VAULT_STALE_POLL_WINDOW_MS) {
          timeoutId = setTimeout(poll, BROWSER_VAULT_STALE_POLL_INTERVAL_MS);
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
  }, [freshness, pollStaleReplica, refreshPending, status]);

  useEffect(() => {
    const onFocus = () => {
      void pollStaleReplica();
    };

    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [pollStaleReplica]);

  const value = useMemo<BrowserVaultContextValue>(() => ({
    client,
    dataVersion: ref?.dataVersion ?? null,
    deviceSyncImportPending,
    error,
    freshness,
    ref,
    refreshPending,
    refresh,
    status,
    workspaceVersion,
  }), [client, deviceSyncImportPending, error, freshness, ref, refresh, refreshPending, status, workspaceVersion]);

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
