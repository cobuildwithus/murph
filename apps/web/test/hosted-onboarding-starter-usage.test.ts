import { HostedBillingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  buildHostedStarterUsageLifetimePeriod,
  canGrantHostedStarterUsageForLegacyTrial,
} from "@/src/lib/hosted-onboarding/starter-usage";

describe("hosted Starter usage policy", () => {
  it("returns a stable lifetime persistence window without sharing mutable Dates", () => {
    const first = buildHostedStarterUsageLifetimePeriod();
    const second = buildHostedStarterUsageLifetimePeriod();

    expect(first).toEqual({
      periodEnd: new Date("2099-12-31T23:59:59.999Z"),
      periodStart: new Date(0),
    });
    expect(second).toEqual(first);
    expect(second.periodStart).not.toBe(first.periodStart);
    expect(second.periodEnd).not.toBe(first.periodEnd);

    first.periodStart.setUTCFullYear(2030);
    expect(second.periodStart).toEqual(new Date(0));
  });

  it.each([
    HostedBillingStatus.not_started,
    HostedBillingStatus.incomplete,
    HostedBillingStatus.active,
    HostedBillingStatus.paused,
  ])("allows eligible unsuspended legacy %s members", (billingStatus) => {
    expect(canGrantHostedStarterUsageForLegacyTrial({
      billingStatus,
      suspendedAt: null,
    })).toBe(true);
  });

  it.each([
    HostedBillingStatus.canceled,
    HostedBillingStatus.unpaid,
    HostedBillingStatus.past_due,
  ])("does not reactivate terminal legacy %s members", (billingStatus) => {
    expect(canGrantHostedStarterUsageForLegacyTrial({
      billingStatus,
      suspendedAt: null,
    })).toBe(false);
  });

  it("never grants Starter capacity to a suspended member", () => {
    expect(canGrantHostedStarterUsageForLegacyTrial({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: new Date("2026-08-09T00:00:00.000Z"),
    })).toBe(false);
  });
});
