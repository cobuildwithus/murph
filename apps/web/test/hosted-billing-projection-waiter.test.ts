import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  waitForHostedBillingProjectionForTest,
  waitForHostedFamilyProjectionForTest,
  type HostedBillingProjectionForTest,
  type HostedFamilyProjectionForTest,
} from "./support/hosted-billing-live-testkit";

type Projection = HostedBillingProjectionForTest | HostedFamilyProjectionForTest;
type OwnerSnapshot = Omit<HostedFamilyProjectionForTest, "billingStatus"> & {
  billingStatus: string;
};
type Membership = {
  group: { billingStatus: string; id: string; ownerMemberId: string };
  groupId: string;
  planCode: string;
  role: string;
  status: string;
};

const data = vi.hoisted(() => ({
  now: 0,
  delay: vi.fn<(milliseconds: number) => Promise<void>>(),
  disconnect: vi.fn<() => Promise<void>>(),
  member: vi.fn<() => Promise<{ billingStatus: string; id: string } | null>>(),
  billingRef: vi.fn<() => Promise<Partial<HostedBillingProjectionForTest> | null>>(),
  owner: vi.fn<() => Promise<OwnerSnapshot | null>>(),
  membership: vi.fn<() => Promise<Membership | null>>(),
  groupRef: vi.fn<() => Promise<Partial<HostedBillingProjectionForTest> | null>>(),
}));

vi.mock("node:timers/promises", () => ({ setTimeout: data.delay }));
vi.mock("../next-artifacts", () => ({
  createHostedWebSmokeEnvironment: (environment: NodeJS.ProcessEnv) => environment,
}));
vi.mock("@/src/lib/hosted-onboarding/billing-plans", () => ({
  HOSTED_PULSE_TRIAL_POLICY_VERSION: "unused",
}));
vi.mock("@/src/lib/prisma", () => ({
  createPrismaClient: () => ({
    $disconnect: data.disconnect,
    hostedMember: { findUnique: data.member },
  }),
}));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberStripeBillingRef: data.billingRef,
  writeHostedMemberStripeBillingRefTx: vi.fn(),
}));
vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  readHostedAccountGroupStripeBillingRef: data.groupRef,
  readHostedFamilyAccessForMember: data.membership,
  readHostedFamilyOwnerSnapshotForMember: data.owner,
}));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  createHostedMember: vi.fn(), upsertHostedMemberEmailAuthorization: vi.fn(),
}));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  upsertHostedMemberIdentity: vi.fn(),
}));
vi.mock("@/src/lib/hosted-onboarding/member-identity-fields", () => ({
  buildHostedMemberPhoneIdentityFields: vi.fn(),
}));
vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  provisionHostedCryptoDomainRootsForUserTx: vi.fn(),
}));
vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({ issueHostedInvite: vi.fn() }));

const input = {
  environment: { DATABASE_URL: "fixture", NODE_ENV: "test" } satisfies NodeJS.ProcessEnv,
  label: "projection proof",
  memberId: "private_member_canary",
};
const prefix = "Timed out waiting for local billing projection: projection proof.";
const billingAbsent = "status=not_started, plan=absent, phase=absent, customerPresent=false, subscriptionPresent=false, offer=absent, periodStartPresent=false, periodEndPresent=false, trialStartPresent=false, trialEndPresent=false, trialRedeemedPresent=false, scheduledPlan=absent, scheduledEffectivePresent=false, schedulePresent=false";
const familyAbsent = "status=absent, plan=absent, phase=absent, customerPresent=false, subscriptionPresent=false, groupPresent=false, ownerPresent=false, billingActive=inactive, memberPlan=absent, memberRole=absent, memberStatus=absent, memberCount=0, seatsPresent=false, activeSeats=absent, billedSeats=absent";

