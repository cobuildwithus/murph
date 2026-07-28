import "server-only";

import type {
  HostedRuntimeDirectBillingPlanCode,
  HostedRuntimeSubscriptionAction,
  HostedRuntimeSubscriptionControlRequest,
  HostedRuntimeSubscriptionToolResponse,
} from "@murphai/hosted-execution/subscription";

import {
  claimHostedMailboxConversationSubscriptionAction,
} from "../hosted-mailbox/store";
import {
  upgradeHostedBillingPlan,
  type HostedBillingPlanUpgradeResult,
} from "../hosted-onboarding/billing-plan-change-service";
import {
  getHostedBillingPlanDefinition,
} from "../hosted-onboarding/billing-plans";
import {
  scheduleHostedBillingPlanSwitch,
  type HostedBillingPlanSwitchResult,
} from "../hosted-onboarding/billing-plan-switch-to-pulse-service";
import {
  buildHostedBillingPlanQuoteState,
  verifyHostedBillingPlanQuote,
  type HostedBillingPlanQuoteTiming,
} from "../hosted-onboarding/billing-plan-quote";
import {
  continueHostedPulseTrialPaidPlan,
  startHostedTrialPaidPlan,
  startHostedPulseTrialPaidPlan,
  type HostedTrialPaidPlanTransitionResult,
  type HostedTrialStartPaidResult,
  type HostedPulseTrialContinueResult,
  type HostedPulseTrialStartPaidResult,
} from "../hosted-onboarding/billing-start-paid-pulse-service";
import {
  readHostedMemberBillingEligibilityState,
} from "../hosted-onboarding/hosted-member-billing-store";
import { readHostedMemberCoreState } from "../hosted-onboarding/hosted-member-store";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { sha256Hex } from "../primitives";
import { getPrisma } from "../prisma";

export async function handleHostedSubscriptionTool(input: {
  memberId: string;
  request: HostedRuntimeSubscriptionControlRequest;
}): Promise<HostedRuntimeSubscriptionToolResponse> {
  const prisma = getPrisma();
  const quoteTiming = input.request.action === "change_plan"
    ? await requireHostedBillingPlanQuote({
        memberId: input.memberId,
        quoteId: input.request.quoteId,
        targetPlanCode: input.request.targetPlanCode,
      })
    : null;
  const actionClaim =
    await claimHostedMailboxConversationSubscriptionAction({
      action: input.request.action,
      ...(input.request.action === "change_plan"
        ? {
            actionClaim: [
              input.request.action,
              input.request.targetPlanCode,
              sha256Hex(input.request.quoteId),
            ].join(":"),
          }
        : {}),
      assistantInputId: input.request.assistantInputId,
      memberId: input.memberId,
      prisma,
    });

  if (actionClaim === null) {
    throw hostedOnboardingError({
      code: "HOSTED_SUBSCRIPTION_INPUT_AUTHORITY_INVALID",
      httpStatus: 403,
      message: "Subscription changes are unavailable for this turn.",
    });
  }
  if (actionClaim === "conflict") {
    throw hostedOnboardingError({
      code: "HOSTED_SUBSCRIPTION_INPUT_ACTION_CONFLICT",
      httpStatus: 409,
      message: "Reply again before choosing a different subscription action.",
    });
  }

  switch (input.request.action) {
    case "change_plan":
      return handleHostedQuotedPlanChange({
        memberId: input.memberId,
        quoteTiming: requireHostedBillingPlanQuoteTiming(quoteTiming),
        targetPlanCode: input.request.targetPlanCode,
      });
    case "continue_pulse":
      return projectPulseResult({
        action: input.request.action,
        planCode: "launch_monthly",
        result: await continueHostedPulseTrialPaidPlan({
          memberId: input.memberId,
          paymentMethodContinuation: "conversation",
          prisma,
        }),
      });
    case "start_pulse_now":
      return projectPulseResult({
        action: input.request.action,
        planCode: "launch_monthly",
        result: await startHostedPulseTrialPaidPlan({
          memberId: input.memberId,
          paymentMethodContinuation: "conversation",
          prisma,
        }),
      });
    case "upgrade_pulse":
      return projectPulseUpgradeResult({
        action: input.request.action,
        planCode: "launch_monthly",
        result: await upgradeHostedBillingPlan({
          memberId: input.memberId,
          prisma,
          targetPlanCode: "launch_monthly",
        }),
      });
    case "upgrade_edge":
      return projectEdgeUpgradeResult({
        action: input.request.action,
        planCode: "launch_edge_monthly",
        result: await upgradeHostedBillingPlan({
          memberId: input.memberId,
          prisma,
          targetPlanCode: "launch_edge_monthly",
        }),
      });
  }
}

