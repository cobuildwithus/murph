import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murph/hosted-execution";

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncControlPlane: vi.fn(),
  ensureHostedWebhookSubscriptionsForRuntimeSnapshot: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

type ApplyRouteModule = typeof import("../app/api/internal/device-sync/runtime/apply/route");
type SnapshotRouteModule = typeof import("../app/api/internal/device-sync/runtime/snapshot/route");

let applyRoute: ApplyRouteModule;
let snapshotRoute: SnapshotRouteModule;

const originalInternalToken = process.env.HOSTED_EXECUTION_INTERNAL_TOKEN;

describe("hosted device-sync internal routes", () => {
  beforeAll(async () => {
    applyRoute = await import("../app/api/internal/device-sync/runtime/apply/route");
    snapshotRoute = await import("../app/api/internal/device-sync/runtime/snapshot/route");
  });

  afterAll(() => {
    if (typeof originalInternalToken === "string") {
      process.env.HOSTED_EXECUTION_INTERNAL_TOKEN = originalInternalToken;
    } else {
      delete process.env.HOSTED_EXECUTION_INTERNAL_TOKEN;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOSTED_EXECUTION_INTERNAL_TOKEN = "internal-token";
    mocks.ensureHostedWebhookSubscriptionsForRuntimeSnapshot.mockResolvedValue(undefined);
  });

  it("binds snapshot requests to the trusted hosted execution user at the route boundary", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      ensureHostedWebhookSubscriptionsForRuntimeSnapshot:
        mocks.ensureHostedWebhookSubscriptionsForRuntimeSnapshot,
      store: {
        codec: {
          decrypt: vi.fn(),
          encrypt: vi.fn(),
          keyVersion: "v1",
        },
        prisma: {
          deviceConnection: {
            findMany,
          },
        },
      },
    });

    const response = await snapshotRoute.POST(
      new Request("https://web.example.test/api/internal/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          provider: "oura",
        }),
        headers: {
          authorization: "Bearer internal-token",
          "content-type": "application/json",
          [HOSTED_EXECUTION_USER_ID_HEADER]: "member_123",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      connections: [],
      userId: "member_123",
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        provider: "oura",
        userId: "member_123",
      },
    }));
    expect(mocks.ensureHostedWebhookSubscriptionsForRuntimeSnapshot).toHaveBeenCalledWith({
      provider: "oura",
      userId: "member_123",
    });
  });

  it("rejects snapshot bodies whose userId conflicts with the trusted hosted execution user header", async () => {
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      ensureHostedWebhookSubscriptionsForRuntimeSnapshot:
        mocks.ensureHostedWebhookSubscriptionsForRuntimeSnapshot,
      store: {
        prisma: {
          deviceConnection: {
            findMany: vi.fn(),
          },
        },
      },
    });

    const response = await snapshotRoute.POST(
      new Request("https://web.example.test/api/internal/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          userId: "member_456",
        }),
        headers: {
          authorization: "Bearer internal-token",
          "content-type": "application/json",
          [HOSTED_EXECUTION_USER_ID_HEADER]: "member_123",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "userId must match the authenticated hosted execution user.",
      },
    });
    expect(mocks.ensureHostedWebhookSubscriptionsForRuntimeSnapshot).not.toHaveBeenCalled();
  });

  it("binds apply requests to the trusted hosted execution user at the route boundary", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      store: {
        codec: {
          decrypt: vi.fn(),
          encrypt: vi.fn(),
          keyVersion: "v1",
        },
        createSignal: vi.fn(),
        markConnectionDisconnected: vi.fn(),
        prisma: {},
        withConnectionRefreshLock: vi.fn(async (_connectionId, callback) =>
          callback({
            deviceConnection: {
              findFirst,
              update: vi.fn(),
            },
            deviceConnectionSecret: {
              create: vi.fn(),
              update: vi.fn(),
            },
          })
        ),
      },
    });

    const response = await applyRoute.POST(
      new Request("https://web.example.test/api/internal/device-sync/runtime/apply", {
        body: JSON.stringify({
          updates: [
            {
              connectionId: "dsc_123",
              status: "active",
            },
          ],
        }),
        headers: {
          authorization: "Bearer internal-token",
          "content-type": "application/json",
          [HOSTED_EXECUTION_USER_ID_HEADER]: "member_123",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      appliedAt: expect.any(String),
      updates: [
        {
          connection: null,
          connectionId: "dsc_123",
          status: "missing",
          tokenUpdate: "missing",
        },
      ],
      userId: "member_123",
    });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "dsc_123",
        userId: "member_123",
      },
    }));
  });

  it("rejects apply bodies whose userId conflicts with the trusted hosted execution user header", async () => {
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      store: {
        withConnectionRefreshLock: vi.fn(),
      },
    });

    const response = await applyRoute.POST(
      new Request("https://web.example.test/api/internal/device-sync/runtime/apply", {
        body: JSON.stringify({
          updates: [],
          userId: "member_456",
        }),
        headers: {
          authorization: "Bearer internal-token",
          "content-type": "application/json",
          [HOSTED_EXECUTION_USER_ID_HEADER]: "member_123",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "userId must match the authenticated hosted execution user.",
      },
    });
  });
});
