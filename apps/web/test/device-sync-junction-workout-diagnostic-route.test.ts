import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { deviceSyncError } from "@murphai/device-syncd/errors";

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncControlPlane: vi.fn(),
  findManyConnections: vi.fn(),
  getConnectionById: vi.fn(),
  listConnectionsForUser: vi.fn(),
  listSummary: vi.fn(),
  readConfiguredJunctionDeviceSyncProviderConfig: vi.fn(),
  requireAuthenticatedUser: vi.fn(),
  JunctionClient: vi.fn(function JunctionClient(this: { listSummary: unknown }) {
    this.listSummary = mocks.listSummary;
  }),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

vi.mock("@murphai/device-syncd/providers/junction-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@murphai/device-syncd/providers/junction-config")>()),
  readConfiguredJunctionDeviceSyncProviderConfig: mocks.readConfiguredJunctionDeviceSyncProviderConfig,
}));

vi.mock("@murphai/device-syncd/providers/junction-client", () => ({
  JunctionClient: mocks.JunctionClient,
}));

type JunctionWorkoutDiagnosticRouteModule = typeof import(
  "../app/api/internal/device-sync/junction/workouts/raw/route"
);

let route: JunctionWorkoutDiagnosticRouteModule;

describe("Junction raw workout diagnostic route", () => {
  beforeAll(async () => {
    route = await import("../app/api/internal/device-sync/junction/workouts/raw/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readConfiguredJunctionDeviceSyncProviderConfig.mockReturnValue({
      apiKey: "sk_us_junction-test",
      clientUserIdSecret: "junction-client-user-id-secret-value",
      environment: "sandbox",
      region: "us",
    });
    mocks.requireAuthenticatedUser.mockResolvedValue({ id: "member_123" });
    mocks.listConnectionsForUser.mockResolvedValue([
      {
        externalAccountId: "junction-user-123",
        id: "dsc_junction_123",
        provider: "junction",
        status: "active",
      },
    ]);
    mocks.findManyConnections.mockResolvedValue([
      {
        id: "dsc_junction_123",
      },
    ]);
    mocks.getConnectionById.mockResolvedValue({
      externalAccountId: "junction-user-123",
      id: "dsc_junction_123",
      provider: "junction",
      status: "active",
    });
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      requireAuthenticatedUser: mocks.requireAuthenticatedUser,
      store: {
        getConnectionById: mocks.getConnectionById,
        listConnectionsForUser: mocks.listConnectionsForUser,
        prisma: {
          deviceConnection: {
            findMany: mocks.findManyConnections,
          },
        },
      },
    });
    mocks.listSummary.mockResolvedValue([
      {
        calendar_date: "2026-06-13",
        sourceProviderSlug: "whoop_v2",
        sourceType: "unknown",
        sport: {
          name: "Other",
          slug: "other",
        },
        title: null,
      },
    ]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed unless the local diagnostic flag is enabled", async () => {
    const response = await route.GET(
      new Request("http://localhost:3000/api/internal/device-sync/junction/workouts/raw"),
    );

    expect(response.status).toBe(404);
    expect(mocks.readConfiguredJunctionDeviceSyncProviderConfig).not.toHaveBeenCalled();
    expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "JUNCTION_DIAGNOSTIC_DISABLED",
      },
    });
  });

  it("requires localhost even when explicitly enabled", async () => {
    vi.stubEnv("MURPH_ENABLE_JUNCTION_RAW_WORKOUT_DIAGNOSTIC", "1");

    const response = await route.GET(
      new Request("https://join.example.test/api/internal/device-sync/junction/workouts/raw"),
    );

    expect(response.status).toBe(404);
    expect(mocks.readConfiguredJunctionDeviceSyncProviderConfig).not.toHaveBeenCalled();
    expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "JUNCTION_DIAGNOSTIC_LOCAL_ONLY",
      },
    });
  });

  it("accepts IPv6 localhost diagnostics", async () => {
    vi.stubEnv("MURPH_ENABLE_JUNCTION_RAW_WORKOUT_DIAGNOSTIC", "1");

    const response = await route.GET(
      new Request("http://[::1]:3000/api/internal/device-sync/junction/workouts/raw"),
    );

    expect(response.status).toBe(200);
    expect(mocks.listSummary).toHaveBeenCalledWith(expect.objectContaining({
      resource: "workouts",
      sourceProviderSlug: "whoop_v2",
      userId: "junction-user-123",
    }));
  });

  it("keeps explicit diagnostic windows bounded", async () => {
    vi.stubEnv("MURPH_ENABLE_JUNCTION_RAW_WORKOUT_DIAGNOSTIC", "1");

    const response = await route.GET(
      new Request(
        "http://localhost:3000/api/internal/device-sync/junction/workouts/raw?start=2025-12-01T00:00:00.000Z&end=2026-06-14T00:00:00.000Z",
      ),
    );

    expect(response.status).toBe(400);
    expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
    expect(mocks.listSummary).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "JUNCTION_DIAGNOSTIC_WINDOW_TOO_LARGE",
      },
    });
  });

  it("falls back to the single active local Junction connection when hosted assertion auth is absent", async () => {
    vi.stubEnv("MURPH_ENABLE_JUNCTION_RAW_WORKOUT_DIAGNOSTIC", "1");
    mocks.requireAuthenticatedUser.mockRejectedValueOnce(deviceSyncError({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
      message: "Authentication is required.",
      retryable: false,
    }));

    const response = await route.GET(
      new Request("http://localhost:3000/api/internal/device-sync/junction/workouts/raw"),
    );

    expect(response.status).toBe(200);
    expect(mocks.createHostedDeviceSyncControlPlane).toHaveBeenCalledTimes(1);
    expect(mocks.requireAuthenticatedUser).toHaveBeenCalledTimes(1);
    expect(mocks.listConnectionsForUser).not.toHaveBeenCalled();
    expect(mocks.findManyConnections).toHaveBeenCalledWith({
      where: {
        externalAccountIdEncrypted: {
          not: null,
        },
        provider: "junction",
        status: {
          not: "disconnected",
        },
      },
      orderBy: [
        { updatedAt: "desc" },
        { id: "desc" },
      ],
      select: {
        id: true,
      },
      take: 2,
    });
    expect(mocks.getConnectionById).toHaveBeenCalledWith("dsc_junction_123");
    expect(mocks.listSummary).toHaveBeenCalledWith(expect.objectContaining({
      resource: "workouts",
      sourceProviderSlug: "whoop_v2",
      userId: "junction-user-123",
    }));
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      connection: {
        id: "dsc_junction_123",
      },
    });
  });

  it("fails closed instead of guessing when local diagnostics find multiple Junction connections", async () => {
    vi.stubEnv("MURPH_ENABLE_JUNCTION_RAW_WORKOUT_DIAGNOSTIC", "1");
    mocks.requireAuthenticatedUser.mockRejectedValueOnce(deviceSyncError({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
      message: "Authentication is required.",
      retryable: false,
    }));
    mocks.findManyConnections.mockResolvedValueOnce([
      { id: "dsc_junction_123" },
      { id: "dsc_junction_456" },
    ]);

    const response = await route.GET(
      new Request("http://localhost:3000/api/internal/device-sync/junction/workouts/raw"),
    );

    expect(response.status).toBe(400);
    expect(mocks.getConnectionById).not.toHaveBeenCalled();
    expect(mocks.listSummary).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "JUNCTION_DIAGNOSTIC_CONNECTION_AMBIGUOUS",
      },
    });
  });

  it("fetches raw Junction workouts for the authenticated user's Junction account", async () => {
    vi.stubEnv("MURPH_ENABLE_JUNCTION_RAW_WORKOUT_DIAGNOSTIC", "1");

    const request = new Request(
      "http://localhost:3000/api/internal/device-sync/junction/workouts/raw?start=2026-06-10T00:00:00.000Z&end=2026-06-14T00:00:00.000Z",
    );
    const response = await route.GET(request);

    expect(response.status).toBe(200);
    expect(mocks.createHostedDeviceSyncControlPlane).toHaveBeenCalledWith(request);
    expect(mocks.requireAuthenticatedUser).toHaveBeenCalledTimes(1);
    expect(mocks.listConnectionsForUser).toHaveBeenCalledWith("member_123");
    expect(mocks.JunctionClient).toHaveBeenCalledWith({
      apiKey: "sk_us_junction-test",
      clientUserIdSecret: "junction-client-user-id-secret-value",
      environment: "sandbox",
      region: "us",
    });
    expect(mocks.listSummary).toHaveBeenCalledWith({
      resource: "workouts",
      sourceProviderSlug: "whoop_v2",
      userId: "junction-user-123",
      windowEnd: "2026-06-14T00:00:00.000Z",
      windowStart: "2026-06-10T00:00:00.000Z",
    });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      diagnostic: "junction-workouts-raw",
      sourceProviderSlug: "whoop_v2",
      window: {
        start: "2026-06-10T00:00:00.000Z",
        end: "2026-06-14T00:00:00.000Z",
      },
      connection: {
        id: "dsc_junction_123",
        provider: "junction",
        status: "active",
      },
      count: 1,
      recordShapes: [
        {
          keys: ["calendar_date", "sourceProviderSlug", "sourceType", "sport", "title"],
          sourceProviderSlug: "whoop_v2",
          sourceType: "unknown",
          sportKeys: ["name", "slug"],
        },
      ],
      records: [
        {
          calendar_date: "2026-06-13",
          sourceProviderSlug: "whoop_v2",
          sourceType: "unknown",
          sport: {
            name: "Other",
            slug: "other",
          },
          title: null,
        },
      ],
    });
  });
});
