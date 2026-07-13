import "server-only";

import type {
  HostedRuntimeBillingPlanToolRequest,
  HostedRuntimeBillingPlanToolResponse,
  HostedRuntimeBillingPlanToolStatusResponse,
} from "@murphai/hosted-execution/runtime-control";

import { createHostedBillingPortalSession } from "../hosted-onboarding/billing-portal-service";
import {
  buildHostedRuntimeBillingPlanActionApprovalRequest,
  requestHostedRuntimeSensitiveActionApproval,
} from "./billing-family-action-approval";
import {
  canStartHostedPulseTrialPaidPlan,
  canSwitchHostedBillingPlanToPulse,
  canUpgradeHostedBillingPlanToEdge,
  listHostedBillingPlanPresentations,
  resolveConfiguredHostedBillingPlanCodes,
} from "../hosted-onboarding/billing-plans";
import {
  prepareHostedBillingPlanUpgrade,
  upgradeHostedBillingPlan,
} from "../hosted-onboarding/billing-plan-change-service";
import { scheduleHostedBillingPlanSwitchToPulse } from "../hosted-onboarding/billing-plan-switch-to-pulse-service";
import { startHostedPulseTrialPaidPlan } from "../hosted-onboarding/billing-start-paid-pulse-service";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { readHostedFamilyAccessForMember } from "../hosted-onboarding/family-plan";
import { readHostedMemberStripeBillingRef } from "../hosted-onboarding/hosted-member-billing-store";
import { readHostedMemberCoreState } from "../hosted-onboarding/hosted-member-store";
import {
  getHostedOnboardingEnvironment,
  requireHostedOnboardingPublicBaseUrl,
} from "../hosted-onboarding/runtime";
import { getPrisma } from "../prisma";

export async function handleHostedRuntimeBillingPlanTool(input: {
  memberId: string;
  request: HostedRuntimeBillingPlanToolRequest;
}): Promise<HostedRuntimeBillingPlanToolResponse> {
  if (input.request.action === "read_status") {
    return {
      action: "read_status",
      result: await readHostedRuntimeBillingPlanStatus(input.memberId),
    };
  }
  if (input.request.action === "open_portal") {
    const portal = await createHostedBillingPortalSession({
      billingScope: "member",
      memberId: input.memberId,
      returnUrl: new URL(
        "/settings",
        requireHostedOnboardingPublicBaseUrl(),
      ).toString(),
    });
    return {
      action: "open_portal",
      result: {
        status: "browser_handoff",
        url: portal.url,
      },
    };
  }
  const prisma = getPrisma();
  let status = await readHostedRuntimeBillingPlanStatus(input.memberId);
  if (status.sponsoredFamilyAccess) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_DIRECT_MUTATION_SPONSORED_UNSUPPORTED",
      httpStatus: 409,
      message: "Direct plan changes are unavailable while Family sponsorship is active.",
    });
  }
  if (input.request.action === "upgrade_to_edge") {
    const preparation = await prepareHostedBillingPlanUpgrade({
      memberId: input.memberId,
      targetPlanCode: "launch_edge_monthly",
    });
    if (preparation.status === "already_on_plan") {
      const repaired = await upgradeHostedBillingPlan({
        expectedCurrentPeriodEnd: preparation.currentPeriodEnd,
        memberId: input.memberId,
        targetPlanCode: "launch_edge_monthly",
      });
      if (repaired.status === "pending_payment") {
        return {
          action: input.request.action,
          result: {
            currentBillingPlanCode: repaired.billingPlanCode,
            status: "browser_handoff",
            targetBillingPlanCode: "launch_edge_monthly",
            url: repaired.billingPortalUrl,
          },
        };
      }
      return {
        action: input.request.action,
        result: {
          currentBillingPlanCode: "launch_edge_monthly",
          status: "unchanged",
          targetBillingPlanCode: "launch_edge_monthly",
        },
      };
    }
    status = {
      ...status,
      canUpgradeToEdge: true,
      currentBillingPhase: "paid",
      currentBillingPlanCode: preparation.currentBillingPlanCode,
      currentPeriodEnd: preparation.currentPeriodEnd.toISOString(),
    };
  }
  if (
    input.request.action === "start_paid_pulse"
    && isProjectedHostedRuntimePaidPulse(status)
  ) {
    return projectHostedRuntimeStartPaidPulseResult({
      alreadyPaid: true,
      result: await startHostedPulseTrialPaidPlan({
        memberId: input.memberId,
      }),
    });
  }
  assertHostedRuntimeBillingMutationEligible({
    action: input.request.action,
    status,
  });
  if (input.request.action !== "start_paid_pulse") {
    requireHostedRuntimeBillingApprovedCurrentPeriodEnd(status);
  }
  const approvalRequest = buildHostedRuntimeBillingPlanActionApprovalRequest({
    action: input.request.action,
    returnContactKind: input.request.returnContactKind ?? null,
    status,
  });
  if (!input.request.confirmed) {
    return {
      action: input.request.action,
      result: {
        presentation: approvalRequest.presentation,
        status: "confirmation_required",
      },
    };
  }
  const approval = await requestHostedRuntimeSensitiveActionApproval({
    memberId: input.memberId,
    prisma,
    request: approvalRequest,
  });
  if (approval.status !== "approved") {
    return {
      action: input.request.action,
      result: approval,
    };
  }
  if (input.request.action === "start_paid_pulse") {
    return projectHostedRuntimeStartPaidPulseResult({
      alreadyPaid: false,
      result: await startHostedPulseTrialPaidPlan({
        memberId: input.memberId,
      }),
    });
  }
  if (input.request.action === "switch_to_pulse_at_renewal") {
    const result = await scheduleHostedBillingPlanSwitchToPulse({
      expectedCurrentPeriodEnd:
        requireHostedRuntimeBillingApprovedCurrentPeriodEnd(status),
      memberId: input.memberId,
    });
    return {
      action: "switch_to_pulse_at_renewal",
      result: {
        effectiveAt: result.effectiveAt,
        scheduledBillingPlanCode: result.scheduledBillingPlanCode,
        status: result.status === "already_scheduled" ? "unchanged" : "scheduled",
      },
    };
  }

  const result = await upgradeHostedBillingPlan({
    expectedCurrentPeriodEnd:
      requireHostedRuntimeBillingApprovedCurrentPeriodEnd(status),
    memberId: input.memberId,
    targetPlanCode: "launch_edge_monthly",
  });
  if (result.status === "pending_payment") {
    return {
      action: "upgrade_to_edge",
      result: {
        currentBillingPlanCode: result.billingPlanCode,
        status: "browser_handoff",
        targetBillingPlanCode: "launch_edge_monthly",
        url: result.billingPortalUrl,
      },
    };
  }
  return {
    action: "upgrade_to_edge",
    result: {
      currentBillingPlanCode: result.billingPlanCode,
      status: result.status === "already_on_plan" ? "unchanged" : "applied",
      targetBillingPlanCode: "launch_edge_monthly",
    },
  };
}

