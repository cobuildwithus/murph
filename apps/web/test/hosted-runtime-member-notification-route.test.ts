import { beforeEach, describe, expect, it, vi } from "vitest";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), resolve: vi.fn() }));
vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackJsonRequest: mocks.auth,
}));
vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", () => ({
  resolveHostedAssistantNotificationDestination: mocks.resolve,
}));
import { POST } from "../app/api/internal/hosted-runtime/member-notification-route/route";

const route = {
  actorId: null, channel: "telegram", delivery: { kind: "thread", target: "synthetic-chat" },
  identityId: "synthetic-identity", threadId: "synthetic-chat", threadIsDirect: true,
};
function request(authority = true) {
  const query = authority ? "?runtimeAuthority=1&runtimeAttempt=rt_synthetic&runtimeGeneration=7" : "";
  return new Request(`https://example.test/api/internal/hosted-runtime/member-notification-route${query}`, {
    method: "POST", body: "{}", headers: { "content-type": "application/json" },
  });
}
describe("member notification route authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: "member-synthetic", payload: {} });
    mocks.resolve.mockResolvedValue({ conversationShape: "direct-member", route });
  });
  it("resolves only the authenticated member after runtime verification", async () => {
    const req = request();
    const response = await POST(req);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ route });
    expect(mocks.auth).toHaveBeenCalledWith(req, { maxBodyBytes: 1024 });
    expect(mocks.resolve).toHaveBeenCalledWith({ memberId: "member-synthetic", signal: req.signal });
  });
  it("does not read a destination for a stale or unauthenticated runtime", async () => {
    mocks.auth.mockRejectedValueOnce(hostedOnboardingError({
      code: "STALE_RUNTIME", httpStatus: 403, message: "Stale runtime.",
    }));
    expect((await POST(request())).status).toBe(403);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("requires runtime authority on a signed callback", async () => {
    expect((await POST(request(false))).status).toBe(403);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it.each([null, { userId: "other-member" }, { deliveryTarget: "other-chat" }, []])(
    "rejects payload overrides before reading routing", async (payload) => {
      mocks.auth.mockResolvedValueOnce({ userId: "member-synthetic", payload });
      expect((await POST(request())).status).toBe(400);
      expect(mocks.resolve).not.toHaveBeenCalled();
    },
  );
  it.each([
    null,
    { conversationShape: "thread-container", route },
    { conversationShape: "direct-member", route: { ...route, threadIsDirect: false } },
  ])("does not fall back to a group or absent destination", async (destination) => {
    mocks.resolve.mockResolvedValueOnce(destination);
    expect(await (await POST(request())).json()).toEqual({ route: null });
  });
});
