import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ bearer: vi.fn(), callback: vi.fn(), record: vi.fn(), read: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({ requireActiveHostedMemberAuthFromBearerToken: m.bearer }));
vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({ requireHostedCloudflareCallbackJsonRequest: m.callback }));
vi.mock("@/src/lib/companion/presence", () => ({ recordCompanionHeartbeat: m.record, readRuntimeCompanionPresence: m.read }));
import { POST as heartbeat } from "../app/api/companion/heartbeat/route";
import { POST as presence } from "../app/api/internal/companion/presence/route";
const request = (body: unknown) => new Request("https://backend.test/api/companion/heartbeat", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
describe("companion presence route authority", () => {
  beforeEach(() => {
    vi.resetAllMocks(); m.bearer.mockResolvedValue({ member: { id: "member-bound" } });
    m.callback.mockResolvedValue({ userId: "member-bound", payload: {} });
    m.read.mockResolvedValue({ status: "unknown", lastContactAt: null, lastForegroundAt: null });
  });
  it("accepts only a bounded lifecycle state and uses the authenticated member", async () => {
    const response = await heartbeat(request({ state: "background" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(m.record).toHaveBeenCalledExactlyOnceWith("member-bound", "background");
    m.record.mockClear();
    expect((await heartbeat(request({ state: "foreground", memberId: "other" }))).status).toBe(400);
    expect((await heartbeat(request({ state: "x".repeat(200) }))).status).toBeGreaterThanOrEqual(400);
    expect(m.record).not.toHaveBeenCalled();
  });
  it("uses signed callback identity and rejects unauthenticated native writes", async () => {
    expect((await presence(request({}))).status).toBe(200);
    expect(m.read).toHaveBeenCalledExactlyOnceWith("member-bound", null);
    expect(m.callback).toHaveBeenCalledWith(expect.any(Request), { maxBodyBytes: 128, runtimeAuthority: "caller_transaction" });
    m.bearer.mockRejectedValue(new Error("synthetic auth failure"));
    expect((await heartbeat(request({ state: "foreground" }))).status).toBeGreaterThanOrEqual(400);
    expect(m.record).not.toHaveBeenCalled();
  });
});
