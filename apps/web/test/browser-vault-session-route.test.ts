import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CloudflareHostedControlBrowserVaultReplicaNotFoundError,
  CloudflareHostedControlMalformedResponseError,
} from "@murphai/cloudflare-hosted-control/client";
import { BROWSER_VAULT_REPLICA_CURRENT_GENERATION } from "@murphai/contracts";
import { generateHostedUserRecipientKeyPair } from "@murphai/runtime-state";
import {
  HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
  HOSTED_EXECUTION_WORKING_SNAPSHOT_REF_SCHEMA,
} from "@murphai/hosted-execution/bundles";
import type {
  HostedBrowserVaultReplicaMetricBucketSetRef,
} from "@murphai/hosted-execution/browser-vault";

import { loadBrowserVaultExport } from "../src/lib/browser-vault/export";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import { createJsonPostRequest } from "./route-test-helpers";

vi.mock("server-only", () => ({}));

const TEST_BROWSER_VAULT_METRIC_BUCKET_IDS = Array.from(
  { length: 32 },
  (_, index) => index.toString(16).padStart(2, "0"),
);

const mocks = vi.hoisted(() => ({
  prepareProgressShareExport: vi.fn(),
  openHealthTexts: vi.fn(),
  assertHostedAppSessionCurrentTx: vi.fn(),
  assertBrowserVaultMemberAuthority: vi.fn(),
  afterResponse: vi.fn((callback: () => void | Promise<void>) => {
    void callback();
  }),
  assertHostedConsentScopeGranted: vi.fn(),
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  hasPendingDirtyConnectionForUser: vi.fn(),
  prismaClient: {
    label: "test-prisma",
  },
  readHostedExecutionControlClientIfConfigured: vi.fn(),
  readHostedHealthDataConsentState: vi.fn(),
  readHostedWorkspace: vi.fn(),
  requireActivePrivyMemberAuth: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  signalHostedBrowserVaultRefreshRuntime: vi.fn(),
  verifyAndConsumeSensitiveActionChallenge: vi.fn(),
  verifySensitiveActionChallenge: vi.fn(),
  consumeSensitiveActionChallenge: vi.fn(),
  readHostedWorkspaceBrowserVaultSourceStateHash: vi.fn<(snapshotRef: unknown) => string | null>(() => null),
}));

vi.mock("@/src/lib/health-wins/crypto", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/health-wins/crypto")>(),
  openHealthTexts: mocks.openHealthTexts,
}));

vi.mock("@/src/lib/game/progress/share-export", () => ({ prepareProgressShareExport: mocks.prepareProgressShareExport }));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: mocks.afterResponse,
  };
});

vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured:
    mocks.readHostedExecutionControlClientIfConfigured,
}));

vi.mock("@/src/lib/browser-vault/authority", () => ({
  assertBrowserVaultMemberAuthority:
    mocks.assertBrowserVaultMemberAuthority,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedBrowserVaultRefreshRuntime:
    mocks.signalHostedBrowserVaultRefreshRuntime,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  assertHostedAppSessionCurrentTx: mocks.assertHostedAppSessionCurrentTx,
  requireActiveHostedAppSessionFromRequest: mocks.requireActivePrivyMemberAuth,
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedConsentScopeGranted: mocks.assertHostedConsentScopeGranted,
  assertHostedLaunchRequiredConsentGranted: mocks.assertHostedLaunchRequiredConsentGranted,
  readHostedHealthDataConsentState: mocks.readHostedHealthDataConsentState,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-workspace/store", () => ({
  readHostedWorkspace: mocks.readHostedWorkspace,
  readHostedBrowserVaultReplicaState: mocks.readHostedWorkspace,
  readHostedWorkspaceBrowserVaultSourceStateHash:
    mocks.readHostedWorkspaceBrowserVaultSourceStateHash,
}));

vi.mock("@/src/lib/sensitive-actions/server", () => ({
  buildSettingsSensitiveActionBinding: vi.fn(() => "a".repeat(64)),
  verifyAndConsumeSensitiveActionChallenge: mocks.verifyAndConsumeSensitiveActionChallenge,
  verifySensitiveActionChallenge: mocks.verifySensitiveActionChallenge,
  consumeSensitiveActionChallenge: mocks.consumeSensitiveActionChallenge,
}));

vi.mock("@/src/lib/device-sync/prisma-store/dirty-connections", () => ({
  PrismaHostedDirtyConnectionStore: class PrismaHostedDirtyConnectionStore {
    async hasPendingDirtyConnectionForUser(userId: string): Promise<boolean> {
      return Boolean(await mocks.hasPendingDirtyConnectionForUser(userId));
    }
  },
}));

type BrowserVaultSessionRouteModule = typeof import("../app/api/browser-vault/session/route");
type SettingsVaultExportSessionRouteModule = typeof import("../app/api/settings/vault-export/session/route");

let browserVaultSessionRoute: BrowserVaultSessionRouteModule;
let settingsVaultExportSessionRoute: SettingsVaultExportSessionRouteModule;

