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
import { type BrowserVaultQueryClient } from "@murphai/query/browser";
import { type HostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/browser-vault";

import {
  isBrowserVaultAbortError,
  loadBrowserVaultReplica,
  normalizeBrowserVaultError,
  type BrowserVaultSessionLoadResult,
} from "./loader";

export type BrowserVaultStatus = "loading" | "ready" | "empty" | "error";

export interface BrowserVaultContextValue {
  /**
   * Prefer useBrowserVaultSelector for page/component reads so consumers only receive
   * the projected data they need. This raw client remains for current callers and
   * narrow escape hatches.
   */
  client: BrowserVaultQueryClient | null;
  dataVersion: string | null;
  error: string | null;
  ref: HostedBrowserVaultReplicaRef | null;
  refresh(): Promise<void>;
  status: BrowserVaultStatus;
}

const BrowserVaultContext = createContext<BrowserVaultContextValue | null>(null);

export function BrowserVaultProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<BrowserVaultStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState<BrowserVaultQueryClient | null>(null);
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

  const commitLoadResult = useCallback((result: BrowserVaultSessionLoadResult) => {
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

  const load = useCallback(async () => {
    if (inFlightLoadRef.current) {
      return inFlightLoadRef.current;
    }

    const loadId = activeLoadIdRef.current + 1;
    activeLoadIdRef.current = loadId;
    const abortController = new AbortController();
    activeAbortControllerRef.current = abortController;
    setStatus("loading");
    setError(null);

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

  useEffect(() => {
    mountedRef.current = true;
    void load();

    return () => {
      mountedRef.current = false;
      activeLoadIdRef.current += 1;
      activeAbortControllerRef.current?.abort();
      activeAbortControllerRef.current = null;
      inFlightLoadRef.current = null;
    };
  }, [load]);

  const value = useMemo<BrowserVaultContextValue>(() => ({
    client,
    dataVersion: ref?.dataVersion ?? null,
    error,
    ref,
    refresh: load,
    status,
  }), [client, error, load, ref, status]);

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
