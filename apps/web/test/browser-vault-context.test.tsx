import assert from "node:assert/strict";

import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  type BrowserVaultReplica,
} from "@murphai/query/browser";
import { act, useState } from "react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { afterEach, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  decryptHostedStoragePayload: vi.fn(),
  generateHostedUserRecipientKeyPair: vi.fn(),
  unwrapHostedBrowserSessionKey: vi.fn(),
}));

vi.mock("@murphai/runtime-state", async () => {
  const actual = await vi.importActual<typeof import("@murphai/runtime-state")>("@murphai/runtime-state");

  return {
    ...actual,
    buildHostedStorageAad: vi.fn((value: unknown) => value),
    decryptHostedStoragePayload: mocks.decryptHostedStoragePayload,
    generateHostedUserRecipientKeyPair: mocks.generateHostedUserRecipientKeyPair,
    unwrapHostedBrowserSessionKey: mocks.unwrapHostedBrowserSessionKey,
  };
});

import {
  BrowserVaultProvider,
  useBrowserVault,
  useBrowserVaultSelector,
} from "@/src/lib/browser-vault/context";
import { AuthProvider } from "@/src/components/hosted-onboarding/auth-dialog-provider";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mocks.decryptHostedStoragePayload.mockReset();
  mocks.generateHostedUserRecipientKeyPair.mockReset();
  mocks.unwrapHostedBrowserSessionKey.mockReset();
});

test("browser-vault provider rejects not_modified refs that do not match the known replica", async () => {
  const ref = createReplicaRef();
  const mismatchedRef = {
    ...ref,
    sourceBundleHash: "b".repeat(64),
  };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }))
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: null,
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: mismatchedRef,
      state: "not_modified",
    }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, "ready");
  await act(async () => {
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
  });
  await waitForText(rendered.container, "error");

  const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
  assert.deepEqual(secondRequest.knownReplicaRef, ref);
  assert.equal(rendered.container.textContent?.includes("Your dashboard data is not available right now."), true);

  await rendered.cleanup();
});

test("browser-vault provider skips the session route when auth context is anonymous", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createElement(BrowserVaultProvider, null, createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, "empty:none");

  assert.equal(fetchMock.mock.calls.length, 0);
  assert.equal(mocks.generateHostedUserRecipientKeyPair.mock.calls.length, 0);

  await rendered.cleanup();
});

test("browser-vault provider refresh skips the session route when auth context is anonymous", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createElement(BrowserVaultProvider, null, createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, "empty:none");

  await act(async () => {
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
  });

  await waitForText(rendered.container, "empty:none");
  assert.equal(fetchMock.mock.calls.length, 0);
  assert.equal(mocks.generateHostedUserRecipientKeyPair.mock.calls.length, 0);

  await rendered.cleanup();
});

test("browser-vault provider does not poll stale empty sessions without pending refresh", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
    encryptedReplica: null,
    freshness: "stale",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: null,
    refreshPending: false,
    state: "empty",
    workspaceVersion: null,
  }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, "empty:none");
  assert.equal(rendered.container.textContent?.includes("Preparing dashboard..."), false);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(25_000);
  });

  assert.equal(fetchMock.mock.calls.length, 1);

  await rendered.cleanup();
});

test("browser-vault provider exposes pending device imports without showing a global sync warning", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
    deviceSyncImportPending: true,
    encryptedReplica: null,
    freshness: "stale",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: null,
    refreshPending: false,
    state: "empty",
    workspaceVersion: null,
  }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultImportProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, "empty:importing");
  assert.equal(rendered.container.textContent?.includes("Importing wearable data..."), false);
  assert.equal(rendered.container.textContent?.includes("Preparing dashboard..."), false);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(25_000);
  });

  assert.equal(fetchMock.mock.calls.length, 1);

  await rendered.cleanup();
});

