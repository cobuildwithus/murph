import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ bearer: vi.fn(), callback: vi.fn(), record: vi.fn(), read: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({ requireActiveHostedMemberAuthFromBearerToken: m.bearer }));
vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({ requireHostedCloudflareCallbackJsonRequest: m.callback }));
vi.mock("@/src/lib/companion/presence", () => ({ recordCompanionHeartbeat: m.record, readRuntimeCompanionPresence: m.read }));
import { POST as heartbeat } from "../app/api/companion/heartbeat/route";
import { POST as presence } from "../app/api/internal/companion/presence/route";
const request = (body: unknown, headers: Record<string, string> = {}) => new Request("https://backend.test/api/companion/heartbeat", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
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
    expect(m.record).toHaveBeenCalledExactlyOnceWith("member-bound", "background", null);
    m.record.mockClear();
    expect((await heartbeat(request({ state: "foreground", memberId: "other" }))).status).toBe(400);
    expect((await heartbeat(request({ state: "x".repeat(200) }))).status).toBeGreaterThanOrEqual(400);
    expect(m.record).not.toHaveBeenCalled();
  });
  it("passes validated client headers to the existing heartbeat writer", async () => {
    const response = await heartbeat(request({ state: "foreground" }, {
      "X-Murph-Client-Platform": "android", "X-Murph-Client-Version": "0.1.3-dev", "X-Murph-Client-Build": "109",
      "X-Murph-Client-OS-Version": "15", "X-Murph-Client-Device-Model": "Pixel 8 Pro",
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recorded: true });
    expect(m.record).toHaveBeenCalledExactlyOnceWith("member-bound", "foreground", {
      platform: "android", version: "0.1.3-dev", build: "109", osVersion: "15", deviceModel: "Pixel 8 Pro",
    });
  });
  it.each<Record<string, string>>([{}, { "X-Murph-Client-Platform": "unknown", "X-Murph-Client-Version": "bad", "X-Murph-Client-Build": "109" }])(
    "records contact when client headers are absent or invalid", async (headers) => {
      const response = await heartbeat(request({ state: "foreground" }, headers));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ recorded: true });
      expect(m.record).toHaveBeenCalledExactlyOnceWith("member-bound", "foreground", null);
    },
  );
  it("uses signed callback identity and rejects unauthenticated native writes", async () => {
    expect((await presence(request({}))).status).toBe(200);
    expect(m.read).toHaveBeenCalledExactlyOnceWith("member-bound", null);
    expect(m.callback).toHaveBeenCalledWith(expect.any(Request), { maxBodyBytes: 128, runtimeAuthority: "caller_transaction" });
    m.bearer.mockRejectedValue(new Error("synthetic auth failure"));
    expect((await heartbeat(request({ state: "foreground" }))).status).toBeGreaterThanOrEqual(400);
    expect(m.record).not.toHaveBeenCalled();
  });
  it("returns the domain reason when companion access requires a private conversation", async () => {
    m.read.mockRejectedValueOnce(hostedOnboardingError({
      code: "INVALID_REQUEST", httpStatus: 400,
      message: "Companion access requires a private member conversation.",
    }));
    const response = await presence(request({}));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: {
      code: "INVALID_REQUEST", message: "Companion access requires a private member conversation.", retryable: false,
    } });
  });
  it("rejects malformed heartbeat JSON after authentication", async () => {
    const response = await heartbeat(new Request("https://example.test/heartbeat", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "INVALID_JSON", message: "Invalid JSON." } });
    expect(m.bearer).toHaveBeenCalledOnce();
    expect(m.record).not.toHaveBeenCalled();
  });
});
