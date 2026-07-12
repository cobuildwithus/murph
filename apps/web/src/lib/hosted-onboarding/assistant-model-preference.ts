import "server-only";

import {
  HostedBillingStatus,
  type Prisma,
} from "@prisma/client";
import {
  HOSTED_ASSISTANT_SOL_MODEL,
  HOSTED_ASSISTANT_TERRA_MODEL,
  type HostedAssistantModelOverride,
  type HostedAssistantProductModel,
} from "@murphai/hosted-execution/assistant-model";

import {
  parseHostedBillingPhase,
  parseHostedBillingPlanCode,
} from "./billing-plans";
import { hostedOnboardingError } from "./errors";
import {
  lockHostedMemberRow,
} from "./shared";

const HOSTED_MEMBER_ASSISTANT_MODEL_SELECT = {
  assistantModelPreference: true,
  billingRef: {
    select: {
      currentBillingPhase: true,
      currentBillingPlanCode: true,
    },
  },
  billingStatus: true,
  suspendedAt: true,
  threadContainer: {
    select: {
      memberId: true,
    },
  },
} as const satisfies Prisma.HostedMemberSelect;

type HostedMemberAssistantModelState = Prisma.HostedMemberGetPayload<{
  select: typeof HOSTED_MEMBER_ASSISTANT_MODEL_SELECT;
}>;

type HostedMemberAssistantModelReadClient = {
  hostedMember: Pick<
    Prisma.TransactionClient["hostedMember"],
    "findUnique"
  >;
};

type HostedMemberAssistantModelTransactionClient = Pick<
  Prisma.TransactionClient,
  "$queryRaw"
> & {
  hostedMember: Pick<
    Prisma.TransactionClient["hostedMember"],
    "findUnique" | "update"
  >;
};

export interface HostedMemberAssistantModelResolution {
  hostedAssistantModelOverride?: HostedAssistantModelOverride;
  model: HostedAssistantProductModel;
  solAvailable: boolean;
}

export interface HostedMemberAssistantModelUpdateResult
  extends HostedMemberAssistantModelResolution {
  updated: boolean;
}

export function isHostedMemberSolModelEligible(input: {
  billingStatus: HostedBillingStatus;
  currentBillingPhase: string | null;
  currentBillingPlanCode: string | null;
  isThreadContainerMember: boolean;
  suspendedAt: Date | null;
}): boolean {
  return input.billingStatus === HostedBillingStatus.active
    && input.suspendedAt === null
    && parseHostedBillingPhase(input.currentBillingPhase) === "paid"
    && parseHostedBillingPlanCode(input.currentBillingPlanCode) === "launch_edge_monthly"
    && !input.isThreadContainerMember;
}

export async function readHostedMemberAssistantModelPreference(input: {
  memberId: string;
  prisma: HostedMemberAssistantModelReadClient;
}): Promise<HostedMemberAssistantModelResolution> {
  const member = await readHostedMemberAssistantModelState(input);

  return resolveHostedMemberAssistantModel(member);
}

export async function updateHostedMemberAssistantModelPreferenceTx(input: {
  memberId: string;
  model: HostedAssistantProductModel;
  prisma: HostedMemberAssistantModelTransactionClient;
}): Promise<HostedMemberAssistantModelUpdateResult> {
  await lockHostedMemberRow(input.prisma, input.memberId);

  const member = await readHostedMemberAssistantModelState(input);
  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 403,
      message: "Finish signup from your latest Murph link before continuing.",
    });
  }

  const current = resolveHostedMemberAssistantModel(member);
  if (input.model === HOSTED_ASSISTANT_SOL_MODEL && !current.solAvailable) {
    throw hostedOnboardingError({
      code: "ASSISTANT_MODEL_SOL_REQUIRES_EDGE",
      httpStatus: 403,
      message: "GPT-5.6 Sol requires an active paid Edge plan.",
    });
  }

  const nextPreference = input.model === HOSTED_ASSISTANT_SOL_MODEL
    ? HOSTED_ASSISTANT_SOL_MODEL
    : null;
  if (member.assistantModelPreference === nextPreference) {
    return {
      ...current,
      updated: false,
    };
  }

  await input.prisma.hostedMember.update({
    data: {
      assistantModelPreference: nextPreference,
    },
    where: {
      id: input.memberId,
    },
  });

  return {
    ...(nextPreference === HOSTED_ASSISTANT_SOL_MODEL
      ? { hostedAssistantModelOverride: HOSTED_ASSISTANT_SOL_MODEL }
      : {}),
    model: input.model,
    solAvailable: current.solAvailable,
    updated: true,
  };
}

async function readHostedMemberAssistantModelState(input: {
  memberId: string;
  prisma: HostedMemberAssistantModelReadClient;
}): Promise<HostedMemberAssistantModelState | null> {
  return input.prisma.hostedMember.findUnique({
    select: HOSTED_MEMBER_ASSISTANT_MODEL_SELECT,
    where: {
      id: input.memberId,
    },
  });
}

function resolveHostedMemberAssistantModel(
  member: HostedMemberAssistantModelState | null,
): HostedMemberAssistantModelResolution {
  if (!member) {
    return {
      model: HOSTED_ASSISTANT_TERRA_MODEL,
      solAvailable: false,
    };
  }

  const isThreadContainerMember = member.threadContainer !== null;
  const solAvailable = isHostedMemberSolModelEligible({
    billingStatus: member.billingStatus,
    currentBillingPhase: member.billingRef?.currentBillingPhase ?? null,
    currentBillingPlanCode: member.billingRef?.currentBillingPlanCode ?? null,
    isThreadContainerMember,
    suspendedAt: member.suspendedAt,
  });
  const usesSol = isThreadContainerMember
    || (solAvailable
      && member.assistantModelPreference === HOSTED_ASSISTANT_SOL_MODEL);

  return {
    ...(usesSol
      ? { hostedAssistantModelOverride: HOSTED_ASSISTANT_SOL_MODEL }
      : {}),
    model: usesSol
      ? HOSTED_ASSISTANT_SOL_MODEL
      : HOSTED_ASSISTANT_TERRA_MODEL,
    solAvailable,
  };
}
