import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { generateHostedUserRecipientKeyPair } from "@murphai/runtime-state";

import { createJsonPostRequest } from "./route-test-helpers";

const mocks = vi.hoisted(() => ({
  readHostedExecutionControlClientIfConfigured: vi.fn(),
  readHostedWorkspace: vi.fn(),
  requireActivePrivyMemberAuth: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured:
    mocks.readHostedExecutionControlClientIfConfigured,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireActivePrivyMemberAuth: mocks.requireActivePrivyMemberAuth,
}));

vi.mock("@/src/lib/hosted-workspace/store", () => ({
  readHostedWorkspace: mocks.readHostedWorkspace,
}));

type BrowserVaultSessionRouteModule = typeof import("../app/api/browser-vault/session/route");

let browserVaultSessionRoute: BrowserVaultSessionRouteModule;

describe("browser vault session route", () => {
  beforeAll(async () => {
    browserVaultSessionRoute = await import("../app/api/browser-vault/session/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActivePrivyMemberAuth.mockResolvedValue({
      member: {
        id: "member_123",
      },
    });
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: null,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: null,
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
  });

  it("returns an empty session when the workspace does not publish a replica ref", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const createBrowserVaultSession = vi.fn();
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({ createBrowserVaultSession });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireActivePrivyMemberAuth).toHaveBeenCalledTimes(1);
    expect(createBrowserVaultSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      encryptedReplica: null,
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: null,
      state: "empty",
    });
  });

  it("forwards the authenticated member, known version, and replica ref to the hosted control client", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: createReplicaRef(),
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: {
        hash: "a".repeat(64),
        kind: "prepared",
        keyId: "bundle-key",
        schema: "murph.hosted-execution-bundle-ref.v1",
      },
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    const createBrowserVaultSession = vi.fn().mockResolvedValue({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: createReplicaRef(),
      state: "ready",
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({ createBrowserVaultSession });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        knownDataVersion: "stale-version",
      }),
    );

    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).toHaveBeenCalledWith({
      browserPublicKeyJwk: browser.publicKeyJwk,
      replicaRef: createReplicaRef(),
      userId: "member_123",
    });
  });

  it("returns not_modified when the browser already has the current replica", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createReplicaRef();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: {
        hash: "a".repeat(64),
        kind: "prepared",
        keyId: "bundle-key",
        schema: "murph.hosted-execution-bundle-ref.v1",
      },
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    const createBrowserVaultSession = vi.fn();
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({ createBrowserVaultSession });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        knownDataVersion: replicaRef.dataVersion,
      }),
    );

    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      encryptedReplica: null,
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef,
      state: "not_modified",
    });
  });

  it("returns empty when the workspace snapshot ref no longer matches the replica source bundle hash", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const createBrowserVaultSession = vi.fn();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: createReplicaRef(),
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: {
        hash: "b".repeat(64),
        kind: "prepared",
        keyId: "bundle-key",
        schema: "murph.hosted-execution-bundle-ref.v1",
      },
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({ createBrowserVaultSession });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      encryptedReplica: null,
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: null,
      state: "empty",
    });
  });

  it("prefers the workspace snapshot mismatch guard over not_modified reuse", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createReplicaRef();
    const createBrowserVaultSession = vi.fn();
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({ createBrowserVaultSession });
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: {
        hash: "b".repeat(64),
        kind: "prepared",
        keyId: "bundle-key",
        schema: "murph.hosted-execution-bundle-ref.v1",
      },
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        knownDataVersion: replicaRef.dataVersion,
      }),
    );

    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      encryptedReplica: null,
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: null,
      state: "empty",
    });
  });

  it("returns a 503 when hosted execution control is not configured", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: createReplicaRef(),
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: {
        hash: "a".repeat(64),
        kind: "prepared",
        keyId: "bundle-key",
        schema: "murph.hosted-execution-bundle-ref.v1",
      },
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue(null);

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_EXECUTION_CONTROL_NOT_CONFIGURED",
        message: "Hosted execution control plane is not configured.",
        retryable: false,
      },
    });
  });

  it("returns a 502 when hosted execution control returns an invalid browser vault session", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: createReplicaRef(),
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: {
        hash: "a".repeat(64),
        kind: "prepared",
        keyId: "bundle-key",
        schema: "murph.hosted-execution-bundle-ref.v1",
      },
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    const createBrowserVaultSession = vi.fn().mockRejectedValue(
      new TypeError("Cloudflare browser vault session state must be ready."),
    );

    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultSession,
    });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_EXECUTION_CONTROL_INVALID_RESPONSE",
        message: "Hosted execution control plane returned an invalid browser vault session.",
        retryable: false,
      },
    });
  });

  it("returns empty when hosted execution control cannot find the referenced replica", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: createReplicaRef(),
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: {
        hash: "a".repeat(64),
        kind: "prepared",
        keyId: "bundle-key",
        schema: "murph.hosted-execution-bundle-ref.v1",
      },
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    const createBrowserVaultSession = vi.fn().mockRejectedValue(
      new Error("Hosted execution browser vault replica was not found."),
    );
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultSession,
    });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      encryptedReplica: null,
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: null,
      state: "empty",
    });
  });
});

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
