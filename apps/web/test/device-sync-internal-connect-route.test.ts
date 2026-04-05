import { createHostedExecutionSignatureHeaders } from "@murphai/hosted-execution";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncControlPlane: vi.fn(),
  startConnection: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

type InternalDeviceSyncConnectLinkRouteModule = typeof import(
  "../app/api/internal/device-sync/providers/[provider]/connect-link/route"
);

let internalDeviceSyncConnectLinkRoute: InternalDeviceSyncConnectLinkRouteModule;

describe("device sync internal connect-link route", () => {
  const originalControlSigningSecret = process.env.HOSTED_EXECUTION_CONTROL_SIGNING_SECRET;
  const originalSigningSecret = process.env.HOSTED_EXECUTION_SIGNING_SECRET;

  beforeAll(async () => {
    internalDeviceSyncConnectLinkRoute = await import(
      "../app/api/internal/device-sync/providers/[provider]/connect-link/route"
    );
  });

  afterEach(() => {
    if (originalControlSigningSecret === undefined) {
      delete process.env.HOSTED_EXECUTION_CONTROL_SIGNING_SECRET;
    } else {
      process.env.HOSTED_EXECUTION_CONTROL_SIGNING_SECRET = originalControlSigningSecret;
    }

    if (originalSigningSecret === undefined) {
      delete process.env.HOSTED_EXECUTION_SIGNING_SECRET;
      return;
    }

    process.env.HOSTED_EXECUTION_SIGNING_SECRET = originalSigningSecret;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      startConnection: mocks.startConnection,
    });
    mocks.startConnection.mockResolvedValue({
      authorizationUrl: "https://provider.example.test/oauth/start",
      expiresAt: "2026-04-04T12:00:00.000Z",
      provider: "whoop",
      state: "opaque-state",
    });
  });

  it("creates a hosted device connect link for the bound execution user with the dispatch signing secret", async () => {
    process.env.HOSTED_EXECUTION_CONTROL_SIGNING_SECRET = "control-secret";
    process.env.HOSTED_EXECUTION_SIGNING_SECRET = "dispatch-secret";
    const headers = await createSignedRequestHeaders("dispatch-secret");
    const response = await internalDeviceSyncConnectLinkRoute.POST(
      new Request("https://join.example.test/api/internal/device-sync/providers/whoop/connect-link", {
        headers,
        method: "POST",
      }),
      {
        params: Promise.resolve({
          provider: "whoop",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(mocks.startConnection).toHaveBeenCalledWith(
      "member_123",
      "whoop",
      "/settings?tab=wearables",
    );
    await expect(response.json()).resolves.toEqual({
      authorizationUrl: "https://provider.example.test/oauth/start",
      expiresAt: "2026-04-04T12:00:00.000Z",
      provider: "whoop",
      providerLabel: "WHOOP",
    });
  });

  it("rejects requests signed only with the distinct control secret", async () => {
    process.env.HOSTED_EXECUTION_CONTROL_SIGNING_SECRET = "control-secret";
    process.env.HOSTED_EXECUTION_SIGNING_SECRET = "dispatch-secret";

    const response = await internalDeviceSyncConnectLinkRoute.POST(
      new Request("https://join.example.test/api/internal/device-sync/providers/whoop/connect-link", {
        headers: await createSignedRequestHeaders("control-secret"),
        method: "POST",
      }),
      {
        params: Promise.resolve({
          provider: "whoop",
        }),
      },
    );

    expect(response.status).toBe(401);
    expect(mocks.startConnection).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_EXECUTION_UNAUTHORIZED",
        message: "Unauthorized hosted execution request.",
        retryable: false,
      },
    });
  });

  it("rejects unsigned requests on the internal connect-link route", async () => {
    process.env.HOSTED_EXECUTION_CONTROL_SIGNING_SECRET = "control-secret";
    process.env.HOSTED_EXECUTION_SIGNING_SECRET = "dispatch-secret";

    const response = await internalDeviceSyncConnectLinkRoute.POST(
      new Request("https://join.example.test/api/internal/device-sync/providers/whoop/connect-link", {
        headers: {
          "x-hosted-execution-user-id": "member_123",
        },
        method: "POST",
      }),
      {
        params: Promise.resolve({
          provider: "whoop",
        }),
      },
    );

    expect(response.status).toBe(401);
    expect(mocks.startConnection).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_EXECUTION_UNAUTHORIZED",
        message: "Unauthorized hosted execution request.",
        retryable: false,
      },
    });
  });

  it("rejects GET requests on the internal connect-link route", async () => {
    const response = await internalDeviceSyncConnectLinkRoute.GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message:
          "Hosted internal device-sync connect-link routes only allow POST because starting a connection mutates server state.",
      },
    });
  });
});

async function createSignedRequestHeaders(secret: string): Promise<HeadersInit> {
  const headers = await createHostedExecutionSignatureHeaders({
    method: "POST",
    path: "/api/internal/device-sync/providers/whoop/connect-link",
    payload: "",
    secret,
    timestamp: new Date().toISOString(),
  });

  return {
    ...headers,
    "x-hosted-execution-user-id": "member_123",
  };
}
