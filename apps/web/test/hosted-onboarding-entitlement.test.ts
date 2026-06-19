import { HostedBillingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  assertHostedMemberActiveAccessAllowed,
  deriveHostedEntitlement,
  hasHostedMemberActiveAccess,
  hasHostedMemberGeneralAccess,
} from "@/src/lib/hosted-onboarding/entitlement";
import {
  hasHostedMemberEffectiveActiveAccess,
} from "@/src/lib/hosted-onboarding/family-plan";

describe("hosted onboarding entitlement", () => {
  it("requires active billing plus a non-suspended member for active access", () => {
    expect(hasHostedMemberActiveAccess({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
    })).toBe(true);

    expect(hasHostedMemberActiveAccess({
      billingStatus: HostedBillingStatus.past_due,
      suspendedAt: null,
    })).toBe(false);

    expect(hasHostedMemberActiveAccess({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: new Date("2026-04-06T10:00:00.000Z"),
    })).toBe(false);
  });

  it("keeps general access broader than active access without allowing suspended members", () => {
    expect(hasHostedMemberGeneralAccess({
      billingStatus: HostedBillingStatus.past_due,
      suspendedAt: null,
    })).toBe(true);

    expect(hasHostedMemberGeneralAccess({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: new Date("2026-04-06T10:00:00.000Z"),
    })).toBe(false);
  });

  it("derives activation readiness from general access plus family sponsorship", () => {
    expect(deriveHostedEntitlement({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
    })).toMatchObject({
      accessAllowed: true,
      activationReady: true,
    });

    expect(deriveHostedEntitlement({
      billingStatus: HostedBillingStatus.not_started,
      familyAccessActive: true,
      suspendedAt: null,
    })).toMatchObject({
      accessAllowed: true,
      activationReady: true,
    });

    expect(deriveHostedEntitlement({
      billingStatus: HostedBillingStatus.canceled,
      familyAccessActive: true,
      suspendedAt: null,
    })).toMatchObject({
      accessAllowed: true,
      activationReady: true,
    });
  });

  it("allows active family sponsorship without direct member billing", () => {
    expect(hasHostedMemberEffectiveActiveAccess({
      familyAccessActive: true,
      memberBillingStatus: HostedBillingStatus.not_started,
      memberSuspendedAt: null,
    })).toBe(true);

    expect(hasHostedMemberEffectiveActiveAccess({
      familyAccessActive: true,
      memberBillingStatus: HostedBillingStatus.not_started,
      memberSuspendedAt: new Date("2026-06-18T00:00:00.000Z"),
    })).toBe(false);

    expect(hasHostedMemberEffectiveActiveAccess({
      familyAccessActive: false,
      memberBillingStatus: HostedBillingStatus.not_started,
      memberSuspendedAt: null,
    })).toBe(false);
  });

  it("reports billing-state-specific errors for non-active members", () => {
    expect(() =>
      assertHostedMemberActiveAccessAllowed({
        billingStatus: HostedBillingStatus.canceled,
        suspendedAt: null,
      })).toThrowError(expect.objectContaining({
      code: "HOSTED_ACCESS_REQUIRED",
      message: "Your subscription is canceled. Open billing to resume access.",
    }));

    expect(() =>
      assertHostedMemberActiveAccessAllowed({
        billingStatus: HostedBillingStatus.past_due,
        suspendedAt: null,
      })).toThrowError(expect.objectContaining({
      code: "HOSTED_ACCESS_REQUIRED",
      message: "Your subscription payment is past due. Update billing before continuing.",
    }));
  });
});