describe("browser vault session route", () => {
  beforeAll(async () => {
    browserVaultSessionRoute = await import("../app/api/browser-vault/session/route");
    settingsVaultExportSessionRoute = await import("../app/api/settings/vault-export/session/route");
  });

  afterEach(async () => {
    await vi.dynamicImportSettled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prepareProgressShareExport.mockResolvedValue(async function* () {});
    mocks.signalHostedBrowserVaultRefreshRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });
    mocks.afterResponse.mockImplementation((callback: () => void | Promise<void>) => {
      void callback();
    });
    mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.hasPendingDirtyConnectionForUser.mockResolvedValue(false);
    mocks.assertHostedLaunchRequiredConsentGranted.mockResolvedValue(undefined);
    mocks.readHostedHealthDataConsentState.mockResolvedValue("granted");
    mocks.assertBrowserVaultMemberAuthority.mockResolvedValue(undefined);
    mocks.requireActivePrivyMemberAuth.mockResolvedValue({
      member: {
        id: "member_123",
      },
    });
    mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
      member: {
        id: "member_123",
      },

      sessionId: "session_123",
    });
    mocks.verifyAndConsumeSensitiveActionChallenge.mockResolvedValue(undefined);
    mocks.verifySensitiveActionChallenge.mockResolvedValue({
      bindingHash: "a".repeat(64),
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      kind: "vault.export",
      memberId: "member_123",
      tokenHash: "b".repeat(64),
    });
    mocks.consumeSensitiveActionChallenge.mockResolvedValue(undefined);
    mocks.readHostedWorkspaceBrowserVaultSourceStateHash.mockReturnValue(null);
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

  it.each(["browserPublicKeyJwk", "knownReplicaRef"])("rejects malformed request %s before reading stored data", async (field) => {
    const browser = await generateHostedUserRecipientKeyPair();
    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        [field]: {},
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: { code: "INVALID_REQUEST", message: "Invalid request." },
    });
    expect(mocks.readHostedWorkspace).not.toHaveBeenCalled();
  });

  it("reports a malformed stored replica ref as a server failure", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    mocks.readHostedWorkspace.mockResolvedValue({ browserVaultReplicaRef: {} });
    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal error." },
    });
    expect(mocks.readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
  });

  it("returns an empty session when the workspace does not publish a replica ref", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const createBrowserVaultSession = vi.fn();
    const scheduleBrowserVaultRefresh = vi.fn();
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultSession,
      scheduleBrowserVaultRefresh,
    });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.assertBrowserVaultMemberAuthority).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
    });
    expect(mocks.hasPendingDirtyConnectionForUser).toHaveBeenCalledWith("member_123");
    expect(createBrowserVaultSession).not.toHaveBeenCalled();
    expect(scheduleBrowserVaultRefresh).not.toHaveBeenCalled();
    await vi.dynamicImportSettled();
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).toHaveBeenCalledWith({
      userId: "member_123",
    });
    await expect(response.json()).resolves.toMatchObject({
      deviceSyncImportPending: false,
      encryptedReplica: null,
      memberId: "member_123",
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: null,
      refreshPending: true,
      state: "empty",
    });
  });

  it("does not schedule runtime work for an observation-only missing replica poll", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const createBrowserVaultSession = vi.fn();
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultSession,
    });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        refreshObservationOnly: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).not.toHaveBeenCalled();
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      encryptedReplica: null,
      freshness: "stale",
      refreshPending: true,
      state: "empty",
    });
  });

  it("does not resignal runtime work when an observation-only poll cannot find the referenced replica", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createReplicaRef();
    const knownReplicaRef = createReplicaRef({
      generatedAt: "2998-04-20T08:00:00.000Z",
    });
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("a"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    const createBrowserVaultSession = vi.fn().mockRejectedValue(
      new CloudflareHostedControlBrowserVaultReplicaNotFoundError(),
    );
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultSession,
    });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        knownReplicaRef,
        refreshObservationOnly: true,
      }),
    );

    expect(response.status).toBe(503);
    expect(createBrowserVaultSession).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "BROWSER_VAULT_PARTIAL_LOAD_UNAVAILABLE",
        message: "Requested browser vault data is temporarily unavailable.",
        retryable: true,
      },
    });
  });

  it("rejects an all-bucket interactive request reserved for export", async () => {
    const browser = await generateHostedUserRecipientKeyPair();

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        requestedMetricBuckets: TEST_BROWSER_VAULT_METRIC_BUCKET_IDS,
        requestedShards: ["core", "metricsIndex"],
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "BROWSER_VAULT_SESSION_INVALID_REQUEST",
        message: "Interactive Browser Vault requests cannot load every metric bucket.",
      },
    });
    expect(mocks.readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
  });

  it("lets a pending device import create the first browser vault replica", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const createBrowserVaultSession = vi.fn();
    mocks.hasPendingDirtyConnectionForUser.mockResolvedValue(true);
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({ createBrowserVaultSession });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).not.toHaveBeenCalled();
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      deviceSyncImportPending: true,
      refreshPending: true,
      state: "empty",
    });
  });

  it("does not fail browser vault sessions when pending device import metadata is unavailable", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const createBrowserVaultSession = vi.fn();
    mocks.hasPendingDirtyConnectionForUser.mockRejectedValue(new Error("dirty state unavailable"));
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({ createBrowserVaultSession });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      deviceSyncImportPending: false,
      refreshPending: true,
      state: "empty",
    });
  });

  it("verifies and only then consumes the one-time challenge after the encrypted replica is in hand", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createReplicaRef();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("a"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    mocks.readHostedWorkspaceBrowserVaultSourceStateHash.mockReturnValue(replicaRef.sourceBundleHash);
    const createBrowserVaultExportSession = vi.fn().mockResolvedValue({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef,
      state: "ready",
    });
    const createBrowserVaultSession = vi.fn();
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultExportSession,
      createBrowserVaultSession,
    });

    const response = await settingsVaultExportSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/settings/vault-export/session", {
        authorization: {
          signature: `0x${"11".repeat(65)}`,
          token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
        },
        browserPublicKeyJwk: browser.publicKeyJwk,
        requestedMetricBuckets: TEST_BROWSER_VAULT_METRIC_BUCKET_IDS,
        requestedShards: ["core", "labs", "metricsIndex"],
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.requireActivePrivyMemberAuth).not.toHaveBeenCalled();
    expect(mocks.assertHostedLaunchRequiredConsentGranted).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
    });
    expect(mocks.verifySensitiveActionChallenge).toHaveBeenCalledWith({
      authorization: {
        signature: `0x${"11".repeat(65)}`,
        token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
      },
      bindingHash: "a".repeat(64),
      kind: "vault.export",
      memberId: "member_123",
      prisma: mocks.prismaClient,

    });
    expect(createBrowserVaultExportSession).toHaveBeenCalledTimes(1);
    expect(createBrowserVaultSession).not.toHaveBeenCalled();
    expect(mocks.consumeSensitiveActionChallenge).toHaveBeenCalledTimes(1);
    // Consume must happen after the encrypted replica is fetched, so a fetch
    // failure aborts the response without releasing the one-time challenge.
    expect(
      mocks.consumeSensitiveActionChallenge.mock.invocationCallOrder[0],
    ).toBeGreaterThan(
      createBrowserVaultExportSession.mock.invocationCallOrder[0],
    );
  });

  it.each(["missing", "revoked"])("exports retained data without processing when health consent is %s", async (consent) => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createReplicaRef();
    mocks.readHostedHealthDataConsentState.mockResolvedValue(consent);
    mocks.hasPendingDirtyConnectionForUser.mockResolvedValueOnce(true);
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("b"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "2",
    });
    mocks.readHostedWorkspaceBrowserVaultSourceStateHash.mockReturnValue("c".repeat(64));
    const createBrowserVaultExportSession = vi.fn().mockResolvedValue({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef,
      state: "ready",
    });
    const createBrowserVaultSession = vi.fn();
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultExportSession,
      createBrowserVaultSession,
    });

    const response = await settingsVaultExportSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/settings/vault-export/session", {
        authorization: {
          signature: `0x${"11".repeat(65)}`,
          token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
        },
        browserPublicKeyJwk: browser.publicKeyJwk,
        requestedMetricBuckets: TEST_BROWSER_VAULT_METRIC_BUCKET_IDS,
        requestedShards: ["core", "labs", "metricsIndex"],
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();
    if (consent === "missing") {
      expect(mocks.assertHostedConsentScopeGranted).toHaveBeenCalledWith(expect.objectContaining({ scope: "launch.legal" }));
    }
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).not.toHaveBeenCalled();
    expect(createBrowserVaultExportSession).toHaveBeenCalledWith({
      browserPublicKeyJwk: browser.publicKeyJwk,
      replicaRef,
      userId: "member_123",
    });
    expect(createBrowserVaultSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      deviceSyncImportPending: true,
      freshness: "stale",
      refreshPending: true,
      state: "ready",
    });
  });

  it.each([
    {
      requestedShards: ["core", "labs", "metricsIndex"],
    },
    {
      requestedMetricBuckets: TEST_BROWSER_VAULT_METRIC_BUCKET_IDS,
    },
    {
      requestedMetricBuckets: TEST_BROWSER_VAULT_METRIC_BUCKET_IDS.slice(1),
      requestedShards: ["core", "labs", "metricsIndex"],
    },
    {
      requestedMetricBuckets: TEST_BROWSER_VAULT_METRIC_BUCKET_IDS,
      requestedShards: ["core", "metricsIndex"],
    },
  ])("rejects partial Settings export capability %#", async (capability) => {
    const browser = await generateHostedUserRecipientKeyPair();

    const response = await settingsVaultExportSessionRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/settings/vault-export/session",
        {
          authorization: {
            signature: `0x${"11".repeat(65)}`,
            token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
          },
          browserPublicKeyJwk: browser.publicKeyJwk,
          ...capability,
        },
      ),
    );

    expect(response.status).toBe(400);
    expect(mocks.verifySensitiveActionChallenge).not.toHaveBeenCalled();
    expect(mocks.readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "BROWSER_VAULT_SESSION_INVALID_REQUEST" },
    });
  });

  it.each(["missing", "revoked"])("does not wake processing when consent becomes %s during export authorization", async (consent) => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createReplicaRef();
    mocks.readHostedHealthDataConsentState
      .mockResolvedValueOnce("granted")
      .mockResolvedValueOnce(consent);
    mocks.hasPendingDirtyConnectionForUser.mockResolvedValueOnce(true);
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      createdAt: "2026-04-20T08:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatusJson: {},
      snapshotRef: createSnapshotRef("c"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "3",
    });
    mocks.readHostedWorkspaceBrowserVaultSourceStateHash.mockReturnValue("d".repeat(64));
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultSession: vi.fn().mockResolvedValue({
        encryptedReplica: createReplicaEnvelope(),
        replicaAad: createReplicaAad(),
        replicaKeyEnvelope: createReplicaKeyEnvelope(),
        replicaRef,
        state: "ready",
      }),
    });

    const response = await settingsVaultExportSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/settings/vault-export/session", {
        authorization: {
          signature: `0x${"11".repeat(65)}`,
          token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
        },
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.readHostedHealthDataConsentState).toHaveBeenCalledTimes(2);
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      deviceSyncImportPending: true,
      freshness: "stale",
      refreshPending: true,
      state: "ready",
    });
  });

  it("does not wake processing when consent is withdrawn before the deferred refresh runs", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createReplicaRef();
    let runAfterResponse: (() => void | Promise<void>) | undefined;
    mocks.afterResponse.mockImplementationOnce((callback: () => void | Promise<void>) => {
      runAfterResponse = callback;
    });
    mocks.hasPendingDirtyConnectionForUser.mockResolvedValueOnce(true);
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      createdAt: "2026-04-20T08:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatusJson: {},
      snapshotRef: createSnapshotRef("d"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "4",
    });
    mocks.readHostedWorkspaceBrowserVaultSourceStateHash.mockReturnValue("e".repeat(64));
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultSession: vi.fn().mockResolvedValue({
        encryptedReplica: createReplicaEnvelope(),
        replicaAad: createReplicaAad(),
        replicaKeyEnvelope: createReplicaKeyEnvelope(),
        replicaRef,
        state: "ready",
      }),
    });

    const response = await settingsVaultExportSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/settings/vault-export/session", {
        authorization: {
          signature: `0x${"11".repeat(65)}`,
          token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
        },
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(response.status).toBe(200);
    expect(runAfterResponse).toBeTypeOf("function");
    mocks.readHostedHealthDataConsentState.mockResolvedValue("revoked");
    await runAfterResponse?.();
    expect(mocks.readHostedHealthDataConsentState).toHaveBeenCalledTimes(3);
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).not.toHaveBeenCalled();
  });

  it("does not wake processing when consent is withdrawn while the retained replica is fetched", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createReplicaRef();
    const readySession = {
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef,
      state: "ready" as const,
    };
    let resolveBrowserVaultSession: ((session: typeof readySession) => void) | undefined;
    const browserVaultSession = new Promise<typeof readySession>((resolve) => {
      resolveBrowserVaultSession = resolve;
    });
    const createBrowserVaultSession = vi.fn(() => browserVaultSession);
    mocks.hasPendingDirtyConnectionForUser.mockResolvedValueOnce(true);
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      createdAt: "2026-04-20T08:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatusJson: {},
      snapshotRef: createSnapshotRef("e"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "5",
    });
    mocks.readHostedWorkspaceBrowserVaultSourceStateHash.mockReturnValue("f".repeat(64));
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultSession,
    });

    const responsePromise = settingsVaultExportSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/settings/vault-export/session", {
        authorization: {
          signature: `0x${"11".repeat(65)}`,
          token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
        },
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );
    await vi.waitFor(() => {
      expect(createBrowserVaultSession).toHaveBeenCalledTimes(1);
    });
    mocks.readHostedHealthDataConsentState.mockResolvedValue("revoked");
    resolveBrowserVaultSession?.(readySession);

    const response = await responsePromise;
    expect(response.status).toBe(200);
    await vi.waitFor(() => {
      expect(mocks.readHostedHealthDataConsentState).toHaveBeenCalledTimes(3);
    });
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).not.toHaveBeenCalled();
  });

  it.each(["granted", "revoked"])(
    "reports workspace read failures as server errors with %s consent",
    async (consent) => {
      const browser = await generateHostedUserRecipientKeyPair();
      mocks.readHostedHealthDataConsentState.mockResolvedValue(consent);
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        for (const failure of [new Error("Database unavailable"), new TypeError("Decrypt failed")]) {
          mocks.readHostedWorkspace.mockRejectedValueOnce(failure);
          const response = await settingsVaultExportSessionRoute.POST(
            createJsonPostRequest("https://join.example.test/api/settings/vault-export/session", {
              authorization: {
                signature: `0x${"11".repeat(65)}`,
                token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
              },
              browserPublicKeyJwk: browser.publicKeyJwk,
            }),
          );
          expect(response.status).toBe(500);
          await expect(response.json()).resolves.toMatchObject({ error: { code: "INTERNAL_ERROR" } });
        }
        expect(errorLog).toHaveBeenCalledTimes(2);
        expect(mocks.consumeSensitiveActionChallenge).not.toHaveBeenCalled();
        expect(mocks.signalHostedBrowserVaultRefreshRuntime).not.toHaveBeenCalled();
      } finally {
        errorLog.mockRestore();
      }
    },
  );

  it("refuses Settings vault export sessions without consuming the challenge when the replica is missing", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const createBrowserVaultSession = vi.fn();
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({ createBrowserVaultSession });

    const response = await settingsVaultExportSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/settings/vault-export/session", {
        authorization: {
          signature: `0x${"11".repeat(65)}`,
          token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
        },
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.verifySensitiveActionChallenge).toHaveBeenCalledTimes(1);
    expect(mocks.consumeSensitiveActionChallenge).not.toHaveBeenCalled();
    expect(createBrowserVaultSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "BROWSER_VAULT_SESSION_NOT_FRESH",
        retryable: true,
      },
    });
  });

  it("downloads saved summaries through Settings after withdrawal without a retained replica", async () => {
    const createdAt = new Date("2030-09-12T16:04:00.000Z");
    const memberId = "synthetic-recording-owner";
    const rows = Array.from({ length: 71 }, (_, index) => {
      const id = `b41bb55e-c1e5-411a-ba8a-${String(index).padStart(12, "0")}`;
      return { id, memberId, day: "2030-09-12", createdAt, postId: null, summaryEncrypted: `sealed-${id}` };
    });
    const summary = (id: string) => ({ id, kind: "other", startedAt: "2030-09-12T15:08:00.000Z", elapsedSec: 711, movingSec: 710 });
    const findMany = vi.fn().mockImplementation(({ take, where }) => {
      const cursorId = where.OR?.[1].id.gt;
      return rows.filter(row => !cursorId || row.id > cursorId).slice(0, take);
    });
    mocks.requireHostedAppSessionFromRequest.mockResolvedValue({ member: { id: memberId }, sessionId: "export-session" });
    mocks.getPrisma.mockReturnValue({
      healthActivity: { findMany },
      healthProfilePin: { findMany: vi.fn().mockResolvedValue([{ sourceKey: "age", specEncrypted: "sealed-pin" }]) },
      gameProfile: { findUnique: vi.fn().mockResolvedValue({ coverKind: "art", coverArt: "gold" }) },
      healthWorkingOn: { findMany: vi.fn().mockResolvedValue([]) },
      healthWorkingOnCheer: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: (run: (tx: object) => Promise<void>) => run(mocks.prismaClient),
    });
    mocks.readHostedHealthDataConsentState.mockResolvedValue("revoked");
    mocks.openHealthTexts.mockImplementation((entries: { rowId: string }[]) => entries.map(entry =>
      JSON.stringify(entry.rowId === "age" ? { kind: "age" } : summary(entry.rowId))));

    const result = await loadBrowserVaultExport({
      authorization: {
        method: "passkey", token: "synthetic-export-token",
        assertion: { type: "public-key", id: "synthetic-proof", rawId: "synthetic-proof", clientExtensionResults: {},
          response: { authenticatorData: "proof", clientDataJSON: "proof", signature: "proof" } },
      },
      fetchImpl: (input, init) => settingsVaultExportSessionRoute.POST(new Request(new URL(String(input), "https://export.example.test"), init)),
    });

    expect(JSON.parse(await result.blob.text())).toEqual({
      browserVault: null, exportedAt: result.generatedAt, progressShares: [],
      healthProfile: { cover: { art: "gold" }, pins: [{ key: "age", kind: "age" }], workingOn: [] },
      recordedActivities: rows.map(row => ({ ...summary(row.id), day: row.day, createdAt: createdAt.toISOString(), postId: null })),
    });
    expect(findMany).toHaveBeenCalledTimes(2);
    for (const [query] of findMany.mock.calls) {
      expect(query.where).toMatchObject({ memberId, deletedAt: null });
    }
    const opened = mocks.openHealthTexts.mock.calls.flatMap(([entries]) => entries);
    expect(opened).toEqual([
      ...rows.map(row => ({ memberId, rowId: row.id, table: "health_activity", field: "summary", value: row.summaryEncrypted })),
      { memberId, rowId: "age", table: "health_profile_pin", field: "spec", value: "sealed-pin" },
    ]);
    expect(mocks.assertHostedAppSessionCurrentTx).toHaveBeenCalledTimes(6);
    expect(mocks.consumeSensitiveActionChallenge.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.openHealthTexts.mock.invocationCallOrder[0]!);
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).not.toHaveBeenCalled();
  });

  it("asks an active member with saved summaries to retry while the replica is prepared", async () => {
    const findMany = vi.fn().mockResolvedValue([{
      memberId: "member_123", id: "c52cc66f-0d1e-4f4a-9a3b-000000000001", day: "2030-09-12",
      createdAt: new Date("2030-09-12T16:04:00.000Z"), postId: null, summaryEncrypted: "sealed-summary",
    }]);
    mocks.getPrisma.mockReturnValue({ healthActivity: { findMany } });
    const browser = await generateHostedUserRecipientKeyPair();
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({ createBrowserVaultExportSession: vi.fn() });

    const response = await settingsVaultExportSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/settings/vault-export/session", {
        authorization: {
          signature: `0x${"11".repeat(65)}`,
          token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
        },
        browserPublicKeyJwk: browser.publicKeyJwk,
        includeRecordedActivities: true,
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.consumeSensitiveActionChallenge).not.toHaveBeenCalled();
    expect(mocks.openHealthTexts).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "BROWSER_VAULT_SESSION_NOT_FRESH", retryable: true },
    });
  });

  it("preserves the retained-replica response for an older export client after withdrawal", async () => {
    const healthActivity = { findMany: vi.fn() };
    mocks.getPrisma.mockReturnValue({ healthActivity });
    const browser = await generateHostedUserRecipientKeyPair();
    mocks.readHostedHealthDataConsentState.mockResolvedValue("revoked");
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultSession: vi.fn(),
    });

    const response = await settingsVaultExportSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/settings/vault-export/session", {
        authorization: {
          signature: `0x${"11".repeat(65)}`,
          token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
        },
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(healthActivity.findMany).not.toHaveBeenCalled();
    expect(response.status).toBe(409);
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).not.toHaveBeenCalled();
    expect(mocks.consumeSensitiveActionChallenge).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "BROWSER_VAULT_RETAINED_REPLICA_UNAVAILABLE",
        message: expect.stringContaining("retained dashboard export"),
        retryable: true,
      },
    });
  });

  it("exports the retained replica and schedules refresh when the source state has moved", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createReplicaRef();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("b"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    mocks.readHostedWorkspaceBrowserVaultSourceStateHash.mockReturnValue("c".repeat(64));
    const createBrowserVaultSession = vi.fn().mockResolvedValue({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef,
      state: "ready",
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({ createBrowserVaultSession });

    const response = await settingsVaultExportSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/settings/vault-export/session", {
        authorization: {
          signature: `0x${"11".repeat(65)}`,
          token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
        },
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.verifySensitiveActionChallenge).toHaveBeenCalledTimes(1);
    expect(mocks.consumeSensitiveActionChallenge).toHaveBeenCalledTimes(1);
    expect(createBrowserVaultSession).toHaveBeenCalledWith({
      browserPublicKeyJwk: browser.publicKeyJwk,
      replicaRef,
      userId: "member_123",
    });
    await vi.dynamicImportSettled();
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).toHaveBeenCalledWith({
      userId: "member_123",
    });
    await expect(response.json()).resolves.toMatchObject({
      deviceSyncImportPending: false,
      freshness: "stale",
      refreshPending: true,
      state: "ready",
    });
  });

  it("exports the retained replica and schedules refresh when device import is pending", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createReplicaRef();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("a"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    mocks.readHostedWorkspaceBrowserVaultSourceStateHash.mockReturnValue(replicaRef.sourceBundleHash);
    mocks.hasPendingDirtyConnectionForUser.mockResolvedValueOnce(true);
    const createBrowserVaultSession = vi.fn().mockResolvedValue({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef,
      state: "ready",
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({ createBrowserVaultSession });

    const response = await settingsVaultExportSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/settings/vault-export/session", {
        authorization: {
          signature: `0x${"11".repeat(65)}`,
          token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
        },
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.verifySensitiveActionChallenge).toHaveBeenCalledTimes(1);
    expect(mocks.consumeSensitiveActionChallenge).toHaveBeenCalledTimes(1);
    expect(createBrowserVaultSession).toHaveBeenCalledTimes(1);
    await vi.dynamicImportSettled();
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).toHaveBeenCalledWith({
      userId: "member_123",
    });
    await expect(response.json()).resolves.toMatchObject({
      deviceSyncImportPending: true,
      freshness: "fresh",
      refreshPending: true,
      state: "ready",
    });
  });

  it("exports the retained replica conservatively when dirty-state lookup fails", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createReplicaRef();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("a"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    mocks.readHostedWorkspaceBrowserVaultSourceStateHash.mockReturnValue(replicaRef.sourceBundleHash);
    mocks.hasPendingDirtyConnectionForUser.mockRejectedValueOnce(
      new Error("dirty connection lookup failed"),
    );
    const createBrowserVaultSession = vi.fn().mockResolvedValue({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef,
      state: "ready",
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({ createBrowserVaultSession });

    const response = await settingsVaultExportSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/settings/vault-export/session", {
        authorization: {
          signature: `0x${"11".repeat(65)}`,
          token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
        },
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.consumeSensitiveActionChallenge).toHaveBeenCalledTimes(1);
    expect(createBrowserVaultSession).toHaveBeenCalledTimes(1);
    await vi.dynamicImportSettled();
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).toHaveBeenCalledWith({
      userId: "member_123",
    });
    await expect(response.json()).resolves.toMatchObject({
      deviceSyncImportPending: true,
      freshness: "fresh",
      refreshPending: true,
      state: "ready",
    });
  });

  it("rejects disallowed browser vault origins before reading app session state", async () => {
    mocks.assertHostedOnboardingMutationOrigin.mockImplementationOnce(() => {
      throw hostedOnboardingError({
        code: "HOSTED_ONBOARDING_ORIGIN_MISMATCH",
        httpStatus: 403,
        message: "Hosted browser mutation origin is not allowed.",
      });
    });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {}),
    );

    expect(response.status).toBe(403);
    expect(mocks.requireActivePrivyMemberAuth).not.toHaveBeenCalled();
    expect(mocks.assertBrowserVaultMemberAuthority).not.toHaveBeenCalled();
    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();
    expect(mocks.readHostedWorkspace).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_ONBOARDING_ORIGIN_MISMATCH",
        message: "Hosted browser mutation origin is not allowed.",
        retryable: false,
      },
    });
  });

  it("requires current member authority before reading browser vault state", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    mocks.assertBrowserVaultMemberAuthority.mockRejectedValue(hostedOnboardingError({
      code: "HOSTED_CONSENT_REQUIRED",
      httpStatus: 403,
      message: "Accept the current Murph legal consent before continuing.",
    }));

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.readHostedWorkspace).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_CONSENT_REQUIRED",
        message: "Accept the current Murph legal consent before continuing.",
        retryable: false,
      },
    });
  });

  it("rejects oversized session bodies before reading browser vault state", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const response = await browserVaultSessionRoute.POST(
        new Request("https://join.example.test/api/browser-vault/session", {
          body: "{}",
          headers: {
            "content-length": String(16 * 1024 + 1),
            "content-type": "application/json",
          },
          method: "POST",
        }),
      );

      expect(response.status).toBe(413);
      expect(mocks.readHostedWorkspace).not.toHaveBeenCalled();
      expect(mocks.readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "BROWSER_VAULT_SESSION_BODY_TOO_LARGE",
          message: "Browser vault session request body is too large.",
          retryable: false,
        },
      });
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("{}");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("rejects streamed oversized session bodies without trusting content-length", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const response = await browserVaultSessionRoute.POST(
        new Request("https://join.example.test/api/browser-vault/session", {
          body: createBodyStream(17 * 1024),
          duplex: "half",
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        } as RequestInit & { duplex: "half" }),
      );

      expect(response.status).toBe(413);
      expect(mocks.readHostedWorkspace).not.toHaveBeenCalled();
      expect(mocks.readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: "BROWSER_VAULT_SESSION_BODY_TOO_LARGE",
        },
      });
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("browserPublicKeyJwk");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("keeps explicit refresh ownership out of a fresh ready response", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: createReplicaRef(),
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("a"),
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
        knownReplicaRef: {
          ...createReplicaRef(),
          objectKey: "users/browser-vault-replicas/opaque/stale-replica.json",
        },
        requestRefresh: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).toHaveBeenCalledWith({
      browserPublicKeyJwk: browser.publicKeyJwk,
      replicaRef: createReplicaRef(),
      userId: "member_123",
    });
    await vi.dynamicImportSettled();
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).toHaveBeenCalledWith({
      userId: "member_123",
    });
    await expect(response.json()).resolves.toMatchObject({
      refreshPending: false,
      state: "ready",
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
      snapshotRef: createSnapshotRef("a"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    const createBrowserVaultSession = vi.fn();
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({ createBrowserVaultSession });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        knownReplicaRef: replicaRef,
      }),
    );

    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      encryptedReplica: null,
      memberId: "member_123",
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef,
      state: "not_modified",
    });
  });

  it("reuses a legacy browser cache when its old parser omitted shard refs", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createShardedReplicaRef();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("a"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    const createBrowserVaultSession = vi.fn();
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({ createBrowserVaultSession });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        knownReplicaRef: createReplicaRef(),
      }),
    );

    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      replicaRef,
      state: "not_modified",
    });
  });

  it("requests only route shards missing from the matching browser replica", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createShardedReplicaRef();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("a"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    const createBrowserVaultSession = vi.fn().mockResolvedValue({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef,
      state: "ready",
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({ createBrowserVaultSession });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        knownReplicaRef: replicaRef,
        knownShards: ["core"],
        requestedShards: ["core", "metricsIndex"],
      }),
    );

    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).toHaveBeenCalledWith({
      browserPublicKeyJwk: browser.publicKeyJwk,
      replicaRef,
      requestedShards: ["metricsIndex"],
      userId: "member_123",
    });
  });

  it("returns not_modified when all requested shards are already loaded", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createShardedReplicaRef();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("a"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    const createBrowserVaultSession = vi.fn();
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({ createBrowserVaultSession });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        knownReplicaRef: replicaRef,
        knownShards: ["core", "metricsIndex", "labs"],
        requestedShards: ["core", "metricsIndex"],
      }),
    );

    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      replicaRef,
      state: "not_modified",
    });
  });

  it("forwards only the missing metric bucket when fixed route shards are cached", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createShardedReplicaRef();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("a"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    const createBrowserVaultSession = vi.fn().mockResolvedValue({
      metricBuckets: {},
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef,
      state: "ready",
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultSession,
    });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        knownMetricBuckets: [],
        knownReplicaRef: replicaRef,
        knownShards: ["core", "metricsIndex"],
        requestedMetricBuckets: ["00"],
        requestedShards: ["core", "metricsIndex"],
      }),
    );

    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).toHaveBeenCalledWith({
      browserPublicKeyJwk: browser.publicKeyJwk,
      replicaRef,
      requestedMetricBuckets: ["00"],
      userId: "member_123",
    });
  });

  it("returns a retryable partial-load error when a selected child of the known sharded ref is missing", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createShardedReplicaRef();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("a"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    const createBrowserVaultSession = vi.fn().mockRejectedValue(
      new CloudflareHostedControlBrowserVaultReplicaNotFoundError(),
    );
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultSession,
    });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        knownMetricBuckets: ["00"],
        knownReplicaRef: replicaRef,
        knownShards: ["core", "metricsIndex"],
        requestedMetricBuckets: ["00", "01"],
        requestedShards: ["core", "metricsIndex"],
      }),
    );

    expect(response.status).toBe(503);
    expect(createBrowserVaultSession).toHaveBeenCalledWith({
      browserPublicKeyJwk: browser.publicKeyJwk,
      replicaRef,
      requestedMetricBuckets: ["01"],
      userId: "member_123",
    });
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "BROWSER_VAULT_PARTIAL_LOAD_UNAVAILABLE",
        message: "Requested browser vault data is temporarily unavailable.",
        retryable: true,
      },
    });
    await vi.dynamicImportSettled();
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).toHaveBeenCalledWith({
      userId: "member_123",
    });
  });

  it("does not resignal runtime work when an observation-only poll cannot find a selected shard", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createShardedReplicaRef();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("a"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    const createBrowserVaultSession = vi.fn().mockRejectedValue(
      new CloudflareHostedControlBrowserVaultReplicaNotFoundError(),
    );
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultSession,
    });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        knownMetricBuckets: ["00"],
        knownReplicaRef: replicaRef,
        knownShards: ["core", "metricsIndex"],
        refreshObservationOnly: true,
        requestedMetricBuckets: ["00", "01"],
        requestedShards: ["core", "metricsIndex"],
      }),
    );

    expect(response.status).toBe(503);
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "BROWSER_VAULT_PARTIAL_LOAD_UNAVAILABLE",
        retryable: true,
      },
    });
  });

  it.each([
    { knownShards: ["core"], requestedShards: undefined },
    { requestedShards: [] },
    { requestedShards: ["core", "core"] },
    { requestedShards: ["private"] },
  ])("rejects invalid shard capability input %#", async (shardInput) => {
    const browser = await generateHostedUserRecipientKeyPair();
    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        ...shardInput,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "BROWSER_VAULT_SESSION_INVALID_REQUEST" },
    });
  });

  it("returns not_modified when a layered snapshot base matches the current replica", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createReplicaRef();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createLayeredSnapshotRef({
        base: createSnapshotRef("a"),
        hot: createSnapshotRef("h"),
      }),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    const createBrowserVaultSession = vi.fn();
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({ createBrowserVaultSession });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        knownReplicaRef: replicaRef,
      }),
    );

    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      encryptedReplica: null,
      memberId: "member_123",
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef,
      state: "not_modified",
    });
  });

  it("returns not_modified when a working snapshot delta matches the current replica", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createReplicaRef();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createWorkingSnapshotRef({
        base: createSnapshotRef("b"),
        delta: createSnapshotRef("a"),
      }),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    const createBrowserVaultSession = vi.fn();
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({ createBrowserVaultSession });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        knownReplicaRef: replicaRef,
      }),
    );

    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      encryptedReplica: null,
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef,
      state: "not_modified",
    });
  });

  it("serves the latest replica ref even when the workspace has no snapshot ref", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const createBrowserVaultSession = vi.fn().mockResolvedValue({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: createReplicaRef(),
      state: "ready",
    });
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: createReplicaRef(),
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
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({ createBrowserVaultSession });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).toHaveBeenCalledWith({
      browserPublicKeyJwk: browser.publicKeyJwk,
      replicaRef: createReplicaRef(),
      userId: "member_123",
    });
    await expect(response.json()).resolves.toMatchObject({
      encryptedReplica: createReplicaEnvelope(),
      freshness: "fresh",
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: createReplicaRef(),
      refreshPending: false,
      state: "ready",
    });
  });

  it("serves the latest replica ref without comparing it to the workspace snapshot hash", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const createBrowserVaultSession = vi.fn().mockResolvedValue({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: createReplicaRef(),
      state: "ready",
    });
    const scheduleBrowserVaultRefresh = vi.fn().mockResolvedValue({
      accepted: true,
      scheduled: true,
      userId: "member_123",
    });
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: createReplicaRef(),
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("b"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultSession,
      scheduleBrowserVaultRefresh,
    });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).toHaveBeenCalledWith({
      browserPublicKeyJwk: browser.publicKeyJwk,
      replicaRef: createReplicaRef(),
      userId: "member_123",
    });
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      freshness: "fresh",
      refreshPending: false,
      state: "ready",
      workspaceVersion: "1",
    });
  });

  it("does not schedule refresh for an existing latest replica even if snapshot hashes differ", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const createBrowserVaultSession = vi.fn().mockResolvedValue({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: createReplicaRef(),
      state: "ready",
    });
    const scheduleBrowserVaultRefresh = vi.fn();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: createReplicaRef(),
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("b"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultSession,
      scheduleBrowserVaultRefresh,
    });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).toHaveBeenCalledWith({
      browserPublicKeyJwk: browser.publicKeyJwk,
      replicaRef: createReplicaRef(),
      userId: "member_123",
    });
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      freshness: "fresh",
      refreshPending: false,
      state: "ready",
      workspaceVersion: "1",
    });
  });

  it("falls back to detached scheduling when the after-response hook is unavailable", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    let releaseSchedule: () => void = () => {};
    const createBrowserVaultSession = vi.fn();
    mocks.signalHostedBrowserVaultRefreshRuntime.mockImplementationOnce(() =>
      new Promise<void>((resolve) => {
        releaseSchedule = resolve;
      }));
    mocks.afterResponse.mockImplementationOnce(() => {
      throw new Error("after unavailable outside a Next request lifecycle");
    });
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: null,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("b"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "2",
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultSession,
    });

    const responsePromise = browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    await vi.waitFor(() => {
      expect(mocks.signalHostedBrowserVaultRefreshRuntime).toHaveBeenCalledWith({
        userId: "member_123",
      });
    });
    const responseOrBlocked = await Promise.race([
      responsePromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
    ]);
    releaseSchedule();

    expect(responseOrBlocked).toBeInstanceOf(Response);
    const response = responseOrBlocked as Response;
    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      freshness: "stale",
      refreshPending: true,
      state: "empty",
      workspaceVersion: "2",
    });
  });

  it("does not wait for missing-replica refresh scheduling before returning the empty session response", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    let releaseSchedule: () => void = () => {};
    const createBrowserVaultSession = vi.fn();
    mocks.signalHostedBrowserVaultRefreshRuntime.mockImplementationOnce(() =>
      new Promise<void>((resolve) => {
        releaseSchedule = resolve;
      }));
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: null,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("b"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "2",
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultSession,
    });

    const responsePromise = browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    await vi.waitFor(() => {
      expect(mocks.signalHostedBrowserVaultRefreshRuntime).toHaveBeenCalledWith({
        userId: "member_123",
      });
    });
    expect(mocks.afterResponse).toHaveBeenCalledWith(expect.any(Function));
    const responseOrBlocked = await Promise.race([
      responsePromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
    ]);
    releaseSchedule();

    expect(responseOrBlocked).toBeInstanceOf(Response);
    const response = responseOrBlocked as Response;
    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      freshness: "stale",
      refreshPending: true,
      state: "empty",
      workspaceVersion: "2",
    });
  });

  it("returns fresh not_modified for the latest replica without stale opt-in", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createReplicaRef();
    const createBrowserVaultSession = vi.fn();
    const scheduleBrowserVaultRefresh = vi.fn().mockResolvedValue({
      accepted: true,
      scheduled: true,
      userId: "member_123",
    });
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("b"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "3",
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultSession,
      scheduleBrowserVaultRefresh,
    });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        acceptStaleReplica: true,
        browserPublicKeyJwk: browser.publicKeyJwk,
        knownReplicaRef: replicaRef,
      }),
    );

    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).not.toHaveBeenCalled();
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      deviceSyncImportPending: false,
      encryptedReplica: null,
      freshness: "fresh",
      memberId: "member_123",
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef,
      refreshPending: false,
      state: "not_modified",
      workspaceVersion: "3",
    });
  });

  it("serves a fresh previous-generation replica as stale and schedules refresh", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createReplicaRef({
      generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION - 1,
    });
    expect(replicaRef.generation).toBe(BROWSER_VAULT_REPLICA_CURRENT_GENERATION - 1);
    const createBrowserVaultSession = vi.fn().mockResolvedValue({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef,
      state: "ready",
    });
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("b"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "3",
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultSession,
    });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).toHaveBeenCalledWith({
      browserPublicKeyJwk: browser.publicKeyJwk,
      replicaRef,
      userId: "member_123",
    });
    await vi.waitFor(() => {
      expect(mocks.signalHostedBrowserVaultRefreshRuntime).toHaveBeenCalledWith({
        userId: "member_123",
      });
    });
    await expect(response.json()).resolves.toMatchObject({
      freshness: "stale",
      refreshPending: true,
      state: "ready",
    });
  });

  it("returns fresh not_modified when the checkpoint is newer than the current known ref", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-10T00:00:01.000Z"));

    try {
      const browser = await generateHostedUserRecipientKeyPair();
      const replicaRef = createReplicaRef({
        generatedAt: "2026-05-10T00:00:00.124Z",
      });
      const createBrowserVaultSession = vi.fn();
      mocks.readHostedWorkspace.mockResolvedValue({
        browserVaultReplicaRef: replicaRef,
        createdAt: "2026-05-01T00:00:00.000Z",
        checkpointedAt: "2026-05-10T00:00:00.255Z",
        redactedStatusJson: {},
        nextWakeAt: null,
        nextWakeReason: null,
        snapshotRef: createSnapshotRef("b"),
        updatedAt: "2026-05-10T00:00:00.000Z",
        userId: "member_123",
        version: "4",
      });
      mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
        createBrowserVaultSession,
      });

      const response = await browserVaultSessionRoute.POST(
        createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
          browserPublicKeyJwk: browser.publicKeyJwk,
          knownReplicaRef: replicaRef,
        }),
      );

      expect(response.status).toBe(200);
      expect(createBrowserVaultSession).not.toHaveBeenCalled();
      expect(mocks.signalHostedBrowserVaultRefreshRuntime).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        deviceSyncImportPending: false,
        encryptedReplica: null,
        freshness: "fresh",
        memberId: "member_123",
        replicaAad: null,
        replicaKeyEnvelope: null,
        replicaRef,
        refreshPending: false,
        state: "not_modified",
        workspaceVersion: "4",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("serves the latest replica when a layered snapshot base has a different hash", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const createBrowserVaultSession = vi.fn().mockResolvedValue({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: createReplicaRef(),
      state: "ready",
    });
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: createReplicaRef(),
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createLayeredSnapshotRef({
        base: createSnapshotRef("b"),
        hot: createSnapshotRef("h"),
      }),
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
    expect(createBrowserVaultSession).toHaveBeenCalledWith({
      browserPublicKeyJwk: browser.publicKeyJwk,
      replicaRef: createReplicaRef(),
      userId: "member_123",
    });
    await expect(response.json()).resolves.toMatchObject({
      freshness: "fresh",
      refreshPending: false,
      state: "ready",
    });
  });

  it("serves the latest replica when a layered snapshot has no base", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const createBrowserVaultSession = vi.fn().mockResolvedValue({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: createReplicaRef(),
      state: "ready",
    });
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: createReplicaRef(),
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createLayeredSnapshotRef({
        base: null,
        hot: createSnapshotRef("h"),
      }),
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
    expect(createBrowserVaultSession).toHaveBeenCalledWith({
      browserPublicKeyJwk: browser.publicKeyJwk,
      replicaRef: createReplicaRef(),
      userId: "member_123",
    });
    await expect(response.json()).resolves.toMatchObject({
      freshness: "fresh",
      refreshPending: false,
      state: "ready",
    });
  });

  it("returns not_modified for the latest ref without a workspace snapshot mismatch guard", async () => {
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
      snapshotRef: createSnapshotRef("b"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        knownReplicaRef: replicaRef,
      }),
    );

    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      encryptedReplica: null,
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef,
      state: "not_modified",
    });
  });

  it("signals a requested refresh without duplicating its pending owner", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createReplicaRef();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("b"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        knownReplicaRef: replicaRef,
        requestRefresh: true,
      }),
    );

    expect(response.status).toBe(200);
    await vi.dynamicImportSettled();
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).toHaveBeenCalledWith({
      userId: "member_123",
    });
    await expect(response.json()).resolves.toMatchObject({
      replicaRef,
      refreshPending: false,
      state: "not_modified",
    });
  });

  it("rejects a malformed explicit refresh flag", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        requestRefresh: "yes",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "BROWSER_VAULT_SESSION_INVALID_REQUEST",
      },
    });
  });

  it("rejects a refresh request marked observation-only", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        refreshObservationOnly: true,
        requestRefresh: true,
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "BROWSER_VAULT_SESSION_INVALID_REQUEST",
      },
    });
  });

  it("does not return not_modified when only the dataVersion matches", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const replicaRef = createReplicaRef();
    const knownReplicaRef = {
      ...replicaRef,
      objectKey: "users/browser-vault-replicas/opaque/previous-replica.json",
    };
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("a"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    const createBrowserVaultSession = vi.fn().mockResolvedValue({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef,
      state: "ready",
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({ createBrowserVaultSession });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        knownReplicaRef,
      }),
    );

    expect(response.status).toBe(200);
    expect(createBrowserVaultSession).toHaveBeenCalledWith({
      browserPublicKeyJwk: browser.publicKeyJwk,
      replicaRef,
      userId: "member_123",
    });
    await expect(response.json()).resolves.toMatchObject({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef,
      state: "ready",
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
      snapshotRef: createSnapshotRef("a"),
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
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_EXECUTION_CONTROL_NOT_CONFIGURED",
        message: "Hosted execution control plane is not configured.",
        retryable: false,
      },
    });
  });

  it.each(["interactive", "legacy export", "bucketed export"] as const)("returns a 502 for an invalid upstream %s session without consuming export approval", async (kind) => {
    const browser = await generateHostedUserRecipientKeyPair();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: createReplicaRef(),
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("a"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    const createBrowserVaultSession = vi.fn().mockRejectedValue(
      new CloudflareHostedControlMalformedResponseError(
        new Error("Synthetic response validation failure."),
      ),
    );

    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultSession,
      createBrowserVaultExportSession: createBrowserVaultSession,
    });

    const route = kind === "interactive" ? browserVaultSessionRoute : settingsVaultExportSessionRoute;
    const response = await route.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        ...(kind === "bucketed export" ? {
          requestedMetricBuckets: TEST_BROWSER_VAULT_METRIC_BUCKET_IDS,
          requestedShards: ["core", "labs", "metricsIndex"],
        } : {}),
      }),
    );

    expect(createBrowserVaultSession).toHaveBeenCalledTimes(1);
    expect(mocks.consumeSensitiveActionChallenge).not.toHaveBeenCalled();
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_EXECUTION_CONTROL_INVALID_RESPONSE",
        message: "Hosted execution control plane returned an invalid browser vault session.",
        retryable: false,
      },
    });
  });

  it.each(["interactive", "legacy export", "bucketed export"] as const)("does not label a client bug as an invalid upstream %s session", async (kind) => {
    const browser = await generateHostedUserRecipientKeyPair();
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: createReplicaRef(),
      createdAt: "2026-04-20T08:00:00.000Z",
      checkpointedAt: "2026-04-20T08:00:00.000Z",
      redactedStatusJson: {},
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: createSnapshotRef("a"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    const createBrowserVaultSession = vi.fn().mockRejectedValue(
      new TypeError("Synthetic client bug."),
    );

    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultSession,
      createBrowserVaultExportSession: createBrowserVaultSession,
    });

    const route = kind === "interactive" ? browserVaultSessionRoute : settingsVaultExportSessionRoute;
    const response = await route.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
        ...(kind === "bucketed export" ? {
          requestedMetricBuckets: TEST_BROWSER_VAULT_METRIC_BUCKET_IDS,
          requestedShards: ["core", "labs", "metricsIndex"],
        } : {}),
      }),
    );

    expect(createBrowserVaultSession).toHaveBeenCalledTimes(1);
    expect(mocks.consumeSensitiveActionChallenge).not.toHaveBeenCalled();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
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
      snapshotRef: createSnapshotRef("a"),
      updatedAt: "2026-04-20T08:00:00.000Z",
      userId: "member_123",
      version: "1",
    });
    const createBrowserVaultSession = vi.fn().mockRejectedValue(
      new CloudflareHostedControlBrowserVaultReplicaNotFoundError(),
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
    await expect(response.json()).resolves.toMatchObject({
      encryptedReplica: null,
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: null,
      refreshPending: true,
      state: "empty",
    });
    await vi.dynamicImportSettled();
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).toHaveBeenCalledWith({
      userId: "member_123",
    });
  });
});