function requireHostedRuntimeBillingApprovedCurrentPeriodEnd(
  status: HostedRuntimeBillingPlanToolStatusResponse,
): Date {
  const value = status.currentPeriodEnd;
  if (value) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime()) && date.toISOString() === value) {
      return date;
    }
  }

  throw hostedOnboardingError({
    code: "HOSTED_BILLING_CURRENT_PERIOD_END_REQUIRED",
    httpStatus: 409,
    message: "Your current billing period is still syncing. Try again shortly.",
    retryable: true,
  });
}

function isProjectedHostedRuntimePaidPulse(
  status: HostedRuntimeBillingPlanToolStatusResponse,
): boolean {
  const activeDirectBilling =
    status.billingStatus === "active"
    && status.currentBillingPhase === "paid"
    && status.portalAvailable
    && !status.sponsoredFamilyAccess;
  return activeDirectBilling
    && status.currentBillingPlanCode === "launch_monthly";
}

function projectHostedRuntimeStartPaidPulseResult(input: {
  alreadyPaid: boolean;
  result: Awaited<ReturnType<typeof startHostedPulseTrialPaidPlan>>;
}): HostedRuntimeBillingPlanToolResponse {
  if (input.result.status === "payment_required") {
    return {
      action: "start_paid_pulse",
      result: {
        billingPlanCode: input.result.billingPlanCode,
        status: "browser_handoff",
        url: input.result.paymentUrl,
      },
    };
  }
  let status: "applied" | "pending" | "unchanged" = "pending";
  if (input.result.status === "started") {
    status = input.alreadyPaid ? "unchanged" : "applied";
  }
  return {
    action: "start_paid_pulse",
    result: {
      billingPlanCode: input.result.billingPlanCode,
      status,
    },
  };
}

