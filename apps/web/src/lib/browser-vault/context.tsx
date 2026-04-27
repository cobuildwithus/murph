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
  buildHostedStorageAad,
  decryptHostedStoragePayload,
  generateHostedUserRecipientKeyPair,
  parseHostedBrowserSessionKeyEnvelope,
  parseHostedCipherEnvelope,
  unwrapHostedBrowserSessionKey,
  type HostedBrowserSessionKeyEnvelope,
  type HostedCipherEnvelope,
} from "@murphai/runtime-state";
import {
  createBrowserVaultQueryClient,
  parseBrowserVaultReplica,
  type BrowserVaultQueryClient,
} from "@murphai/query/browser";
import {
  parseHostedBrowserVaultReplicaRef,
  type HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/browser-vault";

export type BrowserVaultStatus = "loading" | "ready" | "empty" | "error";

export interface BrowserVaultContextValue {
  client: BrowserVaultQueryClient | null;
  dataVersion: string | null;
  error: string | null;
  ref: HostedBrowserVaultReplicaRef | null;
  refresh(): Promise<void>;
  status: BrowserVaultStatus;
}

const BrowserVaultContext = createContext<BrowserVaultContextValue | null>(null);
const textDecoder = new TextDecoder();

export function BrowserVaultProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<BrowserVaultStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState<BrowserVaultQueryClient | null>(null);
  const [ref, setRef] = useState<HostedBrowserVaultReplicaRef | null>(null);

  const dataVersion = ref?.dataVersion ?? null;

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);

    try {
      const result = await loadBrowserVaultReplica(dataVersion);

      if (result.state === "not_modified") {
        setRef(result.replicaRef);
        setStatus(client ? "ready" : "empty");
        return;
      }

      if (result.state === "empty") {
        setClient(null);
        setRef(null);
        setStatus("empty");
        return;
      }

      setClient(result.client);
      setRef(result.replicaRef);
      setStatus("ready");
    } catch (loadError) {
      setStatus("error");
      setError(normalizeBrowserVaultError(loadError));
    }
  }, [client, dataVersion]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const result = await loadBrowserVaultReplica(null);

        if (cancelled) {
          return;
        }

        if (result.state === "empty") {
          setClient(null);
          setRef(null);
          setStatus("empty");
          setError(null);
          return;
        }

        if (result.state === "not_modified") {
          setStatus("empty");
          setError(null);
          setRef(result.replicaRef);
          return;
        }

        setClient(result.client);
        setRef(result.replicaRef);
        setStatus("ready");
        setError(null);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setStatus("error");
        setError(normalizeBrowserVaultError(loadError));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<BrowserVaultContextValue>(() => ({
    client,
    dataVersion,
    error,
    ref,
    refresh: load,
    status,
  }), [client, dataVersion, error, load, ref, status]);

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

type BrowserVaultSessionLoadResult =
  | { state: "empty" }
  | { replicaRef: HostedBrowserVaultReplicaRef; state: "not_modified" }
  | { client: BrowserVaultQueryClient; replicaRef: HostedBrowserVaultReplicaRef; state: "ready" };

