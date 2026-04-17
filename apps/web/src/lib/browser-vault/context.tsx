"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  decryptHostedStoragePayload,
  generateHostedUserRecipientKeyPair,
  parseHostedCipherEnvelope,
  parseHostedUserRootKeyEnvelope,
  unwrapHostedUserRootKeyForKind,
  type HostedCipherEnvelope,
  type HostedUserRootKeyEnvelope,
} from "@murphai/runtime-state";
import {
  createVaultReadModel,
  parseBrowserVaultSnapshot,
  type BrowserVaultSnapshot,
  type VaultReadModel,
} from "@murphai/query/browser";

export type BrowserVaultStatus = "loading" | "ready" | "error";

export interface BrowserVaultContextValue {
  error: string | null;
  refresh(): Promise<void>;
  snapshot: BrowserVaultSnapshot | null;
  status: BrowserVaultStatus;
  vault: VaultReadModel;
}

const BrowserVaultContext = createContext<BrowserVaultContextValue | null>(null);
const textDecoder = new TextDecoder();

export function BrowserVaultProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<BrowserVaultStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<BrowserVaultSnapshot | null>(null);
  const [vault, setVault] = useState<VaultReadModel>(() => createEmptyBrowserVaultReadModel());

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);

    try {
      const next = await loadBrowserVaultSnapshot();
      setSnapshot(next.snapshot);
      setVault(next.vault);
      setStatus("ready");
    } catch (loadError) {
      setSnapshot(null);
      setVault(createEmptyBrowserVaultReadModel());
      setStatus("error");
      setError(loadError instanceof Error ? loadError.message : "Failed to load browser vault snapshot.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const next = await loadBrowserVaultSnapshot();

        if (cancelled) {
          return;
        }

        setSnapshot(next.snapshot);
        setVault(next.vault);
        setStatus("ready");
        setError(null);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setSnapshot(null);
        setVault(createEmptyBrowserVaultReadModel());
        setStatus("error");
        setError(loadError instanceof Error ? loadError.message : "Failed to load browser vault snapshot.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<BrowserVaultContextValue>(() => ({
    error,
    refresh: load,
    snapshot,
    status,
    vault,
  }), [error, load, snapshot, status, vault]);

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

async function loadBrowserVaultSnapshot(): Promise<{
  snapshot: BrowserVaultSnapshot | null;
  vault: VaultReadModel;
}> {
  const { privateKeyJwk, publicKeyJwk } = await generateHostedUserRecipientKeyPair();
  const response = await fetch("/api/browser-vault/session", {
    body: JSON.stringify({
      browserPublicKeyJwk: publicKeyJwk,
    }),
    credentials: "same-origin",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await readJsonErrorMessage(response));
  }

  const session = parseBrowserVaultSessionResponse(await response.json());

  if (!session.rootKeyEnvelope || !session.snapshotEnvelope) {
    return {
      snapshot: null,
      vault: createEmptyBrowserVaultReadModel(),
    };
  }

  const rootKey = await unwrapHostedUserRootKeyForKind({
    envelope: session.rootKeyEnvelope,
    kind: "user-unlock",
    recipientPrivateKeyJwk: privateKeyJwk,
  });
  const plaintext = await decryptHostedStoragePayload({
    envelope: session.snapshotEnvelope,
    expectedKeyId: session.rootKeyEnvelope.rootKeyId,
    key: rootKey,
    scope: "browser-vault-snapshot",
  });
  const snapshot = parseBrowserVaultSnapshot(
    JSON.parse(textDecoder.decode(plaintext)) as unknown,
  );

  return {
    snapshot,
    vault: createVaultReadModel({
      entities: snapshot.entities,
      metadata: snapshot.metadata,
      vaultRoot: "browser://vault",
    }),
  };
}

function createEmptyBrowserVaultReadModel(): VaultReadModel {
  return createVaultReadModel({
    entities: [],
    metadata: null,
    vaultRoot: "browser://vault",
  });
}

function parseBrowserVaultSessionResponse(value: unknown): {
  rootKeyEnvelope: HostedUserRootKeyEnvelope | null;
  snapshotEnvelope: HostedCipherEnvelope | null;
} {
  const record = requireRecord(value, "Browser vault session response");

  return {
    rootKeyEnvelope: record.rootKeyEnvelope === null || record.rootKeyEnvelope === undefined
      ? null
      : parseHostedUserRootKeyEnvelope(
        record.rootKeyEnvelope,
        "Browser vault session response rootKeyEnvelope",
      ),
    snapshotEnvelope: record.snapshotEnvelope === null || record.snapshotEnvelope === undefined
      ? null
      : parseHostedCipherEnvelope(
        record.snapshotEnvelope,
        "Browser vault session response snapshotEnvelope",
      ),
  };
}

async function readJsonErrorMessage(response: Response): Promise<string> {
  try {
    const value = await response.json();
    const record = requireRecord(value, "Browser vault error response");
    const message = record.error;
    const nestedMessage = message && typeof message === "object" && !Array.isArray(message)
      ? (message as Record<string, unknown>).message
      : null;

    return typeof message === "string" && message.trim().length > 0
      ? message
      : typeof nestedMessage === "string" && nestedMessage.trim().length > 0
        ? nestedMessage
      : `Browser vault session failed with HTTP ${response.status}.`;
  } catch {
    return `Browser vault session failed with HTTP ${response.status}.`;
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}
