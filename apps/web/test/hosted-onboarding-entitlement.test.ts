import { HostedBillingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  assertHostedMemberActiveAccessAllowed,
  deriveHostedEntitlement,
  hasHostedMemberActiveAccess,
  hasHostedMemberGeneralAccess,
} from "@/src/lib/hosted-onboarding/entitlement";

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

  it("derives activation readiness from active access", () => {
    expect(deriveHostedEntitlement({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
    })).toMatchObject({
      accessAllowed: true,
      activationReady: true,
    });
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