async function loadBrowserVaultReplica(knownDataVersion: string | null): Promise<BrowserVaultSessionLoadResult> {
  const { privateKeyJwk, publicKeyJwk } = await generateHostedUserRecipientKeyPair();
  const response = await fetch("/api/browser-vault/session", {
    body: JSON.stringify({
      browserPublicKeyJwk: publicKeyJwk,
      knownDataVersion,
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

  if (session.state === "empty") {
    return { state: "empty" };
  }

  if (session.state === "not_modified") {
    return {
      replicaRef: session.replicaRef,
      state: "not_modified",
    };
  }

  const replicaKey = await unwrapHostedBrowserSessionKey({
    envelope: session.replicaKeyEnvelope,
    recipientPrivateKeyJwk: privateKeyJwk,
  });
  const plaintext = await decryptHostedStoragePayload({
    aad: buildHostedStorageAad({
      dataVersion: session.replicaAad.dataVersion,
      objectKey: session.replicaAad.objectKey,
      purpose: session.replicaAad.purpose,
      schema: session.replicaAad.schema,
      sourceBundleHash: session.replicaAad.sourceBundleHash,
      userId: session.replicaAad.userId,
    }),
    envelope: session.encryptedReplica,
    expectedKeyId: session.replicaRef.keyId,
    key: replicaKey,
    scope: "browser-vault-replica",
  });
  const replica = parseBrowserVaultReplica(
    JSON.parse(textDecoder.decode(plaintext)),
  );

  if (replica.source.dataVersion !== session.replicaRef.dataVersion) {
    throw new Error("Browser vault replica dataVersion did not match its session ref.");
  }

  return {
    client: createBrowserVaultQueryClient(replica),
    replicaRef: session.replicaRef,
    state: "ready",
  };
}

type BrowserVaultSessionResponse =
  | {
      encryptedReplica: null;
      replicaAad: null;
      replicaKeyEnvelope: null;
      replicaRef: null;
      state: "empty";
    }
  | {
      encryptedReplica: null;
      replicaAad: null;
      replicaKeyEnvelope: null;
      replicaRef: HostedBrowserVaultReplicaRef;
      state: "not_modified";
    }
  | {
      encryptedReplica: HostedCipherEnvelope;
      replicaAad: BrowserVaultReplicaAad;
      replicaKeyEnvelope: HostedBrowserSessionKeyEnvelope;
      replicaRef: HostedBrowserVaultReplicaRef;
      state: "ready";
    };

function parseBrowserVaultSessionResponse(value: unknown): BrowserVaultSessionResponse {
  const record = requireRecord(value, "Browser vault session response");
  const state = requireNonEmptyString(record.state, "Browser vault session response state");

  if (state === "empty") {
    return {
      encryptedReplica: null,
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: null,
      state,
    };
  }

  if (state === "not_modified") {
    return {
      encryptedReplica: null,
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: parseRequiredReplicaRef(record.replicaRef, "Browser vault session response replicaRef"),
      state,
    };
  }

  if (state !== "ready") {
    throw new TypeError("Browser vault session response state must be empty, not_modified, or ready.");
  }

  return {
    encryptedReplica: parseHostedCipherEnvelope(
      record.encryptedReplica,
      "Browser vault session response encryptedReplica",
    ),
    replicaAad: parseBrowserVaultReplicaAad(
      record.replicaAad,
      "Browser vault session response replicaAad",
    ),
    replicaKeyEnvelope: parseHostedBrowserSessionKeyEnvelope(
      record.replicaKeyEnvelope,
      "Browser vault session response replicaKeyEnvelope",
    ),
    replicaRef: parseRequiredReplicaRef(record.replicaRef, "Browser vault session response replicaRef"),
    state,
  };
}

interface BrowserVaultReplicaAad {
  dataVersion: string;
  objectKey: string;
  purpose: "browser-vault-replica";
  schema: "murph.browser-vault-replica.v1";
  sourceBundleHash: string;
  userId: string;
}

function parseBrowserVaultReplicaAad(value: unknown, label: string): BrowserVaultReplicaAad {
  const record = requireRecord(value, label);
  const purpose = requireNonEmptyString(record.purpose, `${label}.purpose`);
  const schema = requireNonEmptyString(record.schema, `${label}.schema`);

  if (purpose !== "browser-vault-replica") {
    throw new TypeError(`${label}.purpose must be browser-vault-replica.`);
  }
  if (schema !== "murph.browser-vault-replica.v1") {
    throw new TypeError(`${label}.schema must be murph.browser-vault-replica.v1.`);
  }

  return {
    dataVersion: requireNonEmptyString(record.dataVersion, `${label}.dataVersion`),
    objectKey: requireNonEmptyString(record.objectKey, `${label}.objectKey`),
    purpose,
    schema,
    sourceBundleHash: requireNonEmptyString(record.sourceBundleHash, `${label}.sourceBundleHash`),
    userId: requireNonEmptyString(record.userId, `${label}.userId`),
  };
}

function parseRequiredReplicaRef(value: unknown, label: string): HostedBrowserVaultReplicaRef {
  const ref = parseHostedBrowserVaultReplicaRef(value, label);

  if (!ref) {
    throw new TypeError(`${label} must not be null.`);
  }

  return ref;
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

function normalizeBrowserVaultError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";

  if (/HTTP 401|HTTP 403/u.test(message)) {
    return "Your dashboard session expired. Refresh and try again.";
  }

  if (/HTTP 404/u.test(message)) {
    return "Your dashboard data is not available yet.";
  }

  return "Your dashboard data is not available right now.";
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}
