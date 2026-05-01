import assert from "node:assert/strict";

import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  type BrowserVaultReplica,
} from "@murphai/query/browser";
import { act } from "react";
import { createElement } from "react";
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

import { BrowserVaultProvider, useBrowserVault } from "@/src/lib/browser-vault/context";

afterEach(() => {
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
    createElement(BrowserVaultProvider, null, createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, "ready");
  await act(async () => {
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
  });
  await waitForText(rendered.container, "error");

  const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
  assert.equal(secondRequest.knownDataVersion, ref.dataVersion);
  assert.equal(rendered.container.textContent?.includes("Your dashboard data is not available right now."), true);

  await rendered.cleanup();
});

function BrowserVaultStatusProbe() {
  const vault = useBrowserVault();

  return createElement(
    "button",
    { onClick: () => void vault.refresh() },
    `${vault.status}:${vault.error ?? vault.dataVersion ?? "none"}`,
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
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await act(async () => {
      await Promise.resolve();
    });

    if (container.textContent?.includes(text)) {
      return;
    }
  }

  throw new Error(`Timed out waiting for text: ${text}`);
}

function jsonResponse(value: unknown): Response {
  return {
    json: async () => value,
    ok: true,
    status: 200,
  } as Response;
}

function createReplicaRef() {
  return {
    byteLength: 128,
    dataVersion: "d".repeat(64),
    generatedAt: "2026-04-20T08:00:00.000Z",
    keyId: "browser-vault-replica:d",
    objectKey: "users/browser-vault-replicas/opaque/replica.json",
    replicaSchema: "murph.browser-vault-replica.v1" as const,
    schema: "murph.hosted-browser-vault-replica-ref.v1" as const,
    sourceBundleHash: "a".repeat(64),
  };
}

function createReplicaAad() {
  return {
    dataVersion: "d".repeat(64),
    objectKey: "users/browser-vault-replicas/opaque/replica.json",
    purpose: "browser-vault-replica" as const,
    schema: "murph.browser-vault-replica.v1" as const,
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
    metricDayRows: [],
    metricRows: [],
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