function createReplicaRef(input: {
  generatedAt?: string;
  generation?: number | null;
} = {}) {
  return {
    byteLength: 128,
    dataVersion: "d".repeat(64),
    generatedAt: input.generatedAt ?? "2999-04-20T08:00:00.000Z",
    ...(input.generation === null
      ? {}
      : { generation: input.generation ?? BROWSER_VAULT_REPLICA_CURRENT_GENERATION }),
    keyId: "browser-vault-replica:d",
    objectKey: "users/browser-vault-replicas/opaque/replica.json",
    replicaSchema: "murph.browser-vault-replica" as const,
    runtimeRootKeyId: "udrk:runtime:test-root",
    schema: "murph.hosted-browser-vault-replica-ref.v1" as const,
    sourceBundleHash: "a".repeat(64),
  };
}

function createShardedReplicaRef() {
  const ref = createReplicaRef();
  return {
    ...ref,
    shards: {
      schema: "murph.hosted-browser-vault-replica-shards.v1" as const,
      core: createReplicaShardRef("core", 32),
      labs: createReplicaShardRef("labs", 34),
      metricsIndex: createReplicaShardRef("metricsIndex", 36),
    },
    metricBuckets: createReplicaMetricBucketRefs(),
  };
}

function createReplicaShardRef(
  shard: "core" | "labs" | "metricsIndex",
  encodedByteLength: number,
) {
  return {
    byteLength: encodedByteLength + 64,
    contentEncoding: "gzip" as const,
    encodedByteLength,
    objectKey: `users/browser-vault-replicas/opaque/replica.${shard}.json`,
  };
}

