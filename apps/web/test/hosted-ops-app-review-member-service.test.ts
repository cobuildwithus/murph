import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ email: vi.fn(), phone: vi.fn(), prepareRoots: vi.fn(), activate: vi.fn(),
  materialize: vi.fn(), consent: vi.fn(), readConsent: vi.fn() }));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({ lookupHostedMemberByVerifiedEmailAddress: mocks.email }));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({ lookupHostedMemberIdentityByPhoneNumber: mocks.phone }));
vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({ prepareHostedCryptoDomainRootCandidates: mocks.prepareRoots }));
vi.mock("@/src/lib/hosted-onboarding/member-activation", () => ({ activateHostedMemberForPositiveSourceTx: mocks.activate }));
vi.mock("@/src/lib/hosted-groups/group-join-confirmation", () => ({ materializePendingHostedGroupJoinConfirmationsBestEffort: mocks.materialize }));
vi.mock("@/src/lib/legal/consent", () => ({ recordHostedLaunchRequiredConsent: mocks.consent, readHostedConsentStatus: mocks.readConsent }));
import { prepareHostedOpsAppReviewMember } from "@/src/lib/hosted-ops/app-review-member";

const now = new Date("2026-09-10T12:00:00Z");
const member = { id: "member_review_fixture", billingStatus: "not_started", suspendedAt: null, createdAt: now, updatedAt: now };
const principal = { kind: "email" as const, value: "reviewer@example.test" };
function fixture() {
  const tx = { label: "database-only-activation" };
  return {
    tx,
    $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
    hostedAuthRecord: { findUnique: vi.fn().mockResolvedValue({ id: member.id }) },
    hostedConsentGrant: { findMany: vi.fn().mockResolvedValue([]) },
    hostedMember: { findUniqueOrThrow: vi.fn().mockResolvedValue(member) },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.email.mockResolvedValue({ core: member });
  mocks.phone.mockResolvedValue({ core: member, identity: { phoneNumberVerifiedAt: now } });
  mocks.prepareRoots.mockResolvedValue(new Map());
  mocks.activate.mockResolvedValue({ activated: true });
  mocks.readConsent.mockResolvedValue({ launchScopes: [{ scope: "launch.legal", granted: true }, { scope: "launch.health-data", granted: true }] });
});

describe("existing App Review account preparation", () => {
  it("keeps dry-run read-only and redacts its account summary", async () => {
    const prisma = fixture();
    const summary = await prepareHostedOpsAppReviewMember({ mode: "dry-run", principal, prisma: prisma as never });
    expect(summary).toMatchObject({ action: "dry-run", principal: "email:r***@example.test", consentGranted: false });
    expect(JSON.stringify(summary)).not.toContain(principal.value);
    expect(JSON.stringify(summary)).not.toContain(member.id);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prepareRoots).not.toHaveBeenCalled();
    expect(mocks.consent).not.toHaveBeenCalled();
  });

  it.each(["missing-member", "missing-auth-user", "unverified-phone"] as const)("requires ordinary sign-in for %s", async (state) => {
    const prisma = fixture();
    if (state === "missing-member") mocks.email.mockResolvedValue(null);
    if (state === "missing-auth-user") prisma.hostedAuthRecord.findUnique.mockResolvedValue(null);
    if (state === "unverified-phone") mocks.phone.mockResolvedValue({ core: member, identity: { phoneNumberVerifiedAt: null } });
    await expect(prepareHostedOpsAppReviewMember({ mode: "apply", principal: state === "unverified-phone" ? { kind: "phone", value: "+12025550123" } : principal, prisma: prisma as never }))
      .rejects.toMatchObject({ code: "APP_REVIEW_SIGN_IN_REQUIRED" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prepareRoots).not.toHaveBeenCalled();
    expect(mocks.consent).not.toHaveBeenCalled();
  });

  it("cannot revive a suspended account", async () => {
    const prisma = fixture(); mocks.email.mockResolvedValue({ core: { ...member, suspendedAt: now } });
    await expect(prepareHostedOpsAppReviewMember({ mode: "apply", principal, prisma: prisma as never }))
      .rejects.toMatchObject({ code: "HOSTED_MEMBER_SUSPENDED" });
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("prepares crypto outside the transaction and reuses the canonical idempotent activation owner", async () => {
    const prisma = fixture(), roots = new Map(); mocks.prepareRoots.mockResolvedValue(roots);
    const input = { mode: "apply" as const, principal, now, prisma: prisma as never };
    await expect(prepareHostedOpsAppReviewMember(input)).resolves.toMatchObject({ action: "applied", activated: true, consentGranted: true });
    expect(mocks.prepareRoots).toHaveBeenCalledWith({ prisma, userId: member.id });
    expect(mocks.prepareRoots.mock.invocationCallOrder[0]).toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0]);
    expect(mocks.activate).toHaveBeenCalledWith({ memberId: member.id, preparedCryptoDomainRoots: roots, prisma: prisma.tx,
      skipIfBillingAlreadyActive: true, skipIfPreviouslyActivated: true,
      dispatchContext: { eventCreatedAt: now, occurredAt: now.toISOString(), sourceEventId: `app-store-review:${member.id}`, sourceType: "hosted.app_store_review" } });
    expect(mocks.consent.mock.calls.map(([input]) => input.scope)).toEqual(["launch.legal", "launch.health-data"]);
    await prepareHostedOpsAppReviewMember(input);
    expect(mocks.activate.mock.calls[0][0].dispatchContext).toEqual(mocks.activate.mock.calls[1][0].dispatchContext);
  });

  it("does not grant consent or dispatch follow-up work when activation fails", async () => {
    mocks.activate.mockRejectedValue(new Error("activation failed"));
    await expect(prepareHostedOpsAppReviewMember({ mode: "apply", principal, prisma: fixture() as never })).rejects.toThrow("activation failed");
    expect(mocks.materialize).not.toHaveBeenCalled(); expect(mocks.consent).not.toHaveBeenCalled();
  });
});
