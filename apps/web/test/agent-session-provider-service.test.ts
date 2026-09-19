import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAgentSessionService: vi.fn(),
  createRegistry: vi.fn(),
}));
vi.mock("@/src/lib/device-sync/agent-session-service", () => ({
  createHostedDeviceSyncAgentSessionService: mocks.createAgentSessionService,
}));
vi.mock("@/src/lib/device-sync/providers", () => ({
  createHostedDeviceSyncRegistry: mocks.createRegistry,
}));
import { createHostedDeviceSyncProviderAgentSessionService } from "@/src/lib/device-sync/agent-session-provider-service";

it("supplies the configured registry to the ordinary refresh owner", () => {
  const registry = new Map();
  const service = Symbol("service");
  mocks.createRegistry.mockReturnValue(registry);
  mocks.createAgentSessionService.mockReturnValue(service);
  const request = new Request("https://example.test/refresh");
  expect(createHostedDeviceSyncProviderAgentSessionService(request)).toBe(service);
  expect(mocks.createAgentSessionService).toHaveBeenCalledWith(request, { registry });
});
