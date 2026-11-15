import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), origin: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(),
}));
vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({ requireActiveHostedAppSessionFromRequest: mocks.session }));
vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({ assertHostedOnboardingMutationOrigin: mocks.origin }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({ hostedMember: mocks }) }));

import { POST } from "../app/api/ops/member-suspension/route";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

function request(body: unknown) {
  return new Request("https://www.withmurph.ai/api/ops/member-suspension", {
    method: "POST", headers: { origin: "https://www.withmurph.ai", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Ops member suspension", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("HOSTED_OPS_MEMBER_IDS", "hbm_operator");
    mocks.session.mockResolvedValue({ member: { id: "hbm_operator" } });
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["suspend", "restore"])("authenticates and commits %s", async (operation) => {
    const response = await POST(request({ memberId: "hbm_target", operation }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ suspended: operation === "suspend" });
    expect(mocks.origin).toHaveBeenCalledOnce();
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "hbm_target", threadContainer: { is: null }, suspendedAt: operation === "suspend" ? null : { not: null } },
      data: { suspendedAt: operation === "suspend" ? expect.any(Date) : null },
    });
  });

  it.each(["suspend", "restore"])("allows repeated %s", async (operation) => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findFirst.mockResolvedValue({ id: "hbm_target" });
    expect((await POST(request({ memberId: "hbm_target", operation }))).status).toBe(200);
  });

  it("rejects containers and missing members", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findFirst.mockResolvedValue(null);
    expect((await POST(request({ memberId: "hbm_container", operation: "suspend" }))).status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: "hbm_container", threadContainer: { is: null } }, select: { id: true } });
  });

  it.each([
    { memberId: "bad", operation: "suspend" },
    { memberId: "hbm_target", operation: "toggle" },
    { memberId: "hbm_target" },
  ])("rejects invalid mutation input", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a signed-out request", async () => {
    mocks.session.mockRejectedValue(hostedOnboardingError({ code: "AUTH_REQUIRED", httpStatus: 401, message: "Sign in." }));
    expect((await POST(request({ memberId: "hbm_target", operation: "suspend" }))).status).toBe(401);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a non-Ops member", async () => {
    mocks.session.mockResolvedValue({ member: { id: "hbm_other" } });
    expect((await POST(request({ memberId: "hbm_target", operation: "suspend" }))).status).toBe(404);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an untrusted origin", async () => {
    mocks.origin.mockImplementation(() => { throw hostedOnboardingError({ code: "ORIGIN_DENIED", httpStatus: 403, message: "Origin denied." }); });
    expect((await POST(request({ memberId: "hbm_target", operation: "suspend" }))).status).toBe(403);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