describe.sequential("hosted projection waiter diagnostics", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    data.now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => data.now);
    data.delay.mockImplementation(async (milliseconds) => { data.now += milliseconds; });
    data.disconnect.mockResolvedValue(undefined);
    data.member.mockResolvedValue({ billingStatus: "not_started", id: input.memberId });
    data.billingRef.mockResolvedValue(null);
    data.owner.mockResolvedValue(null);
    data.membership.mockResolvedValue(null);
    data.groupRef.mockResolvedValue(null);
  });
  afterEach(() => vi.restoreAllMocks());

  it("reports an absent billing reference without another read or delay", async () => {
    const error = await failure(waitForHostedBillingProjectionForTest({
      ...input, ready: () => false, timeoutMs: 0,
    }));
    expect(error.message).toBe(`${prefix} Last projection (${billingAbsent}).`);
    expect(error).not.toHaveProperty("cause");
    expect(data.member).toHaveBeenCalledOnce();
    expect(data.billingRef).toHaveBeenCalledOnce();
    expect(data.disconnect).toHaveBeenCalledOnce();
    expect(data.delay).not.toHaveBeenCalled();
  });

  it("reports the last differing state read at the deadline", async () => {
    data.member.mockResolvedValueOnce({ billingStatus: "not_started", id: input.memberId })
      .mockResolvedValue({ billingStatus: "past_due", id: input.memberId });
    const at = new Date("2040-02-03T04:05:06.000Z");
    data.billingRef.mockResolvedValueOnce(null).mockResolvedValue({
      currentBillingPhase: "trial", currentBillingPlanCode: "launch_edge_monthly",
      currentCheckoutOffer: "pulse_trial_7d", currentPeriodStart: at, currentPeriodEnd: at,
      currentTrialStartedAt: at, currentTrialEndsAt: at, pulseTrialRedeemedAt: at,
      scheduledBillingPlanCode: "launch_monthly", scheduledBillingEffectiveAt: at,
      stripeCustomerId: "private_customer_canary", stripeSubscriptionId: "private_subscription_canary",
      stripeSubscriptionScheduleId: "private_schedule_canary",
    });
    const ready = vi.fn((projection: HostedBillingProjectionForTest) =>
      projection.billingStatus === "active" && projection.currentBillingPhase === "paid"
      && projection.currentBillingPlanCode === "launch_monthly");
    const error = await failure(waitForHostedBillingProjectionForTest({
      ...input, ready, timeoutMs: 300,
    }));
    expect(error.message).toBe(`${prefix} Last projection (status=past_due, plan=launch_edge_monthly, phase=trial, customerPresent=true, subscriptionPresent=true, offer=pulse_trial_7d, periodStartPresent=true, periodEndPresent=true, trialStartPresent=true, trialEndPresent=true, trialRedeemedPresent=true, scheduledPlan=launch_monthly, scheduledEffectivePresent=true, schedulePresent=true).`);
    expect(error.message).not.toContain(at.toISOString());
    expect(error.message).not.toContain("private_");
    expect(data.member).toHaveBeenCalledTimes(2);
    expect(data.billingRef).toHaveBeenCalledTimes(2);
    expect(data.disconnect).toHaveBeenCalledTimes(2);
    expect(data.delay).toHaveBeenCalledExactlyOnceWith(300);
    expect(ready).toHaveBeenCalledTimes(3);
  });

  it("reports a missing Family without reading a nonexistent group's billing reference", async () => {
    const error = await failure(waitForHostedFamilyProjectionForTest({
      ...input, ready: () => false, timeoutMs: 0,
    }));
    expect(error.message).toBe(`${prefix} Last projection (${familyAbsent}).`);
    expect(data.owner).toHaveBeenCalledOnce();
    expect(data.membership).toHaveBeenCalledOnce();
    expect(data.groupRef).not.toHaveBeenCalled();
    expect(data.delay).not.toHaveBeenCalled();
  });

  it("reports useful Family state and only aggregate roster evidence", async () => {
    seedFamily();
    const error = await failure(waitForHostedFamilyProjectionForTest({
      ...input, ready: (projection) => projection.seats?.billed === 3, timeoutMs: 0,
    }));
    expect(error.message).toBe(`${prefix} Last projection (status=active, plan=launch_family_monthly, phase=paid, customerPresent=true, subscriptionPresent=true, groupPresent=true, ownerPresent=true, billingActive=active, memberPlan=pulse, memberRole=member, memberStatus=active, memberCount=2, seatsPresent=true, activeSeats=1, billedSeats=2).`);
    expect(error.message).not.toContain("private_");
    expect(data.groupRef).toHaveBeenCalledOnce();
  });

  it("closes every billing enum even when the data seam returns arbitrary runtime strings", async () => {
    data.member.mockResolvedValue({ billingStatus: "private_status_canary", id: input.memberId });
    data.billingRef.mockResolvedValue({
      currentBillingPhase: "private_phase_canary", currentBillingPlanCode: "private_plan_canary",
      currentCheckoutOffer: "private_offer_canary", scheduledBillingPlanCode: "private_scheduled_canary",
      stripeCustomerId: "private_customer_canary", stripeSubscriptionId: "private_subscription_canary",
      stripeSubscriptionScheduleId: "private_schedule_canary",
    });
    const error = await failure(waitForHostedBillingProjectionForTest({
      ...input, ready: () => false, timeoutMs: 0,
    }));
    expect(error.message).toBe(`${prefix} Last projection (status=unknown, plan=unknown, phase=unknown, customerPresent=true, subscriptionPresent=true, offer=unknown, periodStartPresent=false, periodEndPresent=false, trialStartPresent=false, trialEndPresent=false, trialRedeemedPresent=false, scheduledPlan=unknown, scheduledEffectivePresent=false, schedulePresent=true).`);
    expect(error.message).not.toContain("private_");
  });

  it("closes Family enums and never serializes member array values", async () => {
    const owner = seedFamily();
    data.owner.mockResolvedValue({ ...owner, billingStatus: "private_status_canary" });
    data.groupRef.mockResolvedValue({
      currentBillingPhase: "private_phase_canary", currentBillingPlanCode: "private_plan_canary",
      stripeCustomerId: "private_customer_canary", stripeSubscriptionId: "private_subscription_canary",
    });
    data.membership.mockResolvedValue({
      group: { billingStatus: "active", id: "private_group_canary", ownerMemberId: "private_owner_canary" },
      groupId: "private_group_canary", planCode: "private_member_plan_canary",
      role: "private_member_role_canary", status: "private_member_status_canary",
    });
    const error = await failure(waitForHostedFamilyProjectionForTest({
      ...input, ready: () => false, timeoutMs: 0,
    }));
    expect(error.message).toBe(`${prefix} Last projection (status=unknown, plan=unknown, phase=unknown, customerPresent=true, subscriptionPresent=true, groupPresent=true, ownerPresent=true, billingActive=active, memberPlan=unknown, memberRole=unknown, memberStatus=unknown, memberCount=2, seatsPresent=true, activeSeats=1, billedSeats=2).`);
    expect(error.message).not.toContain("private_");
  });

  it.each([
    [0, "0"], [99, "99"], [100, "100+"], [Number.MAX_SAFE_INTEGER, "100+"],
    [-1, "unknown"], [0.5, "unknown"], [NaN, "unknown"], [Infinity, "unknown"],
    [Number.MAX_SAFE_INTEGER + 1, "unknown"],
  ] as const)("bounds seat counts from %s to %s", async (count, expected) => {
    const owner = seedFamily();
    data.owner.mockResolvedValue({
      ...owner, members: Array.from({ length: 101 }, () => privateMember()),
      seats: { active: count, billed: count, invited: count, remaining: count, used: count },
    });
    const error = await failure(waitForHostedFamilyProjectionForTest({
      ...input, ready: () => false, timeoutMs: 0,
    }));
    expect(error.message).toContain(`memberCount=100+, seatsPresent=true, activeSeats=${expected}, billedSeats=${expected}`);
    expect(error.message).not.toContain("private_");
  });

  const owners = [
    { name: "billing", read: data.billingRef,
      wait: (ready: (projection: Projection) => boolean, timeoutMs = 600) =>
        waitForHostedBillingProjectionForTest({ ...input, ready, timeoutMs }) },
    { name: "family", read: data.owner,
      wait: (ready: (projection: Projection) => boolean, timeoutMs = 600) =>
        waitForHostedFamilyProjectionForTest({ ...input, ready, timeoutMs }) },
  ];
  for (const owner of owners) {
    it.each([false, true])(`preserves ${owner.name} success identity (delayed=%s)`, async (delayed) => {
      const ready = vi.fn<(projection: Projection) => boolean>().mockReturnValue(true);
      if (delayed) ready.mockReturnValueOnce(false);
      const result = await owner.wait(ready, delayed ? 600 : 0);
      expect(result).toBe(ready.mock.calls.at(-1)?.[0]);
      expect(ready).toHaveBeenCalledTimes(delayed ? 3 : 2);
      expect(owner.read).toHaveBeenCalledTimes(delayed ? 2 : 1);
      expect(data.disconnect).toHaveBeenCalledTimes(delayed ? 2 : 1);
      expect(data.delay.mock.calls).toEqual(delayed ? [[300]] : []);
      if (delayed) expect(result).not.toBe(ready.mock.calls[0]?.[0]);
    });

    it.each([false, true])(`preserves ${owner.name} read rejection identity (delayed=%s)`, async (delayed) => {
      const error = new Error("private_read_failure_canary");
      if (delayed) owner.read.mockResolvedValueOnce(null);
      owner.read.mockRejectedValueOnce(error);
      const ready = vi.fn<(projection: Projection) => boolean>().mockReturnValue(false);
      await expect(owner.wait(ready)).rejects.toBe(error);
      expect(owner.read).toHaveBeenCalledTimes(delayed ? 2 : 1);
      expect(ready).toHaveBeenCalledTimes(delayed ? 1 : 0);
      expect(data.delay.mock.calls).toEqual(delayed ? [[300]] : []);
    });

    it.each([false, true])(`preserves ${owner.name} predicate rejection identity (final=%s)`, async (final) => {
      const error = new Error("private_predicate_failure_canary");
      const ready = vi.fn<(projection: Projection) => boolean>(() => { throw error; });
      if (final) ready.mockReturnValueOnce(false);
      await expect(owner.wait(ready, 0)).rejects.toBe(error);
      expect(owner.read).toHaveBeenCalledOnce();
      expect(ready).toHaveBeenCalledTimes(final ? 2 : 1);
      expect(data.delay).not.toHaveBeenCalled();
    });
  }
});

