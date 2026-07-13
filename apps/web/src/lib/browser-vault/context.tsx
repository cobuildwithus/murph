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

export function BrowserVaultProvider({ children, initialMemberId }: {
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
  const [refreshPending, setRefreshPending] = useState(false);
  const [workspaceVersion, setWorkspaceVersion] = useState<string | null>(null);
  const [client, setClient] = useState<BrowserVaultQueryClient | null>(null);
  const [deviceSyncImportPending, setDeviceSyncImportPending] = useState(false);
  const [ref, setRef] = useState<HostedBrowserVaultReplicaRef | null>(null);
  const clientRef = useRef<BrowserVaultQueryClient | null>(null);
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
      if (outcome.status === "session_ending") {
        commitEmpty(EMPTY_BROWSER_VAULT_SESSION_METADATA);
        return;
      }
      if (outcome.status === "identity_changed") {
        clearDecryptedClient();
        reloadCurrentHostedAuthDocument();
        return;
      }
      if (outcome.status === "ready") {
        commitReady(outcome.snapshot);
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
    [clearDecryptedClient, commitEmpty, commitReady, initialMemberId],
  );

  const runProviderLoad = useCallback(
    async (options: {
      background?: boolean;
      requireFreshAuthority?: boolean;
    } = {}) => {
      const background = options.background ?? false;
      const requireFreshAuthority = options.requireFreshAuthority ?? false;
      const authorityGeneration = authorityGenerationRef.current;
      const existing = peekBrowserVaultInFlightLoad();
      if (!existing || requireFreshAuthority) {
        // This provider originated the load, so it owns aborting it on unmount.
        providerStartedLoadRef.current = true;
        if (!background) {
          setStatus("loading");
          setError(null);
        }
      }

      const outcome = await startBrowserVaultWarmLoad({
        expectedMemberId: initialMemberId,
        requireFreshAuthority,
      });
      if (
        !mountedRef.current
        || authorityGeneration !== authorityGenerationRef.current
      ) {
        return;
      }

      applyOutcome(outcome, background);
      providerStartedLoadRef.current = false;
    },
    [applyOutcome, initialMemberId],
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
      )
    ) {
      clearDecryptedClient();
    }

    return unsubscribe;
  }, [clearDecryptedClient]);

  useEffect(() => {
    mountedRef.current = true;
    // The persistent route-group provider admits module memory only after a
    // fresh current-session response reauthorizes the same member.
    void Promise.resolve().then(() => {
      if (!mountedRef.current) {
        return;
      }
      return runProviderLoad({
        background: true,
        requireFreshAuthority: true,
      });
    });

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