function assertHostedRuntimeBillingMutationEligible(input: {
  action: "start_paid_pulse" | "switch_to_pulse_at_renewal" | "upgrade_to_edge";
  status: HostedRuntimeBillingPlanToolStatusResponse;
}): void {
  const eligible = input.action === "start_paid_pulse"
    ? input.status.canStartPaidPulse
    : input.action === "switch_to_pulse_at_renewal"
      ? input.status.canSwitchToPulseAtRenewal
      : input.status.canUpgradeToEdge;
  if (eligible) {
    return;
  }
  throw hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_ACTION_UNAVAILABLE",
    httpStatus: 409,
    message: "This billing plan action is not available for the current subscription state.",
  });
}

async function readHostedRuntimeBillingPlanStatus(
  memberId: string,
): Promise<HostedRuntimeBillingPlanToolStatusResponse> {
  const prisma = getPrisma();
  const [member, billingRef, familyAccess] = await Promise.all([
    readHostedMemberCoreState({ memberId, prisma }),
    readHostedMemberStripeBillingRef({ memberId, prisma }),
    readHostedFamilyAccessForMember({ memberId, prisma }),
  ]);
  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 403,
      message: "Finish signup from your latest Murph link before continuing.",
    });
  }
  const configuredPlanCodes = resolveConfiguredHostedBillingPlanCodes({
    stripePriceIdsByPlan: getHostedOnboardingEnvironment().stripePriceIdsByPlan,
  });
  const configuredPlanCodeSet = new Set(configuredPlanCodes);

  return {
    billingStatus: member.billingStatus,
    canStartPaidPulse:
      familyAccess === null &&
      configuredPlanCodeSet.has("launch_monthly") &&
      canStartHostedPulseTrialPaidPlan({
        billingStatus: member.billingStatus,
        currentBillingPhase: billingRef?.currentBillingPhase,
        currentBillingPlanCode: billingRef?.currentBillingPlanCode,
        currentCheckoutOffer: billingRef?.currentCheckoutOffer,
        stripeCustomerId: billingRef?.stripeCustomerId,
        stripeSubscriptionId: billingRef?.stripeSubscriptionId,
        suspendedAt: member.suspendedAt,
      }),
    canSwitchToPulseAtRenewal:
      familyAccess === null &&
      configuredPlanCodeSet.has("launch_monthly") &&
      canSwitchHostedBillingPlanToPulse({
        billingStatus: member.billingStatus,
        currentBillingPhase: billingRef?.currentBillingPhase,
        currentBillingPlanCode: billingRef?.currentBillingPlanCode,
        stripeCustomerId: billingRef?.stripeCustomerId,
        stripeSubscriptionId: billingRef?.stripeSubscriptionId,
        suspendedAt: member.suspendedAt,
      }),
    canUpgradeToEdge:
      familyAccess === null &&
      configuredPlanCodeSet.has("launch_edge_monthly") &&
      member.billingStatus === "active" &&
      !(member.suspendedAt instanceof Date) &&
      typeof billingRef?.stripeCustomerId === "string" &&
      billingRef.stripeCustomerId.length > 0 &&
      typeof billingRef.stripeSubscriptionId === "string" &&
      billingRef.stripeSubscriptionId.length > 0 &&
      canUpgradeHostedBillingPlanToEdge({
        currentBillingPhase: billingRef?.currentBillingPhase,
        currentBillingPlanCode: billingRef?.currentBillingPlanCode,
        currentCheckoutOffer: billingRef?.currentCheckoutOffer,
      }),
    currentBillingPhase: billingRef?.currentBillingPhase ?? null,
    currentBillingPlanCode: billingRef?.currentBillingPlanCode ?? null,
    currentCheckoutOffer: billingRef?.currentCheckoutOffer ?? null,
    currentPeriodEnd: billingRef?.currentPeriodEnd?.toISOString() ?? null,
    portalAvailable:
      !(member.suspendedAt instanceof Date) &&
      Boolean(billingRef?.stripeCustomerId),
    planPresentations: listHostedBillingPlanPresentations({
      configuredPlanCodes,
    }).map((plan) => ({
      code: plan.code,
      displayName: plan.displayName,
      interval: plan.interval,
      recurringAmountUsdCents: plan.recurringAmountUsdCents,
    })),
    scheduledBillingEffectiveAt:
      billingRef?.scheduledBillingEffectiveAt?.toISOString() ?? null,
    scheduledBillingPlanCode: billingRef?.scheduledBillingPlanCode ?? null,
    sponsoredFamilyAccess: familyAccess !== null,
  };
}