async function requireHostedBillingPlanQuote(input: {
  memberId: string;
  quoteId: string;
  targetPlanCode: HostedRuntimeDirectBillingPlanCode;
}): Promise<HostedBillingPlanQuoteTiming> {
  const prisma = getPrisma();
  const [member, billingState] = await Promise.all([
    readHostedMemberCoreState({
      memberId: input.memberId,
      prisma,
    }),
    readHostedMemberBillingEligibilityState({
      memberId: input.memberId,
      prisma,
    }),
  ]);
  if (!member || !billingState) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PLAN_QUOTE_STALE",
      httpStatus: 409,
      message:
        "That plan quote is no longer current. Review the latest plan terms before confirming again.",
    });
  }
  return verifyHostedBillingPlanQuote({
    memberId: input.memberId,
    now: new Date(),
    quoteId: input.quoteId,
    state: buildHostedBillingPlanQuoteState({
      billingState,
      billingStatus: member.billingStatus,
    }),
    targetPlanCode: input.targetPlanCode,
  });
}

function requireHostedBillingPlanQuoteTiming(
  timing: HostedBillingPlanQuoteTiming | null,
): HostedBillingPlanQuoteTiming {
  if (timing) {
    return timing;
  }
  throw new TypeError("Quoted plan change timing is required.");
}

async function handleHostedQuotedPlanChange(input: {
  memberId: string;
  quoteTiming: HostedBillingPlanQuoteTiming;
  targetPlanCode: HostedRuntimeDirectBillingPlanCode;
}): Promise<HostedRuntimeSubscriptionToolResponse> {
  const prisma = getPrisma();
  if (input.quoteTiming === "now") {
    return projectQuotedPlanChangeResult({
      result: await startHostedTrialPaidPlan({
        memberId: input.memberId,
        prisma,
        targetPlanCode: requireHostedTrialPaidTargetPlanCode(
          input.targetPlanCode,
        ),
        timing: "now",
      }),
      targetPlanCode: input.targetPlanCode,
    });
  }
  if (input.quoteTiming === "at_trial_end") {
    return projectQuotedPlanChangeResult({
      result: await startHostedTrialPaidPlan({
        memberId: input.memberId,
        prisma,
        targetPlanCode: requireHostedTrialPaidTargetPlanCode(
          input.targetPlanCode,
        ),
        timing: "at_trial_end",
      }),
      targetPlanCode: input.targetPlanCode,
    });
  }
  if (input.quoteTiming === "immediate") {
    return projectQuotedPlanChangeResult({
      result: await upgradeHostedBillingPlan({
        memberId: input.memberId,
        prisma,
        targetPlanCode: input.targetPlanCode,
      }),
      targetPlanCode: input.targetPlanCode,
    });
  }
  return projectQuotedPlanChangeResult({
    result: await scheduleHostedBillingPlanSwitch({
      memberId: input.memberId,
      prisma,
      targetPlanCode: input.targetPlanCode,
    }),
    targetPlanCode: input.targetPlanCode,
  });
}

function projectQuotedPlanChangeResult(input: {
  result:
    | HostedBillingPlanSwitchResult
    | HostedBillingPlanUpgradeResult
    | HostedTrialPaidPlanTransitionResult
    | HostedTrialStartPaidResult;
  targetPlanCode: HostedRuntimeDirectBillingPlanCode;
}): HostedRuntimeSubscriptionToolResponse {
  const plan = projectHostedSubscriptionPlan(input.targetPlanCode);
  switch (input.result.status) {
    case "already_on_plan":
    case "already_scheduled":
    case "continuing":
      return {
        action: "change_plan",
        plan,
        status: "no_action_required",
      };
    case "billing_pending":
    case "processing":
      return {
        action: "change_plan",
        plan,
        status: "pending",
      };
    case "payment_required":
      return {
        action: "change_plan",
        paymentUrl: input.result.paymentUrl,
        plan,
        status: "payment_required",
      };
    case "scheduled":
    case "started":
    case "upgraded":
      return {
        action: "change_plan",
        plan,
        status: "completed",
      };
  }
}

function requireHostedTrialPaidTargetPlanCode(
  planCode: HostedRuntimeDirectBillingPlanCode,
): "launch_group_monthly" | "launch_monthly" {
  if (
    planCode === "launch_group_monthly"
    || planCode === "launch_monthly"
  ) {
    return planCode;
  }
  throw hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_QUOTE_STALE",
    httpStatus: 409,
    message:
      "That plan quote is no longer current. Review the latest plan terms before confirming again.",
  });
}