test("browser-vault provider hides ready data immediately when auth context becomes anonymous", async () => {
  const ref = createReplicaRef();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  function AuthTransitionHarness() {
    const [authenticated, setAuthenticated] = useState(true);

    return createElement(
      AuthProvider,
      { authenticated },
      createElement(
        BrowserVaultProvider,
        null,
        createElement(BrowserVaultStatusProbe, {
          onClick: () => setAuthenticated(false),
        }),
      ),
    );
  }

  const rendered = await renderClientComponent(
    createElement(AuthTransitionHarness),
    { requireButton: false },
  );

  await waitForText(rendered.container, `ready:${ref.dataVersion}`);

  await act(async () => {
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
  });

  assert.equal(rendered.container.textContent, "empty:none");
  assert.equal(fetchMock.mock.calls.length, 1);

  await rendered.cleanup();
});

test("browser-vault provider reuses an in-flight load for repeated refreshes", async () => {
  const response = createDeferred<Response>();
  const fetchMock = vi.fn(() => response.promise);

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForCondition(() => fetchMock.mock.calls.length === 1, "initial browser-vault fetch");

  await act(async () => {
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
  });

  assert.equal(fetchMock.mock.calls.length, 1);

  response.resolve(jsonResponse({
    encryptedReplica: createReplicaEnvelope(),
    replicaAad: createReplicaAad(),
    replicaKeyEnvelope: createReplicaKeyEnvelope(),
    replicaRef: createReplicaRef(),
    state: "ready",
  }));

  await waitForText(rendered.container, "ready");
  assert.equal(fetchMock.mock.calls.length, 1);

  await rendered.cleanup();
});

test("browser-vault selector returns projected data only after the client is ready", async () => {
  const response = createDeferred<Response>();
  const fetchMock = vi.fn(() => response.promise);
  const dataVersion = createReplicaRef().dataVersion;

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultSelectorProbe)),
    { requireButton: false },
  );

  assert.equal(rendered.container.textContent, "loading:none");

  response.resolve(jsonResponse({
    encryptedReplica: createReplicaEnvelope(),
    replicaAad: createReplicaAad(),
    replicaKeyEnvelope: createReplicaKeyEnvelope(),
    replicaRef: createReplicaRef(),
    state: "ready",
  }));

  await waitForText(rendered.container, `ready:${dataVersion}`);

  await rendered.cleanup();
});

test("browser-vault provider aborts in-flight loads on unmount", async () => {
  const response = createDeferred<Response>();
  const requestSignals: AbortSignal[] = [];
  const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal) {
      requestSignals.push(init.signal);
    }
    return response.promise;
  });

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForCondition(() => fetchMock.mock.calls.length === 1, "initial browser-vault fetch");

  await rendered.cleanup();

  const requestSignal = requestSignals.at(0);
  assert.ok(requestSignal);
  assert.equal(requestSignal.aborted, true);

  response.resolve(jsonResponse({
    encryptedReplica: createReplicaEnvelope(),
    replicaAad: createReplicaAad(),
    replicaKeyEnvelope: createReplicaKeyEnvelope(),
    replicaRef: createReplicaRef(),
    state: "ready",
  }));

  await act(async () => {
    await response.promise;
  });
});

function createAuthenticatedBrowserVaultElement(child: ReactNode) {
  return createElement(
    AuthProvider,
    { authenticated: true },
    createElement(BrowserVaultProvider, null, child),
  );
}

function BrowserVaultStatusProbe({ onClick }: { onClick?: () => void }) {
  const vault = useBrowserVault();

  return createElement(
    "button",
    { onClick: onClick ?? (() => void vault.refresh()) },
    `${vault.status}:${vault.error ?? vault.dataVersion ?? "none"}`,
  );
}

function BrowserVaultSelectorProbe() {
  const vault = useBrowserVault();
  const dataVersion = useBrowserVaultSelector((client) => client.replica.source.dataVersion);

  return createElement(
    "button",
    { onClick: () => void vault.refresh() },
    `${vault.status}:${dataVersion ?? "none"}`,
  );
}

