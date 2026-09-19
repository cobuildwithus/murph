import { beforeEach, describe, expect, it, vi } from "vitest";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({ access: vi.fn(), deletion: vi.fn(), prisma: {} }));
vi.mock("@/src/lib/hosted-ops/access", () => ({ requireHostedOpsRequestAccess: mocks.access }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@/src/lib/hosted-privacy/account-data-service", () => ({ deleteHostedAccountData: mocks.deletion }));
const { POST } = await import("../app/api/ops/auth-migration/unused-signup/route");
const body = { memberId: "synthetic-unused-signup", createdAt: "2026-01-01T12:00:00.000Z", confirmation: "DELETE UNUSED SIGNUP" };
function request(value: unknown = body) {
  return new Request("https://www.withmurph.ai/api/ops/auth-migration/unused-signup", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://www.withmurph.ai" }, body: JSON.stringify(value),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({});
  mocks.deletion.mockResolvedValue({ cleanupPending: true, memberId: body.memberId, vendorAccounts: { private: "omitted" } });
});

describe("Ops unused-signup deletion", () => {
  it("requires Ops and same-origin authority before reading input or deleting", async () => {
    mocks.access.mockRejectedValue(hostedOnboardingError({ code: "HOSTED_OPS_ACCESS_DENIED", httpStatus: 404, message: "Unavailable." }));
    expect((await POST(request())).status).toBe(404);
    expect(mocks.access).toHaveBeenCalledWith(expect.any(Request), { requireMutationOrigin: true });
    expect(mocks.deletion).not.toHaveBeenCalled();
  });
  it.each([
    { ...body, confirmation: "delete" }, { ...body, createdAt: "yesterday" },
    { ...body, memberId: "" }, { ...body, extra: true }, { confirmation: body.confirmation },
  ])("rejects missing or ambiguous explicit targeting: %j", async (value) => {
    expect((await POST(request(value))).status).toBe(400);
    expect(mocks.deletion).not.toHaveBeenCalled();
  });
  it("calls canonical deletion with the immutable target and reports pending cleanup without private output", async () => {
    const req = request();
    const response = await POST(req);
    expect(response.status).toBe(200);
    expect(mocks.deletion).toHaveBeenCalledWith({ memberId: body.memberId, unusedSignupCreatedAt: new Date(body.createdAt),
      prisma: mocks.prisma, request: req, exitFeedback: null });
    expect(await response.json()).toEqual({ deleted: true, cleanupPending: true });
  });
  it("propagates a changed-account refusal without claiming deletion", async () => {
    mocks.deletion.mockRejectedValue(hostedOnboardingError({ code: "UNUSED_SIGNUP_CHANGED", httpStatus: 409, message: "Changed." }));
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("deleted", true);
  });
});
