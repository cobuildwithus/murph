import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createJsonPostRequest } from "./route-test-helpers";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  createBrowserConnectionId: vi.fn(),
  createHostedDeviceSyncControlPlane: vi.fn(),
  diagnoseBackfill: vi.fn(),
  getStoredConnectionAccountForUser: vi.fn(),
  listConnections: vi.fn(),
  listConnectionsForUser: vi.fn(),
  probeRest: vi.fn(),
  registryGet: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest: mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

type HostedOpsJunctionDiagnosticsRouteModule =
  typeof import("../app/api/ops/device-sync/junction-diagnostics/route");

let hostedOpsJunctionDiagnosticsRoute: HostedOpsJunctionDiagnosticsRouteModule;

const SELECTED_SOURCE_PROVIDER = "oura";

const originalHostedOpsMemberIds = process.env.HOSTED_OPS_MEMBER_IDS;
const originalDeviceSyncBackfillDiagnosticEnabled =
  process.env.DEVICE_SYNC_BACKFILL_DIAGNOSTIC_ENABLED;

describe("hosted ops Junction diagnostics", () => {
  beforeAll(async () => {
    hostedOpsJunctionDiagnosticsRoute =
      await import("../app/api/ops/device-sync/junction-diagnostics/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEVICE_SYNC_BACKFILL_DIAGNOSTIC_ENABLED = "true";
    process.env.HOSTED_OPS_MEMBER_IDS = "member_ops";
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_ops" },
    });
    mocks.createBrowserConnectionId.mockImplementation((connectionId: string) =>
      connectionId === "dsc_junction_123" ? "dspc_junction_123" : connectionId
    );
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      connections: {
        createBrowserConnectionId: mocks.createBrowserConnectionId,
      },
      listConnections: mocks.listConnections,
      publicIngressBaseUrl: "https://join.example.test/api/device-sync",
      publicIngressBaseUrlSource: "request",
      registry: {
        get: mocks.registryGet,
      },
      store: {
        getStoredConnectionAccountForUser: mocks.getStoredConnectionAccountForUser,
        listConnectionsForUser: mocks.listConnectionsForUser,
      },
    });
    mocks.registryGet.mockReturnValue({
      credentialPolicy: {
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      diagnostics: {
        diagnoseBackfill: mocks.diagnoseBackfill,
        probeRest: mocks.probeRest,
      },
      descriptor: {
        provider: "junction",
        webhook: {
          path: "/webhooks/junction",
          supportsAdmin: false,
        },
      },
      provider: "junction",
    });
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(null);
    mocks.listConnections.mockResolvedValue({
      connectionSources: [
        {
          connectionId: "dspc_junction_123",
          firstSeenAt: "2026-06-27T18:49:38.000Z",
          lastSeenAt: "2026-06-28T08:50:56.000Z",
          resourceCount: 18,
          sourceProviderSlug: SELECTED_SOURCE_PROVIDER,
          status: "connected",
        },
      ],
      connections: [
        {
          accessTokenExpiresAt: null,
          connectedAt: "2026-06-27T18:49:38.000Z",
          createdAt: "2026-06-27T18:49:38.000Z",
          displayName: "Junction",
          id: "dspc_junction_123",
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncCompletedAt: "2026-06-28T08:51:00.000Z",
          lastSyncErrorAt: null,
          lastSyncStartedAt: "2026-06-28T08:50:54.000Z",
          lastWebhookAt: null,
          metadata: {},
          nextReconcileAt: "2026-06-28T16:00:00.000Z",
          provider: "junction",
          scopes: [],
          setupPhase: "source_confirmed",
          status: "active",
          updatedAt: "2026-06-28T08:51:00.000Z",
        },
      ],
      providers: [],
    });
    mocks.listConnectionsForUser.mockResolvedValue([
      {
        accessTokenExpiresAt: null,
        connectedAt: "2026-06-27T18:49:38.000Z",
        createdAt: "2026-06-27T18:49:38.000Z",
        displayName: "Junction",
        externalAccountId: "junction-user-raw-id",
        id: "dsc_junction_123",
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: "2026-06-28T08:51:00.000Z",
        lastSyncErrorAt: null,
        lastSyncStartedAt: "2026-06-28T08:50:54.000Z",
        lastWebhookAt: null,
        metadata: {},
        nextReconcileAt: "2026-06-28T16:00:00.000Z",
        provider: "junction",
        scopes: [],
        setupPhase: "source_confirmed",
        status: "active",
        updatedAt: "2026-06-28T08:51:00.000Z",
      },
    ]);
    mocks.diagnoseBackfill.mockResolvedValue({
      generatedAt: "2026-06-28T17:00:00.000Z",
      provider: "junction",
      result: {
        sourceProviders: {
          ok: true,
          recordCount: 1,
          sourceProviderSlugs: [SELECTED_SOURCE_PROVIDER],
        },
        summary: {
          hasUsefulHistoricalRecords: false,
          resources: [],
        },
        timeseriesProbe: {
          days: 7,
          resources: [],
          window: null,
        },
        window: {
          windowEnd: "2026-06-28T23:59:59.999Z",
          windowStart: "2025-12-30T23:59:59.999Z",
        },
      },
    });
    mocks.probeRest.mockResolvedValue({
      generatedAt: "2026-06-28T17:00:00.000Z",
      provider: "junction",
      result: {
        historicalPull: [
          {
            request: {
              sourceFiltered: true,
              sourceProviderSlug: SELECTED_SOURCE_PROVIDER,
            },
            response: {
              notPulled: [{ resource: "sleep" }],
              notPulledCount: 1,
              ok: true,
              pulled: [
                {
                  daysWithData: 2,
                  endedAt: "2026-06-28T08:50:56.000Z",
                  hasErrorDetails: false,
                  rangeEnd: "2026-06-28T23:59:59.999Z",
                  rangeStart: "2025-12-30T23:59:59.999Z",
                  resource: "activity",
                  scheduledAt: "2026-06-27T18:49:38.000Z",
                  startedAt: "2026-06-27T18:49:38.000Z",
                  status: "finished",
                },
              ],
              pulledCount: 1,
              responseStatus: 200,
              sourceProviderCount: 1,
            },
          },
        ],
        introspection: [
          {
            request: {
              sourceFiltered: true,
              sourceProviderSlug: SELECTED_SOURCE_PROVIDER,
            },
            response: {
              ok: true,
              resourceCount: 2,
              resources: [
                {
                  lastAttemptAt: "2026-06-28T08:50:54.000Z",
                  lastAttemptStatus: "success",
                  newestData: "2026-06-28",
                  oldestData: "2026-06-27",
                  resource: "activity",
                  sentCount: 2,
                },
              ],
              responseStatus: 200,
              sourceProviderCount: 1,
            },
          },
        ],
        reads: [
          {
            request: {
              configuredResource: true,
              resource: "activity",
              resourceCategory: "summary",
              sourceFiltered: true,
              sourceProviderSlug: SELECTED_SOURCE_PROVIDER,
            },
            response: {
              ok: true,
              recordCount: 2,
              records: [
                {
                  rawProviderPayload: "raw-provider-row-should-not-leak",
                },
              ],
              responseStatus: 200,
              shape: {
                keys: ["rawProviderPayload"],
              },
            },
          },
        ],
        request: {
          endpoint: "matrix",
          resourceCount: 2,
          sourceProviderSlug: SELECTED_SOURCE_PROVIDER,
          window: {
            windowEnd: "2026-06-28T23:59:59.999Z",
            windowStart: "2025-12-30T23:59:59.999Z",
          },
        },
      },
    });
  });

  afterEach(() => {
    if (originalHostedOpsMemberIds === undefined) {
      delete process.env.HOSTED_OPS_MEMBER_IDS;
    } else {
      process.env.HOSTED_OPS_MEMBER_IDS = originalHostedOpsMemberIds;
    }
    if (originalDeviceSyncBackfillDiagnosticEnabled === undefined) {
      delete process.env.DEVICE_SYNC_BACKFILL_DIAGNOSTIC_ENABLED;
    } else {
      process.env.DEVICE_SYNC_BACKFILL_DIAGNOSTIC_ENABLED =
        originalDeviceSyncBackfillDiagnosticEnabled;
    }
  });

  it("runs a member-targeted Junction source matrix diagnostic without returning raw payload data", async () => {
    const request = createJsonPostRequest(
      "https://join.example.test/api/ops/device-sync/junction-diagnostics",
      {
        connectionId: "dspc_junction_123",
        memberId: "member_target",
        sourceProvider: SELECTED_SOURCE_PROVIDER,
        windowEnd: "2026-06-28T23:59:59.999Z",
      },
      {
        headers: {
          origin: "https://join.example.test",
        },
      },
    );

    const response = await hostedOpsJunctionDiagnosticsRoute.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(request);
    expect(mocks.requireActiveHostedAppSessionFromRequest).toHaveBeenCalledWith(request);
    expect(mocks.listConnections).toHaveBeenCalledWith("member_target");
    expect(mocks.getStoredConnectionAccountForUser).toHaveBeenCalledWith(
      "member_target",
      "dsc_junction_123",
    );
    expect(mocks.diagnoseBackfill).toHaveBeenCalledWith(expect.objectContaining({
      account: expect.objectContaining({
        externalAccountId: "junction-user-raw-id",
        id: "dsc_junction_123",
      }),
      timeseriesProbeDays: 7,
      windowEnd: "2026-06-28T23:59:59.999Z",
      windowStart: "2025-12-30T23:59:59.999Z",
    }));
    expect(mocks.probeRest).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: "matrix",
      resource: null,
      sourceProviderSlug: SELECTED_SOURCE_PROVIDER,
      timeoutSeconds: null,
      windowEnd: "2026-06-28T23:59:59.999Z",
      windowStart: "2025-12-30T23:59:59.999Z",
    }));

    const bodyText = await response.text();
    expect(bodyText).not.toContain("junction-user-raw-id");
    expect(bodyText).not.toContain("externalAccountIdHash");
    expect(bodyText).not.toContain("sourceProviderSlug");
    expect(bodyText).not.toContain("sourceProviderSlugs");
    expect(bodyText).not.toContain("raw-provider-row-should-not-leak");
    expect(bodyText).not.toContain("rawProviderPayload");

    expect(JSON.parse(bodyText)).toMatchObject({
      backfill: {
        hasUsefulHistoricalRecords: false,
        sourceProviderCount: 1,
        timeseriesProbeDays: 7,
      },
      matrix: {
        historicalPull: [
          {
            notPulledCount: 1,
            pulledCount: 1,
            scope: "selected_source",
          },
        ],
        introspection: [
          {
            resourceCount: 2,
            scope: "selected_source",
            sentCount: 2,
          },
        ],
        readCount: 1,
        reads: [
          {
            recordCount: 2,
            resource: "activity",
            resourceCategory: "summary",
            sourceFiltered: true,
          },
        ],
        resourceCount: 2,
        sourceFilteredReadCount: 1,
      },
      memberId: "member_target",
      ok: true,
      selectedConnection: {
        connectionMatchCount: 1,
        lastSyncCompletedAt: "2026-06-28T08:51:00.000Z",
        lastSyncStartedAt: "2026-06-28T08:50:54.000Z",
        provider: "junction",
        status: "active",
      },
      sourceProvider: SELECTED_SOURCE_PROVIDER,
      webSourceProjection: {
        sourceCount: 1,
        totalResourceCount: 18,
      },
      window: {
        lookbackDays: 180,
        timeseriesDays: 7,
        windowEnd: "2026-06-28T23:59:59.999Z",
        windowStart: "2025-12-30T23:59:59.999Z",
      },
    });
  });

  it("denies diagnostics when the ops session member is not allowlisted", async () => {
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValueOnce({
      member: { id: "member_other" },
    });

    const response = await hostedOpsJunctionDiagnosticsRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/ops/device-sync/junction-diagnostics",
        {
          memberId: "member_target",
          sourceProvider: SELECTED_SOURCE_PROVIDER,
        },
        {
          headers: {
            origin: "https://join.example.test",
          },
        },
      ),
    );

    expect(response.status).toBe(404);
    expect(mocks.listConnections).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_OPS_ACCESS_DENIED",
      },
    });
  });

  it("rejects missing target member ids before running provider diagnostics", async () => {
    const response = await hostedOpsJunctionDiagnosticsRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/ops/device-sync/junction-diagnostics",
        {},
        {
          headers: {
            origin: "https://join.example.test",
          },
        },
      ),
    );

    expect(response.status).toBe(400);
    expect(mocks.listConnections).not.toHaveBeenCalled();
    expect(mocks.diagnoseBackfill).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_OPS_JUNCTION_DIAGNOSTIC_MEMBER_ID_INVALID",
      },
    });
  });

  it("rejects missing source providers before running provider diagnostics", async () => {
    const response = await hostedOpsJunctionDiagnosticsRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/ops/device-sync/junction-diagnostics",
        {
          memberId: "member_target",
        },
        {
          headers: {
            origin: "https://join.example.test",
          },
        },
      ),
    );

    expect(response.status).toBe(400);
    expect(mocks.listConnections).not.toHaveBeenCalled();
    expect(mocks.diagnoseBackfill).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_OPS_JUNCTION_DIAGNOSTIC_SOURCE_PROVIDER_INVALID",
      },
    });
  });
});