function BrowserVaultImportProbe() {
  const vault = useBrowserVault();

  return createElement(
    "button",
    { onClick: () => void vault.refresh() },
    `${vault.status}:${vault.deviceSyncImportPending ? "importing" : "idle"}`,
  );
}

function installBrowserVaultCryptoMocks(): void {
  mocks.generateHostedUserRecipientKeyPair.mockResolvedValue({
    privateKeyJwk: { kty: "EC" },
    publicKeyJwk: { kty: "EC" },
  });
  mocks.unwrapHostedBrowserSessionKey.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mocks.decryptHostedStoragePayload.mockResolvedValue(
    new TextEncoder().encode(JSON.stringify(createReplica())),
  );
}

async function waitForText(container: HTMLElement, text: string): Promise<void> {
  await waitForCondition(
    () => Boolean(container.textContent?.includes(text)),
    `text: ${text}`,
  );
}

async function waitForCondition(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await act(async () => {
      await Promise.resolve();
    });

    if (condition()) {
      return;
    }
  }

  throw new Error(`Timed out waiting for ${label}`);
}

function jsonResponse(value: unknown): Response {
  return {
    json: async () => value,
    ok: true,
    status: 200,
  } as Response;
}

function createDeferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function createReplicaRef() {
  return {
    byteLength: 128,
    dataVersion: "d".repeat(64),
    generatedAt: "2026-04-20T08:00:00.000Z",
    keyId: "browser-vault-replica:d",
    objectKey: "users/browser-vault-replicas/opaque/replica.json",
    replicaSchema: "murph.browser-vault-replica" as const,
    runtimeRootKeyId: "udrk:runtime:test-root",
    schema: "murph.hosted-browser-vault-replica-ref.v1" as const,
    sourceBundleHash: "a".repeat(64),
  };
}

function createReplicaAad() {
  return {
    dataVersion: "d".repeat(64),
    objectKey: "users/browser-vault-replicas/opaque/replica.json",
    purpose: "browser-vault-replica" as const,
    runtimeRootKeyId: "udrk:runtime:test-root",
    schema: "murph.browser-vault-replica" as const,
    sourceBundleHash: "a".repeat(64),
    userId: "member_123",
  };
}

function createReplicaEnvelope() {
  return {
    algorithm: "AES-GCM" as const,
    ciphertext: "ciphertext",
    iv: "iv",
    keyId: "browser-vault-replica:d",
    schema: "murph.hosted-cipher.v1",
    scope: "browser-vault-replica" as const,
  };
}

function createReplicaKeyEnvelope() {
  return {
    createdAt: "2026-04-20T08:00:00.000Z",
    keyId: "browser-vault-replica:d",
    purpose: "browser-vault-replica" as const,
    recipients: [
      {
        ciphertext: "ciphertext",
        ephemeralPublicKeyJwk: {
          crv: "P-256",
          kty: "EC",
          x: "ephemeral-x",
          y: "ephemeral-y",
        },
        iv: "iv",
        keyId: "browser-vault-replica:d",
        kind: "browser-session" as const,
      },
    ],
    schema: "murph.hosted-browser-session-key-envelope.v1" as const,
    userId: "member_123",
  };
}

function createReplica(overrides: Partial<BrowserVaultReplica> = {}): BrowserVaultReplica {
  return {
    assistantSummary: {
      highlights: [],
      latestDate: null,
    },
    entities: [],
    generatedAt: "2026-04-30T12:00:00.000Z",
    metricGoalProgressRows: [],
    metricRows: [],
    metricSelectionRows: [],
    policy: {
      bodyPreviewChars: 280,
      excludedFamilies: [],
      id: BROWSER_VAULT_REPLICA_POLICY_ID,
      includedFamilies: [],
      metricLookbackDays: 365,
    },
    schema: BROWSER_VAULT_REPLICA_SCHEMA,
    searchRows: [],
    source: {
      dataVersion: "d".repeat(64),
      sourceBundleHash: "a".repeat(64),
    },
    sourceHealthRows: [],
    timelineRows: [],
    weeklySampleSummaries: [],
    ...overrides,
  };
}
