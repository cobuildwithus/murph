import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../src/runtime-platform/web-control-transport.ts", async (original) => ({
  ...await original<typeof import("../src/runtime-platform/web-control-transport.ts")>(),
  fetchHostedWebControlPlaneJson: mocks.fetch,
}));
import { createCloudflareEffectsPort } from "../src/runtime-platform/effects-port.ts";
import { HOSTED_RUNNER_WEB_CONTROL_ROUTES } from "../src/runtime-platform/web-control-transport.ts";

const route = {
  actorId: null, channel: "telegram", delivery: { kind: "thread", target: "synthetic-chat" },
  identityId: "synthetic-identity", threadId: "synthetic-chat", threadIsDirect: true,
};
const lease = {
  attemptId: "rt_synthetic", leaseGeneration: "7", workspaceVersion: "9", userId: "member-synthetic",
};
function port(withLease = true) {
  return createCloudflareEffectsPort({
    boundUserId: lease.userId, fetchImpl: fetch, timeoutMs: 5000,
    webControlTransport: { mode: "proxy" },
    workspaceCheckpointBridge: { readCurrentLease: () => withLease ? lease : null },
  });
}
describe("member notification route bridge", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("binds the read to the member and current runtime fence", async () => {
    mocks.fetch.mockResolvedValue({ route });
    const signal = new AbortController().signal;
    await expect(port().resolveMemberNotificationRoute?.({ signal })).resolves.toMatchObject(route);
    expect(mocks.fetch).toHaveBeenCalledWith(expect.objectContaining({
      body: {}, boundUserId: lease.userId,
      route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.memberNotificationRoute,
      signal, timeoutMs: 5000, transport: { mode: "proxy" },
    }));
    const headers = mocks.fetch.mock.calls[0]?.[0].headers as Headers;
    expect([...headers.values()]).toEqual(expect.arrayContaining(["rt_synthetic", "7", "9"]));
  });
  it("does not request routing without a current runtime lease", async () => {
    await expect(port(false).resolveMemberNotificationRoute?.()).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("preserves an absent member destination", async () => {
    mocks.fetch.mockResolvedValue({ route: null });
    await expect(port().resolveMemberNotificationRoute?.()).resolves.toBeNull();
  });
  it.each([null, {}, { route: {} }, { route: { ...route, delivery: { kind: "thread" } } }])(
    "rejects malformed control-plane routing", async (response) => {
      mocks.fetch.mockResolvedValue(response);
      await expect(port().resolveMemberNotificationRoute?.()).rejects.toThrow();
    },
  );
});
