import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ active: vi.fn(), any: vi.fn(), register: vi.fn(), remove: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireActiveHostedMemberAuthFromBearerToken: m.active,
  requireHostedMemberAuthFromBearerToken: m.any,
}));
vi.mock("@/src/lib/companion/push-route", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/companion/push-route")>(),
  deleteCompanionPushRoute: m.remove,
  registerCompanionPushRoute: m.register,
}));
import { DELETE, POST } from "../app/api/companion/push-route/route";

const installationId = "00000000-0000-4000-8000-0000000000a1";
const registration = { alertsAllowed: false, environment: "production", installationId, token: "ab".repeat(32), topic: "ai.withmurph.app" };
const request = (method: string, body: unknown) => new Request("https://backend.test/api/companion/push-route", {
  body: JSON.stringify(body), headers: { "content-type": "application/json" }, method,
});

describe("companion push route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.active.mockResolvedValue({ member: { id: "member-bound" } });
    m.any.mockResolvedValue({ member: { id: "member-bound" } });
  });

  it("registers only an allowlisted bundle for the active authenticated member", async () => {
    expect((await POST(request("POST", registration))).status).toBe(200);
    expect(m.register).toHaveBeenCalledExactlyOnceWith("member-bound", registration);
    m.register.mockClear();
    for (const invalid of [
      { ...registration, topic: "com.example.other" },
      { ...registration, token: "not-a-token" },
      { ...registration, memberId: "other" },
    ]) {
      expect((await POST(request("POST", invalid))).status).toBe(400);
    }
    expect(m.register).not.toHaveBeenCalled();
    m.active.mockRejectedValue(new Error("synthetic inactive member"));
    expect((await POST(request("POST", registration))).status).toBeGreaterThanOrEqual(400);
    expect(m.register).not.toHaveBeenCalled();
  });

  it("deletes an exact installation route without requiring active access", async () => {
    m.active.mockRejectedValue(new Error("synthetic inactive member"));
    expect((await DELETE(request("DELETE", { installationId }))).status).toBe(200);
    expect(m.remove).toHaveBeenCalledExactlyOnceWith("member-bound", installationId);
    expect(m.active).not.toHaveBeenCalled();
  });
});