function createReplicaMetricBucketRefs(): HostedBrowserVaultReplicaMetricBucketSetRef {
  const buckets = Object.fromEntries(TEST_BROWSER_VAULT_METRIC_BUCKET_IDS.map(
    (bucketId) => [bucketId, {
      byteLength: 2,
      contentEncoding: "gzip" as const,
      encodedByteLength: 1,
      objectKey: `users/browser-vault-replicas/opaque/replica.metric-${bucketId}.json`,
    }],
  )) as HostedBrowserVaultReplicaMetricBucketSetRef["buckets"];
  return {
    bucketCount: 32,
    buckets,
    schema: "murph.hosted-browser-vault-replica-metric-buckets.v1",
  };
}

function createBodyStream(byteLength: number): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(byteLength).fill(123));
      controller.close();
    },
  });
}

function createSnapshotRef(hashCharacter: string) {
  const hash = hashCharacter.repeat(64);
  return {
    hash,
    key: `cloudflare-workspace-snapshots/${hash}.bundle`,
    size: 1024,
    updatedAt: "2026-04-20T08:00:00.000Z",
  };
}

function createLayeredSnapshotRef(input: {
  base: ReturnType<typeof createSnapshotRef> | null;
  hot: ReturnType<typeof createSnapshotRef> | null;
}) {
  return {
    base: input.base,
    hot: input.hot,
    schema: HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
  };
}

function createWorkingSnapshotRef(input: {
  base: ReturnType<typeof createSnapshotRef>;
  delta: ReturnType<typeof createSnapshotRef>;
}) {
  return {
    base: input.base,
    delta: input.delta,
    schema: HOSTED_EXECUTION_WORKING_SNAPSHOT_REF_SCHEMA,
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
