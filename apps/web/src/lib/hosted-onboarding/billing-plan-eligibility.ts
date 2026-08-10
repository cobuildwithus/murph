import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import type { HostedBillingPlanCode } from "./billing-plans";
import { hostedOnboardingError } from "./errors";

type HostedBillingPlanEligibilityClient =
  | PrismaClient
  | Prisma.TransactionClient;

export async function hasConfirmedHostedGroupMembership(input: {
  memberId: string;
  prisma?: HostedBillingPlanEligibilityClient;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const membership = await prisma.hostedGroupMember.findFirst({
    select: { id: true },
    where: {
      memberId: input.memberId,
      OR: [
        { role: "owner" },
        { joinedAt: { not: null } },
      ],
    },
  });

  return membership !== null;
}

export function resolveVisibleHostedBillingPlanCodes(input: {
  currentPlanCode: HostedBillingPlanCode | null;
  groupPlanConfigured: boolean;
  hasConfirmedGroupMembership: boolean;
  maxPlanConfigured?: boolean;
  scheduledPlanCode: HostedBillingPlanCode | null;
}): HostedBillingPlanCode[] {
  const showGroup =
    input.currentPlanCode === "launch_group_monthly" ||
    input.scheduledPlanCode === "launch_group_monthly" ||
    (
      input.groupPlanConfigured &&
      input.hasConfirmedGroupMembership
    );
  const showMax =
    input.currentPlanCode === "launch_max_monthly" ||
    input.scheduledPlanCode === "launch_max_monthly" ||
    input.maxPlanConfigured === true;

  return [
    ...(showGroup ? ["launch_group_monthly" as const] : []),
    "launch_monthly",
    "launch_edge_monthly",
    ...(showMax ? ["launch_max_monthly" as const] : []),
  ];
}

export interface HostedTrialContinuationOffer {
  availablePlanCodes: Array<
    "launch_group_monthly" | "launch_monthly"
  >;
  recommendedPlanCode:
    | "launch_group_monthly"
    | "launch_monthly";
}

export function resolveHostedTrialContinuationOffer(input: {
  groupPlanConfigured: boolean;
  hasConfirmedGroupMembership: boolean;
}): HostedTrialContinuationOffer {
  if (
    input.groupPlanConfigured &&
    input.hasConfirmedGroupMembership
  ) {
    return {
      availablePlanCodes: [
        "launch_group_monthly",
        "launch_monthly",
      ],
      recommendedPlanCode: "launch_group_monthly",
    };
  }

  return {
    availablePlanCodes: ["launch_monthly"],
    recommendedPlanCode: "launch_monthly",
  };
}

/**
 * Visibility is advisory. Every mutation that would start or schedule Group
 * rechecks the canonical membership row under its existing billing lock.
 */
export async function assertHostedBillingPlanSelectable(input: {
  memberId: string;
  prisma?: HostedBillingPlanEligibilityClient;
  targetPlanCode: HostedBillingPlanCode;
}): Promise<void> {
  if (input.targetPlanCode !== "launch_group_monthly") {
    return;
  }

  if (await hasConfirmedHostedGroupMembership(input)) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_GROUP_PLAN_NOT_ELIGIBLE",
    httpStatus: 409,
    message:
      "The Core plan is available while you're part of a Murph group.",
  });
}
