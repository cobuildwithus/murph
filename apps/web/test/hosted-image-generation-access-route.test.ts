import { beforeEach, expect, it, vi } from "vitest";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn() }));
vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({ requireHostedCloudflareCallbackJsonRequest: mocks.auth }));
vi.mock("@/src/lib/hosted-onboarding/image-generation-access", () => ({ readHostedImageGenerationAccess: mocks.access }));
import { POST } from "@/app/api/internal/hosted-execution/image-generation/access/route";
beforeEach(() => vi.resetAllMocks());
it("uses only the signed member binding despite body claims", async () => {
  mocks.auth.mockResolvedValue({ userId: "member_bound", payload: { userId: "member_other", allowed: true } });
  mocks.access.mockResolvedValue({ allowed: false, reason: "card_required" });
  const response = await POST(new Request("https://web.example.test/api/internal/hosted-execution/image-generation/access", { method: "POST" }));
  expect(response.status).toBe(200);
  expect(mocks.access).toHaveBeenCalledWith({ memberId: "member_bound" });
});
it("rejects unsigned access before reading billing", async () => {
  mocks.auth.mockRejectedValue(hostedOnboardingError({ code: "AUTH_REQUIRED", httpStatus: 401, message: "Authentication required." }));
  expect((await POST(new Request("https://web.example.test/api/internal/hosted-execution/image-generation/access", { method: "POST" }))).status).toBe(401);
  expect(mocks.access).not.toHaveBeenCalled();
});
