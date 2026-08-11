import { HostedBillingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  deriveHostedOnboardingStage,
  deriveHostedPostVerificationStage,
  hasHostedRecoverableBilling,
} from "@/src/lib/hosted-onboarding/lifecycle";

const NOW = new Date("2026-07-23T12:00:00.000Z");
const EXPIRES_AT = new Date("2026-07-24T12:00:00.000Z");
const SUSPENDED_AT = new Date("2026-07-23T11:00:00.000Z");

describe("hosted onboarding lifecycle", () => {
  it("maps a session-matched paused member to the accessible recovery stage", () => {
    expect(deriveHostedOnboardingStage({
      billingStatus: HostedBillingStatus.paused,
      expiresAt: EXPIRES_AT,
      now: NOW,
      sessionMatchesInvite: true,
      suspendedAt: null,
    })).toBe("active");

    expect(deriveHostedPostVerificationStage({
      billingStatus: HostedBillingStatus.paused,
      suspendedAt: null,
    })).toBe("active");
  });

  it("keeps suspended paused members blocked", () => {
    expect(deriveHostedOnboardingStage({
      billingStatus: HostedBillingStatus.paused,
      expiresAt: EXPIRES_AT,
      now: NOW,
      sessionMatchesInvite: true,
      suspendedAt: SUSPENDED_AT,
    })).toBe("blocked");

    expect(deriveHostedPostVerificationStage({
      billingStatus: HostedBillingStatus.paused,
      suspendedAt: SUSPENDED_AT,
    })).toBe("blocked");
  });

  it("routes every lapsed billing state to the recovery surface", () => {
    for (const billingStatus of [
      HostedBillingStatus.paused,
      HostedBillingStatus.past_due,
      HostedBillingStatus.canceled,
      HostedBillingStatus.unpaid,
    ]) {
      expect(deriveHostedPostVerificationStage({
        billingStatus,
        suspendedAt: null,
      }), billingStatus).toBe("active");
    }
  });

  it("keeps checkout-owing billing states in the checkout flow", () => {
    for (const billingStatus of [
      HostedBillingStatus.not_started,
      HostedBillingStatus.incomplete,
    ]) {
      expect(deriveHostedPostVerificationStage({
        billingStatus,
        suspendedAt: null,
      }), billingStatus).toBe("checkout");
    }
  });

  it.each([
    HostedBillingStatus.paused,
    HostedBillingStatus.past_due,
    HostedBillingStatus.canceled,
    HostedBillingStatus.unpaid,
  ])("classifies %s as existing-billing recovery", (billingStatus) => {
    expect(hasHostedRecoverableBilling({ billingStatus })).toBe(true);
  });

  it("uses subscription ownership to distinguish incomplete recovery from acquisition", () => {
    expect(hasHostedRecoverableBilling({
      billingStatus: HostedBillingStatus.incomplete,
      hasExistingSubscription: true,
    })).toBe(true);
    expect(hasHostedRecoverableBilling({
      billingStatus: HostedBillingStatus.incomplete,
      hasExistingSubscription: false,
    })).toBe(false);
    expect(hasHostedRecoverableBilling({
      billingStatus: HostedBillingStatus.not_started,
      hasExistingSubscription: false,
    })).toBe(false);
    expect(hasHostedRecoverableBilling({
      billingStatus: HostedBillingStatus.active,
      hasExistingSubscription: true,
    })).toBe(false);
  });
});
