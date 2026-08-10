import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAgentSessionService: vi.fn(),
  createScopedRegistry: vi.fn(),
  createSharedRegistry: vi.fn(),
  resolveApplication: vi.fn(),
  scopedGet: vi.fn(),
  sharedGet: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/agent-session-service", () => ({
  createHostedDeviceSyncAgentSessionService: mocks.createAgentSessionService,
}));
vi.mock("@/src/lib/device-sync/provider-applications", () => ({
  resolveDeviceProviderApplicationForConnection: mocks.resolveApplication,
}));
vi.mock("@/src/lib/device-sync/providers", () => ({
  createHostedDeviceSyncRegistry: mocks.createSharedRegistry,
  createHostedDeviceSyncRegistryWithProviderConfigs: mocks.createScopedRegistry,
}));

import {
  createHostedDeviceSyncProviderAgentSessionService,
} from "@/src/lib/device-sync/agent-session-provider-service";
import type {
  HostedDeviceSyncAgentSessionOptions,
  HostedDeviceSyncRefreshProviderResolver,
} from "@/src/lib/device-sync/agent-session-service";

function readResolver(): HostedDeviceSyncRefreshProviderResolver {
  const options = mocks.createAgentSessionService.mock.calls[0]?.[1] as
    | HostedDeviceSyncAgentSessionOptions
    | undefined;
  expect(options?.resolveRefreshProvider).toBeTypeOf("function");
  return options?.resolveRefreshProvider as HostedDeviceSyncRefreshProviderResolver;
}

describe("member-owned provider agent-session adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSharedRegistry.mockReturnValue({
      get: mocks.sharedGet,
    });
    mocks.createScopedRegistry.mockReturnValue({
      get: mocks.scopedGet,
    });
    mocks.createAgentSessionService.mockReturnValue(Symbol("agent-session-service"));
  });

  it("resolves app-bound refreshes only through the member-scoped registry", async () => {
    const provider = { id: "member-strava-provider" };
    const providerConfigs = {
      strava: {
        clientId: "member-client",
        clientSecret: "member-secret",
      },
    };
    mocks.resolveApplication.mockResolvedValue({
      provider: "strava",
      providerConfigs,
    });
    mocks.scopedGet.mockReturnValue(provider);

    const request = new Request(
      "https://murph.example/api/device-sync/agent/connections/dsc_123/refresh-token-bundle",
    );
    const service = createHostedDeviceSyncProviderAgentSessionService(request);
    const resolveRefreshProvider = readResolver();
    const prisma = { marker: "prisma" } as never;

    await expect(resolveRefreshProvider({
      connectionId: "dsc_123",
      prisma,
      providerId: "strava",
      userId: "member_123",
    })).resolves.toBe(provider);

    expect(service).toBe(mocks.createAgentSessionService.mock.results[0]?.value);
    expect(mocks.resolveApplication).toHaveBeenCalledWith({
      connectionId: "dsc_123",
      memberId: "member_123",
      prisma,
    });
    expect(mocks.createScopedRegistry).toHaveBeenCalledWith({
      providerConfigs,
    });
    expect(mocks.scopedGet).toHaveBeenCalledWith("strava");
    expect(mocks.sharedGet).not.toHaveBeenCalled();
  });

  it("uses the shared registry only when the connection has no private application", async () => {
    const provider = { id: "shared-whoop-provider" };
    mocks.resolveApplication.mockResolvedValue(null);
    mocks.sharedGet.mockReturnValue(provider);

    createHostedDeviceSyncProviderAgentSessionService(
      new Request("https://murph.example/refresh"),
    );
    const resolveRefreshProvider = readResolver();

    await expect(resolveRefreshProvider({
      connectionId: "dsc_shared",
      prisma: {} as never,
      providerId: "whoop",
      userId: "member_123",
    })).resolves.toBe(provider);

    expect(mocks.sharedGet).toHaveBeenCalledWith("whoop");
    expect(mocks.createScopedRegistry).not.toHaveBeenCalled();
  });

  it("does not fall back to shared credentials when an app-bound registry lacks the provider", async () => {
    mocks.resolveApplication.mockResolvedValue({
      provider: "strava",
      providerConfigs: {
        strava: {
          clientId: "member-client",
          clientSecret: "member-secret",
        },
      },
    });
    mocks.scopedGet.mockReturnValue(undefined);
    mocks.sharedGet.mockReturnValue({ id: "shared-strava-provider" });

    createHostedDeviceSyncProviderAgentSessionService(
      new Request("https://murph.example/refresh"),
    );
    const resolveRefreshProvider = readResolver();

    await expect(resolveRefreshProvider({
      connectionId: "dsc_private",
      prisma: {} as never,
      providerId: "strava",
      userId: "member_123",
    })).resolves.toBeNull();

    expect(mocks.sharedGet).not.toHaveBeenCalled();
  });
});
