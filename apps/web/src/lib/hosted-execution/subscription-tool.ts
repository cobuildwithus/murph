import "server-only";

import type {
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
  continueHostedPulseTrialPaidPlan,
  startHostedPulseTrialPaidPlan,
  type HostedPulseTrialContinueResult,
  type HostedPulseTrialStartPaidResult,
} from "../hosted-onboarding/billing-start-paid-pulse-service";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";

export async function handleHostedSubscriptionTool(input: {
  memberId: string;
  request: HostedRuntimeSubscriptionControlRequest;
}): Promise<HostedRuntimeSubscriptionToolResponse> {
  const prisma = getPrisma();
  const actionClaim =
    await claimHostedMailboxConversationSubscriptionAction({
      action: input.request.action,
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
    case "continue_pulse":
      return projectPulseResult({
        action: input.request.action,
        planCode: "launch_monthly",
        result: await continueHostedPulseTrialPaidPlan({
          memberId: input.memberId,
          prisma,
        }),
      });
    case "start_pulse_now":
      return projectPulseResult({
        action: input.request.action,
        planCode: "launch_monthly",
        result: await startHostedPulseTrialPaidPlan({
          memberId: input.memberId,
          prisma,
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
    case "pending_payment":
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
type HostedEdgeSubscriptionPlan = Extract<
  HostedSubscriptionPlan,
  { code: "launch_edge_monthly" }
>;

function projectHostedSubscriptionPlan(
  code: "launch_monthly",
): HostedPulseSubscriptionPlan;
function projectHostedSubscriptionPlan(
  code: "launch_edge_monthly",
): HostedEdgeSubscriptionPlan;
function projectHostedSubscriptionPlan(
  code: "launch_edge_monthly" | "launch_monthly",
): HostedSubscriptionPlan {
  const definition = getHostedBillingPlanDefinition(code);

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