function projectPulseResult(input: {
  action: Extract<HostedRuntimeSubscriptionAction, "continue_pulse" | "start_pulse_now">;
  planCode: "launch_monthly";
  result: HostedPulseTrialContinueResult | HostedPulseTrialStartPaidResult;
}): HostedRuntimeSubscriptionToolResponse {
  const plan = projectHostedSubscriptionPlan(input.planCode);

  switch (input.result.status) {
    case "continuing":
      return {
        action: input.action,
        plan,
        status: "no_action_required",
      };
    case "started":
      return {
        action: input.action,
        plan,
        status: "completed",
      };
    case "billing_pending":
      return {
        action: input.action,
        plan,
        status: "pending",
      };
    case "payment_required":
      return {
        action: input.action,
        paymentUrl: input.result.paymentUrl,
        plan,
        status: "payment_required",
      };
  }
}

function projectPulseUpgradeResult(input: {
  action: Extract<HostedRuntimeSubscriptionAction, "upgrade_pulse">;
  planCode: "launch_monthly";
  result: HostedBillingPlanUpgradeResult;
}): HostedRuntimeSubscriptionToolResponse {
  const plan = projectHostedSubscriptionPlan(input.planCode);

  switch (input.result.status) {
    case "already_on_plan":
      return {
        action: input.action,
        plan,
        status: "no_action_required",
      };
    case "upgraded":
      return {
        action: input.action,
        plan,
        status: "completed",
      };
    case "processing":
      return {
        action: input.action,
        plan,
        status: "pending",
      };
    case "payment_required":
      return {
        action: input.action,
        paymentUrl: input.result.paymentUrl,
        plan,
        status: "payment_required",
      };
  }
}

function projectEdgeUpgradeResult(input: {
  action: Extract<HostedRuntimeSubscriptionAction, "upgrade_edge">;
  planCode: "launch_edge_monthly";
  result: HostedBillingPlanUpgradeResult;
}): HostedRuntimeSubscriptionToolResponse {
  const plan = projectHostedSubscriptionPlan(input.planCode);

  switch (input.result.status) {
    case "already_on_plan":
      return {
        action: input.action,
        plan,
        status: "no_action_required",
      };
    case "upgraded":
      return {
        action: input.action,
        plan,
        status: "completed",
      };
    case "processing":
      return {
        action: input.action,
        plan,
        status: "pending",
      };
    case "payment_required":
      return {
        action: input.action,
        paymentUrl: input.result.paymentUrl,
        plan,
        status: "payment_required",
      };
  }
}

type HostedSubscriptionPlan = HostedRuntimeSubscriptionToolResponse["plan"];
type HostedPulseSubscriptionPlan = Extract<
  HostedSubscriptionPlan,
  { code: "launch_monthly" }
>;
type HostedGroupSubscriptionPlan = Extract<
  HostedSubscriptionPlan,
  { code: "launch_group_monthly" }
>;
type HostedEdgeSubscriptionPlan = Extract<
  HostedSubscriptionPlan,
  { code: "launch_edge_monthly" }
>;

function projectHostedSubscriptionPlan(
  code: "launch_group_monthly",
): HostedGroupSubscriptionPlan;
function projectHostedSubscriptionPlan(
  code: "launch_monthly",
): HostedPulseSubscriptionPlan;
function projectHostedSubscriptionPlan(
  code: "launch_edge_monthly",
): HostedEdgeSubscriptionPlan;
function projectHostedSubscriptionPlan(
  code: HostedRuntimeDirectBillingPlanCode,
): HostedSubscriptionPlan;
function projectHostedSubscriptionPlan(
  code:
    | "launch_group_monthly"
    | "launch_edge_monthly"
    | "launch_monthly",
): HostedSubscriptionPlan {
  const definition = getHostedBillingPlanDefinition(code);

  if (
    code === "launch_group_monthly"
    && definition.displayName === "Group"
  ) {
    return {
      code,
      displayName: definition.displayName,
      interval: definition.interval,
      recurringAmountUsdCents: definition.recurringAmountUsdCents,
    };
  }

  if (code === "launch_monthly" && definition.displayName === "Pulse") {
    return {
      code,
      displayName: definition.displayName,
      interval: definition.interval,
      recurringAmountUsdCents: definition.recurringAmountUsdCents,
    };
  }

  if (code === "launch_edge_monthly" && definition.displayName === "Edge") {
    return {
      code,
      displayName: definition.displayName,
      interval: definition.interval,
      recurringAmountUsdCents: definition.recurringAmountUsdCents,
    };
  }

  throw new TypeError(`Unexpected subscription plan definition for ${code}.`);
}
