import { HostedBillingStatus } from "@prisma/client";
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

  it("derives activation readiness from active access plus revnet readiness", () => {
    expect(deriveHostedEntitlement({
      billingStatus: HostedBillingStatus.active,
      revnetRequired: true,
      revnetIssuanceStatus: null,
      suspendedAt: null,
    })).toMatchObject({
      accessAllowed: true,
      activationReady: false,
    });

    expect(deriveHostedEntitlement({
      billingStatus: HostedBillingStatus.active,
      revnetRequired: false,
      revnetIssuanceStatus: null,
      suspendedAt: null,
    })).toMatchObject({
      accessAllowed: true,
      activationReady: true,
    });
  });
});
