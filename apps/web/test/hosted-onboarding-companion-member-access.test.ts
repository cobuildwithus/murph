import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), consent: vi.fn(), completion: vi.fn(), timeZone: vi.fn(),
  access: vi.fn(), requireAccess: vi.fn(), enroll: vi.fn(), wake: vi.fn(), prisma: vi.fn(),
}));
vi.mock("@/src/lib/better-auth/native-auth", () => ({ readHostedNativeMemberAuth: mocks.auth }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.prisma }));
vi.mock("@/src/lib/legal/consent", () => ({ assertHostedHistoricalLaunchConsentGranted: mocks.consent }));
vi.mock("@/src/lib/hosted-onboarding/authentication-completion", () => ({ readHostedAuthenticationCompletion: mocks.completion }));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({ updateHostedMemberPendingActivationTimeZoneIfActivationPending: mocks.timeZone }));
vi.mock("@/src/lib/hosted-onboarding/starter-usage-enrollment-service", () => ({
  ensureHostedStarterUsageEnrollment: mocks.enroll, retryPendingHostedStarterUsageActivationRuntimeWake: mocks.wake,
}));
vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.access, assertActiveHostedMemberAccessAllowed: mocks.requireAccess,
}));
import { POST } from "../app/api/device-sync/companion/admission/route";
import { requireHostedCompanionMemberIdFromRequest } from "@/src/lib/hosted-onboarding/companion-member-access";

const prisma = { label: "canonical-member-test" } as never;
const member = { id: "member_native", billingStatus: HostedBillingStatus.not_started, suspendedAt: null,
  createdAt: new Date("2026-09-09T12:00:00Z"), updatedAt: new Date("2026-09-09T12:00:00Z") };
const completion = { member, memberId: member.id, inviteCode: "invite_native", stage: "checkout" };
function request() { return new Request("https://www.withmurph.ai/api/device-sync/companion/admission", {
  method: "POST", headers: { authorization: `Bearer murph_auth_v1.${"a".repeat(32)}` },
}); }
function denied(code: string, httpStatus = 403, retryable = false) {
  return hostedOnboardingError({ code, httpStatus, retryable, message: "Synthetic admission failure." });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.prisma.mockReturnValue(prisma);
  mocks.auth.mockResolvedValue({ kind: "better-auth", member });
  mocks.completion.mockResolvedValue(completion);
  mocks.access.mockResolvedValue(false);
  mocks.wake.mockResolvedValue(null);
});

describe("native companion canonical admission", () => {
  it("uses the authenticated member and canonical consent, timezone and Starter owners", async () => {
    const input = { prisma, request: request(), timeZone: "Europe/London" };
    await expect(requireHostedCompanionMemberIdFromRequest(input)).resolves.toBe(member.id);
    expect(mocks.auth).toHaveBeenCalledWith(input.request, prisma);
    expect(mocks.timeZone).toHaveBeenCalledWith({ memberId: member.id, pendingActivationTimeZone: "Europe/London", prisma });
    expect(mocks.consent.mock.invocationCallOrder[0]).toBeLessThan(mocks.timeZone.mock.invocationCallOrder[0]);
    expect(mocks.completion).toHaveBeenCalledWith({ member, prisma });
    expect(mocks.enroll).toHaveBeenCalledWith({ inviteCode: "invite_native", member: { id: member.id, suspendedAt: null },
      now: expect.any(Date), prisma, source: "companion_onboarding" });
    expect(mocks.requireAccess).toHaveBeenCalledWith({ memberId: member.id, prisma });
  });

  it("stops at missing consent before completion, timezone changes or grants", async () => {
    mocks.consent.mockRejectedValue(denied("HOSTED_CONSENT_REQUIRED"));
    await expect(requireHostedCompanionMemberIdFromRequest({ request: request(), prisma, timeZone: "UTC" }))
      .rejects.toMatchObject({ code: "HOSTED_CONSENT_REQUIRED" });
    expect(mocks.timeZone).not.toHaveBeenCalled();
    expect(mocks.completion).not.toHaveBeenCalled();
    expect(mocks.enroll).not.toHaveBeenCalled();
  });

  it("returns the fixed response for an active member and retries its pending wake", async () => {
    mocks.access.mockResolvedValue(true);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.enroll).not.toHaveBeenCalled();
    expect(mocks.completion).not.toHaveBeenCalled();
    expect(mocks.wake).toHaveBeenCalledWith({ memberId: member.id, prisma });
  });

  it("keeps admission retryable until the activation wake is accepted", async () => {
    mocks.access.mockResolvedValue(true); mocks.wake.mockResolvedValue({ accepted: false });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "COMPANION_ADMISSION_RETRYABLE", retryable: true } });
    expect(mocks.enroll).not.toHaveBeenCalled();
  });

  it.each(Object.values(HostedBillingStatus).filter((status) => status !== HostedBillingStatus.not_started))(
    "does not reinterpret %s billing as fresh Starter access", async (billingStatus) => {
      mocks.auth.mockResolvedValue({ kind: "better-auth", member: { ...member, billingStatus } });
      mocks.requireAccess.mockRejectedValue(denied("HOSTED_ACCESS_REQUIRED"));
      expect((await POST(request())).status).toBe(403);
      expect(mocks.enroll).not.toHaveBeenCalled();
    },
  );

  it.each([["AUTH_REQUIRED", 401], ["AUTH_CLIENT_UPGRADE_REQUIRED", 426], ["HOSTED_MEMBER_SUSPENDED", 403]] as const)(
    "preserves %s recovery without product writes", async (code, status) => {
      mocks.auth.mockRejectedValue(denied(code, status));
      const response = await POST(request());
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
      expect(mocks.completion).not.toHaveBeenCalled();
      expect(mocks.enroll).not.toHaveBeenCalled();
    },
  );

  it("maps blocked Starter enrollment to existing access recovery", async () => {
    mocks.enroll.mockRejectedValue(denied("HOSTED_STARTER_USAGE_ENROLLMENT_BLOCKED", 409));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "HOSTED_ACCESS_REQUIRED" } });
    expect(mocks.requireAccess).not.toHaveBeenCalled();
  });
});
