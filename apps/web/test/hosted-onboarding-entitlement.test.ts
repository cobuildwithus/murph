import { HostedBillingStatus, HostedMemberStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  deriveHostedEntitlement,
  hasHostedMemberActiveAccess,
  hasHostedMemberGeneralAccess,
} from "@/src/lib/hosted-onboarding/entitlement";

describe("hosted onboarding entitlement", () => {
  it("requires active billing plus a non-suspended member for active access", () => {
    expect(hasHostedMemberActiveAccess({
      billingStatus: HostedBillingStatus.active,
      memberStatus: HostedMemberStatus.registered,
    })).toBe(true);

    expect(hasHostedMemberActiveAccess({
      billingStatus: HostedBillingStatus.past_due,
      memberStatus: HostedMemberStatus.registered,
    })).toBe(false);

    expect(hasHostedMemberActiveAccess({
      billingStatus: HostedBillingStatus.active,
      memberStatus: HostedMemberStatus.suspended,
    })).toBe(false);
  });

  it("keeps general access broader than active access without allowing suspended members", () => {
    expect(hasHostedMemberGeneralAccess({
      billingStatus: HostedBillingStatus.past_due,
      memberStatus: HostedMemberStatus.registered,
    })).toBe(true);

    expect(hasHostedMemberGeneralAccess({
      billingStatus: HostedBillingStatus.active,
      memberStatus: HostedMemberStatus.suspended,
    })).toBe(false);
  });

  it("derives activation readiness from active access plus revnet readiness", () => {
    expect(deriveHostedEntitlement({
      billingStatus: HostedBillingStatus.active,
      memberStatus: HostedMemberStatus.registered,
      revnetRequired: true,
      revnetIssuanceStatus: null,
    })).toMatchObject({
      accessAllowed: true,
      activationReady: false,
    });

    expect(deriveHostedEntitlement({
      billingStatus: HostedBillingStatus.active,
      memberStatus: HostedMemberStatus.registered,
      revnetRequired: false,
      revnetIssuanceStatus: null,
    })).toMatchObject({
      accessAllowed: true,
      activationReady: true,
    });
  });
});
