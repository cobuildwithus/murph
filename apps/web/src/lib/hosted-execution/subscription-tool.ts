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
  parseHostedBillingPlanCode,
  type HostedBillingPlanCode,
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
  const verifiedQuote = input.request.action === "change_plan"
    ? await verifyCurrentHostedBillingPlanQuote({
        memberId: input.memberId,
        quoteId: input.request.quoteId,
        targetPlanCode: input.request.targetPlanCode,
      })
    : null;
  const legacyUpgradeSourcePlanCode =
    input.request.action === "upgrade_edge"
      ? parseHostedBillingPlanCode(
          (
            await readHostedMemberBillingEligibilityState({
              memberId: input.memberId,
              prisma,
            })
          )?.currentBillingPlanCode,
        )
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
    case "change_plan": {
      const quote = requireHostedBillingPlanQuote(verifiedQuote);
      return handleHostedQuotedPlanChange({
        expectedCurrentPlanCode: quote.expectedCurrentPlanCode,
        memberId: input.memberId,
        quoteTiming: quote.timing,
        targetPlanCode: input.request.targetPlanCode,
      });
    }
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
    case "upgrade_edge":
      return projectPlanUpgradeResult({
        action: input.request.action,
        result: await upgradeHostedBillingPlan({
          ...(legacyUpgradeSourcePlanCode
            ? { expectedCurrentPlanCode: legacyUpgradeSourcePlanCode }
            : {}),
          memberId: input.memberId,
          prisma,
          targetPlanCode: "launch_edge_monthly",
        }),
      });
  }
}

interface VerifiedHostedBillingPlanQuote {
  expectedCurrentPlanCode: HostedBillingPlanCode | null;
  timing: HostedBillingPlanQuoteTiming;
}

async function verifyCurrentHostedBillingPlanQuote(input: {
  memberId: string;
  quoteId: string;
  targetPlanCode: HostedRuntimeDirectBillingPlanCode;
}): Promise<VerifiedHostedBillingPlanQuote> {
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
    throw buildHostedBillingPlanQuoteStaleError();
  }

  const timing = verifyHostedBillingPlanQuote({
    memberId: input.memberId,
    now: new Date(),
    quoteId: input.quoteId,
    state: buildHostedBillingPlanQuoteState({
      billingState,
      billingStatus: member.billingStatus,
    }),
    targetPlanCode: input.targetPlanCode,
  });
  return {
    expectedCurrentPlanCode: parseHostedBillingPlanCode(
      billingState.currentBillingPlanCode,
    ),
    timing,
  };
}

function requireHostedBillingPlanQuote(
  quote: VerifiedHostedBillingPlanQuote | null,
): VerifiedHostedBillingPlanQuote {
  if (quote) {
    return quote;
  }

  throw new TypeError("Verified plan change quote is required.");
}

async function handleHostedQuotedPlanChange(input: {
  expectedCurrentPlanCode: HostedBillingPlanCode | null;
  memberId: string;
  quoteTiming: HostedBillingPlanQuoteTiming;
  targetPlanCode: HostedRuntimeDirectBillingPlanCode;
}): Promise<HostedRuntimeSubscriptionToolResponse> {
  const prisma = getPrisma();
  if (
    input.quoteTiming === "now"
    || input.quoteTiming === "at_trial_end"
  ) {
    return projectQuotedPlanChangeResult({
      result: await startHostedTrialPaidPlan({
        memberId: input.memberId,
        paymentMethodContinuation: "conversation",
        prisma,
        targetPlanCode: requireHostedTrialPaidTargetPlanCode(
          input.targetPlanCode,
        ),
        timing: input.quoteTiming,
      }),
      targetPlanCode: input.targetPlanCode,
    });
  }

  if (input.quoteTiming === "immediate") {
    return projectQuotedPlanChangeResult({
      result: await upgradeHostedBillingPlan({
        ...(input.expectedCurrentPlanCode
          ? { expectedCurrentPlanCode: input.expectedCurrentPlanCode }
          : {}),
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
    | HostedTrialPaidPlanTransitionResult;
  targetPlanCode: HostedRuntimeDirectBillingPlanCode;
}): HostedRuntimeSubscriptionToolResponse {
  const plan = projectHostedSubscriptionPlan(input.targetPlanCode);

  switch (input.result.status) {
    case "already_on_plan":
    case "continuing":
      return {
        action: "change_plan",
        plan,
        status: "no_action_required",
      };
    case "already_scheduled":
    case "scheduled":
      return {
        action: "change_plan",
        effectiveAt: input.result.effectiveAt,
        plan,
        status: "scheduled",
      };
    case "billing_pending":
      return {
        action: "change_plan",
        plan,
        status: "pending",
      };
    case "payment_required":
    case "pending_payment":
      return {
        action: "change_plan",
        paymentUrl: input.result.paymentUrl,
        plan,
        status: "payment_required",
      };
    case "payment_method_required":
      throw new TypeError(
        "Trial payment-method preflight must be projected by the trial transition owner.",
      );
    case "started":
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

  throw buildHostedBillingPlanQuoteStaleError();
}

function buildHostedBillingPlanQuoteStaleError() {
  return hostedOnboardingError({
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

function projectPlanUpgradeResult(input: {
  action: Extract<HostedRuntimeSubscriptionAction, "upgrade_edge">;
  result: HostedBillingPlanUpgradeResult;
}): HostedRuntimeSubscriptionToolResponse {
  const plan = projectHostedSubscriptionPlan("launch_edge_monthly");
  switch (input.result.status) {
    case "already_on_plan":
      return {
        action: "upgrade_edge",
        plan,
        status: "no_action_required",
      };
    case "pending_payment":
      return {
        action: "upgrade_edge",
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
type HostedMaxSubscriptionPlan = Extract<
  HostedSubscriptionPlan,
  { code: "launch_max_monthly" }
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
  code: "launch_max_monthly",
): HostedMaxSubscriptionPlan;
function projectHostedSubscriptionPlan(
  code: HostedRuntimeDirectBillingPlanCode,
): HostedSubscriptionPlan;
function projectHostedSubscriptionPlan(
  code: HostedRuntimeDirectBillingPlanCode,
): HostedSubscriptionPlan {
  const definition = getHostedBillingPlanDefinition(code);

  if (code === "launch_group_monthly") {
    return {
      code,
      // Keep the runtime wire contract stable while the member-facing label
      // is projected as Core by Web and the assistant.
      displayName: "Group",
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

  if (code === "launch_max_monthly" && definition.displayName === "Max") {
    return {
      code,
      displayName: definition.displayName,
      interval: definition.interval,
      recurringAmountUsdCents: definition.recurringAmountUsdCents,
    };
  }

  throw new TypeError(`Unexpected subscription plan definition for ${code}.`);
}
