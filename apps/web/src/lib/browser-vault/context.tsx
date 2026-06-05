"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { type BrowserVaultQueryClient } from "@murphai/query/browser-replica-client";
import { type HostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/browser-vault";

import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";

import {
  isBrowserVaultAbortError,
  loadBrowserVaultReplica,
  normalizeBrowserVaultError,
  type BrowserVaultFreshness,
  type BrowserVaultSessionLoadResult,
} from "./loader";

export type BrowserVaultStatus = "loading" | "ready" | "empty" | "error";

const BROWSER_VAULT_STALE_POLL_INTERVAL_MS = 1_500;
const BROWSER_VAULT_STALE_POLL_WINDOW_MS = 20_000;

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

export function BrowserVaultProvider({ children }: { children: ReactNode }) {
  const { authenticated } = useAuth();

  if (!authenticated) {
    return (
      <BrowserVaultContext.Provider value={anonymousBrowserVaultContext}>
        {children}
      </BrowserVaultContext.Provider>
    );
  }

  return <AuthenticatedBrowserVaultProvider>{children}</AuthenticatedBrowserVaultProvider>;
}

function AuthenticatedBrowserVaultProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<BrowserVaultStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<BrowserVaultFreshness>("stale");
  const [refreshPending, setRefreshPending] = useState(false);
  const [workspaceVersion, setWorkspaceVersion] = useState<string | null>(null);
  const [client, setClient] = useState<BrowserVaultQueryClient | null>(null);
  const [deviceSyncImportPending, setDeviceSyncImportPending] = useState(false);
  const [ref, setRef] = useState<HostedBrowserVaultReplicaRef | null>(null);
  const clientRef = useRef<BrowserVaultQueryClient | null>(null);
  const refRef = useRef<HostedBrowserVaultReplicaRef | null>(null);
  const inFlightLoadRef = useRef<Promise<void> | null>(null);
  const activeLoadIdRef = useRef(0);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);

  const commitClientAndRef = useCallback((nextClient: BrowserVaultQueryClient | null, nextRef: HostedBrowserVaultReplicaRef | null) => {
    clientRef.current = nextClient;
    refRef.current = nextRef;
    setClient(nextClient);
    setRef(nextRef);
  }, []);

  const cancelActiveLoad = useCallback(() => {
    activeLoadIdRef.current += 1;
    activeAbortControllerRef.current?.abort();
    activeAbortControllerRef.current = null;
    inFlightLoadRef.current = null;
  }, []);

  const commitLoadResult = useCallback((result: BrowserVaultSessionLoadResult) => {
    setDeviceSyncImportPending(result.deviceSyncImportPending);
    setFreshness(result.freshness);
    setRefreshPending(result.refreshPending);
    setWorkspaceVersion(result.workspaceVersion);

    if (result.state === "not_modified") {
      if (!clientRef.current) {
        throw new Error("Browser vault replica was unchanged but no decrypted client was available.");
      }

      commitClientAndRef(clientRef.current, result.replicaRef);
      setStatus("ready");
      setError(null);
      return;
    }

    if (result.state === "empty") {
      commitClientAndRef(null, null);
      setStatus("empty");
      setError(null);
      return;
    }

    commitClientAndRef(result.client, result.replicaRef);
    setStatus("ready");
    setError(null);
  }, [commitClientAndRef]);

  const startBrowserVaultReplicaLoad = useCallback(async () => {
    if (inFlightLoadRef.current) {
      return inFlightLoadRef.current;
    }

    const loadId = activeLoadIdRef.current + 1;
    activeLoadIdRef.current = loadId;
    const abortController = new AbortController();
    activeAbortControllerRef.current = abortController;

    const loadPromise = (async () => {
      try {
        const result = await loadBrowserVaultReplica({
          knownReplicaRef: refRef.current,
          signal: abortController.signal,
        });

        if (!mountedRef.current || loadId !== activeLoadIdRef.current) {
          return;
        }

        commitLoadResult(result);
      } catch (loadError) {
        if (!mountedRef.current || loadId !== activeLoadIdRef.current || isBrowserVaultAbortError(loadError)) {
          return;
        }

        setStatus("error");
        setError(normalizeBrowserVaultError(loadError));
      } finally {
        if (activeLoadIdRef.current === loadId) {
          activeAbortControllerRef.current = null;
        }

        if (activeLoadIdRef.current === loadId) {
          inFlightLoadRef.current = null;
        }
      }
    })();

    inFlightLoadRef.current = loadPromise;
    return loadPromise;
  }, [commitLoadResult]);

  const loadReplica = useCallback(async (options: { background?: boolean } = {}) => {
    if (!inFlightLoadRef.current) {
      if (!options.background) {
        setStatus("loading");
      }
      setError(null);
    }

    return startBrowserVaultReplicaLoad();
  }, [startBrowserVaultReplicaLoad]);

  const load = useCallback(async () => loadReplica(), [loadReplica]);
  const pollStaleReplica = useCallback(
    async () => loadReplica({ background: true }),
    [loadReplica],
  );

  useEffect(() => {
    mountedRef.current = true;
    void startBrowserVaultReplicaLoad();

    return () => {
      mountedRef.current = false;
      cancelActiveLoad();
    };
  }, [cancelActiveLoad, startBrowserVaultReplicaLoad]);

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
      if (refreshPending) {
        void pollStaleReplica();
      }
    };

    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [freshness, pollStaleReplica, refreshPending]);

  const value = useMemo<BrowserVaultContextValue>(() => ({
    client,
    dataVersion: ref?.dataVersion ?? null,
    deviceSyncImportPending,
    error,
    freshness,
    ref,
    refreshPending,
    refresh: load,
    status,
    workspaceVersion,
  }), [client, deviceSyncImportPending, error, freshness, load, ref, refreshPending, status, workspaceVersion]);
  const showSyncIndicator =
    status !== "error"
    && refreshPending;

  return (
    <BrowserVaultContext.Provider value={value}>
      {children}
      {showSyncIndicator ? (
        <div
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-lg"
          role="status"
        >
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"
          />
          <span>
            {status === "empty"
              ? "Preparing dashboard..."
              : "Syncing latest changes..."}
          </span>
        </div>
      ) : null}
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