function privateMember(): HostedFamilyProjectionForTest["members"][number] {
  return {
    isOwner: false, memberId: "private_roster_member_canary", planCode: "private_roster_plan_canary",
    role: "private_roster_role_canary", status: "private_roster_status_canary",
  };
}

function seedFamily(): OwnerSnapshot {
  const owner: OwnerSnapshot = {
    billingActive: true, billingStatus: "active", currentBillingPhase: "paid",
    currentBillingPlanCode: "launch_family_monthly", groupId: "private_group_canary",
    memberPlanCode: "pulse", memberRole: "member", memberStatus: "active",
    members: [privateMember(), privateMember()], ownerMemberId: "private_owner_canary",
    seats: { active: 1, billed: 2, invited: 1, remaining: 0, used: 2 },
    stripeCustomerId: "private_customer_canary", stripeSubscriptionId: "private_subscription_canary",
  };
  data.owner.mockResolvedValue(owner);
  data.groupRef.mockResolvedValue({
    currentBillingPhase: owner.currentBillingPhase, currentBillingPlanCode: owner.currentBillingPlanCode,
    stripeCustomerId: owner.stripeCustomerId, stripeSubscriptionId: owner.stripeSubscriptionId,
  });
  data.membership.mockResolvedValue({
    group: { billingStatus: "active", id: "private_group_canary", ownerMemberId: "private_owner_canary" },
    groupId: "private_group_canary", planCode: "pulse", role: "member", status: "active",
  });
  return owner;
}

async function failure(result: Promise<unknown>): Promise<Error> {
  try { await result; } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("Expected the projection waiter to fail.");
}
