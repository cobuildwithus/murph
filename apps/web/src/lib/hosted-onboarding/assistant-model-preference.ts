import "server-only";

import {
  HostedBillingStatus,
  type Prisma,
} from "@prisma/client";
import {
  HOSTED_ASSISTANT_DEFAULT_REASONING_EFFORT,
  HOSTED_ASSISTANT_PRODUCT_MODELS,
  HOSTED_ASSISTANT_REASONING_EFFORTS,
  HOSTED_ASSISTANT_SOL_MODEL,
  HOSTED_ASSISTANT_TERRA_MODEL,
  isHostedAssistantReasoningEffort,
  parseHostedAssistantModelOverride,
  parseHostedAssistantReasoningEffortOverride,
  type HostedAssistantModelOverride,
  type HostedAssistantProductModel,
  type HostedAssistantReasoningEffort,
  type HostedAssistantReasoningEffortOverride,
} from "@murphai/hosted-execution/assistant-model";

import {
  parseHostedBillingPhase,
  parseHostedBillingPlanCode,
  parseHostedPlanCode,
} from "./billing-plans";
import { hasActiveHostedMemberAccess } from "./member-access";
import { hostedOnboardingError } from "./errors";
import {
  lockHostedMemberRow,
  lockHostedMemberSponsoredAccessRows,
} from "./shared";

const HOSTED_MEMBER_ASSISTANT_MODEL_SELECT = {
  accountGroupMemberships: {
    select: {
      group: {
        select: {
          billingStatus: true,
          suspendedAt: true,
        },
      },
      planCode: true,
      status: true,
    },
    where: {
      status: "active",
    },
  },
  assistantModelPreference: true,
  assistantReasoningEffortPreference: true,
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
  availableModels: readonly HostedAssistantProductModel[];
  availableReasoningEfforts: readonly HostedAssistantReasoningEffort[];
  configurationAvailable: boolean;
  dormantSolPreference: boolean;
  hostedAssistantModelOverride?: HostedAssistantModelOverride;
  hostedAssistantReasoningEffortOverride?: HostedAssistantReasoningEffortOverride;
  model: HostedAssistantProductModel;
  reasoningEffort: HostedAssistantReasoningEffort;
  solAvailable: boolean;
}

export interface HostedMemberAssistantModelUpdateResult
  extends HostedMemberAssistantModelResolution {
  effectiveModelUpdated: boolean;
  updated: boolean;
}

export function isHostedMemberSolModelEligible(input: {
  accountGroupMemberships: readonly {
    group: {
      billingStatus: HostedBillingStatus;
      suspendedAt: Date | null;
    };
    planCode: string;
    status: string;
  }[];
  billingStatus: HostedBillingStatus;
  currentBillingPhase: string | null;
  currentBillingPlanCode: string | null;
  isThreadContainerMember: boolean;
  suspendedAt: Date | null;
}): boolean {
  if (input.suspendedAt !== null || input.isThreadContainerMember) {
    return false;
  }

  const hasDirectPaidEdgeAccess =
    input.billingStatus === HostedBillingStatus.active
    && parseHostedBillingPhase(input.currentBillingPhase) === "paid"
    && parseHostedBillingPlanCode(input.currentBillingPlanCode) === "launch_edge_monthly";
  const hasFamilyEdgeAccess = input.accountGroupMemberships.some(
    (membership) => membership.status === "active"
      && parseHostedPlanCode(membership.planCode) === "edge"
      && membership.group.billingStatus === HostedBillingStatus.active
      && membership.group.suspendedAt === null,
  );

  return hasDirectPaidEdgeAccess || hasFamilyEdgeAccess;
}

export async function readHostedMemberAssistantModelPreference(input: {
  memberId: string;
  prisma: HostedMemberAssistantModelReadClient;
}): Promise<HostedMemberAssistantModelResolution> {
  const member = await readHostedMemberAssistantModelState(input);

  return resolveHostedMemberAssistantModel(member);
}

export async function assertHostedMemberAssistantPersonalizationEligible(input: {
  memberId: string;
  prisma: HostedMemberAssistantModelReadClient;
}): Promise<void> {
  const member = await readHostedMemberAssistantModelState(input);
  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 403,
      message: "Finish signup from your latest Murph link before continuing.",
    });
  }
  if (member.threadContainer !== null) {
    throw hostedOnboardingError({
      code: "ASSISTANT_PERSONALIZATION_PRIVATE_MEMBER_REQUIRED",
      httpStatus: 403,
      message: "Assistant personalization is available only in a private conversation.",
    });
  }
}

export async function updateHostedMemberAssistantModelPreferenceTx(input: {
  memberId: string;
  model: HostedAssistantProductModel;
  prisma: HostedMemberAssistantModelTransactionClient;
}): Promise<HostedMemberAssistantModelUpdateResult> {
  return updateHostedMemberAssistantConfigurationTx(input);
}

export async function updateHostedMemberAssistantConfigurationTx(input: {
  memberId: string;
  model?: HostedAssistantProductModel;
  prisma: HostedMemberAssistantModelTransactionClient;
  reasoningEffort?: HostedAssistantReasoningEffort;
}): Promise<HostedMemberAssistantModelUpdateResult> {
  if (input.model === undefined && input.reasoningEffort === undefined) {
    throw hostedOnboardingError({
      code: "ASSISTANT_CONFIGURATION_INVALID_REQUEST",
      httpStatus: 400,
      message: "Choose a model or reasoning effort to update.",
    });
  }
  await lockHostedMemberRow(input.prisma, input.memberId);
  await lockHostedMemberSponsoredAccessRows(input.prisma, input.memberId);

  const member = await readHostedMemberAssistantModelState(input);
  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 403,
      message: "Finish signup from your latest Murph link before continuing.",
    });
  }

  const current = resolveHostedMemberAssistantModel(member);
  if (!current.configurationAvailable) {
    throw hostedOnboardingError({
      code: member.threadContainer
        ? "ASSISTANT_CONFIGURATION_PERSONAL_CHAT_REQUIRED"
        : "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: member.threadContainer
        ? "Assistant model controls are available in your personal Murph chat."
        : "Active Murph access is required to change assistant settings.",
    });
  }
  if (input.model === HOSTED_ASSISTANT_SOL_MODEL && !current.solAvailable) {
    throw hostedOnboardingError({
      code: "ASSISTANT_MODEL_SOL_REQUIRES_EDGE",
      httpStatus: 403,
      message: "GPT-5.6 Sol requires an active paid Edge plan.",
    });
  }

  const nextModelPreference = input.model === undefined
    ? member.assistantModelPreference
    : input.model === HOSTED_ASSISTANT_TERRA_MODEL
      ? null
      : input.model;
  const nextReasoningEffortPreference = input.reasoningEffort === undefined
    ? member.assistantReasoningEffortPreference
    : input.reasoningEffort === HOSTED_ASSISTANT_DEFAULT_REASONING_EFFORT
      ? null
      : input.reasoningEffort;
  if (
    member.assistantModelPreference === nextModelPreference &&
    member.assistantReasoningEffortPreference === nextReasoningEffortPreference
  ) {
    return {
      ...current,
      effectiveModelUpdated: false,
      updated: false,
    };
  }

  await input.prisma.hostedMember.update({
    data: {
      ...(input.model === undefined
        ? {}
        : { assistantModelPreference: nextModelPreference }),
      ...(input.reasoningEffort === undefined
        ? {}
        : {
            assistantReasoningEffortPreference:
              nextReasoningEffortPreference,
          }),
    },
    where: {
      id: input.memberId,
    },
  });

  const updated = resolveHostedMemberAssistantModel({
    ...member,
    assistantModelPreference: nextModelPreference,
    assistantReasoningEffortPreference: nextReasoningEffortPreference,
  });
  return {
    ...updated,
    effectiveModelUpdated: current.model !== updated.model,
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
      availableModels: [],
      availableReasoningEfforts: [],
      configurationAvailable: false,
      dormantSolPreference: false,
      model: HOSTED_ASSISTANT_TERRA_MODEL,
      reasoningEffort: HOSTED_ASSISTANT_DEFAULT_REASONING_EFFORT,
      solAvailable: false,
    };
  }

  const isThreadContainerMember = member.threadContainer !== null;
  const configurationAvailable = isHostedPersonalAssistantConfigurationAvailable(
    member,
  );
  const solAvailable = isHostedMemberSolModelEligible({
    accountGroupMemberships: member.accountGroupMemberships,
    billingStatus: member.billingStatus,
    currentBillingPhase: member.billingRef?.currentBillingPhase ?? null,
    currentBillingPlanCode: member.billingRef?.currentBillingPlanCode ?? null,
    isThreadContainerMember,
    suspendedAt: member.suspendedAt,
  });
  const storedModelOverride = configurationAvailable
    ? parseHostedAssistantModelOverride(member.assistantModelPreference)
    : null;
  const dormantSolPreference =
    storedModelOverride === HOSTED_ASSISTANT_SOL_MODEL && !solAvailable;
  const model = isThreadContainerMember
    ? HOSTED_ASSISTANT_SOL_MODEL
    : dormantSolPreference
      ? HOSTED_ASSISTANT_TERRA_MODEL
      : storedModelOverride ?? HOSTED_ASSISTANT_TERRA_MODEL;
  const storedReasoningEffort = configurationAvailable &&
      isHostedAssistantReasoningEffort(member.assistantReasoningEffortPreference)
    ? member.assistantReasoningEffortPreference
    : HOSTED_ASSISTANT_DEFAULT_REASONING_EFFORT;
  const reasoningEffortOverride = parseHostedAssistantReasoningEffortOverride(
    storedReasoningEffort,
  );

  return {
    availableModels: configurationAvailable
      ? HOSTED_ASSISTANT_PRODUCT_MODELS.filter(
          (candidate) => candidate !== HOSTED_ASSISTANT_SOL_MODEL || solAvailable,
        )
      : [],
    availableReasoningEfforts: configurationAvailable
      ? HOSTED_ASSISTANT_REASONING_EFFORTS
      : [],
    configurationAvailable,
    dormantSolPreference,
    ...(model !== HOSTED_ASSISTANT_TERRA_MODEL
      ? { hostedAssistantModelOverride: model }
      : {}),
    ...(reasoningEffortOverride
      ? { hostedAssistantReasoningEffortOverride: reasoningEffortOverride }
      : {}),
    model,
    reasoningEffort: storedReasoningEffort,
    solAvailable,
  };
}

function isHostedPersonalAssistantConfigurationAvailable(
  member: HostedMemberAssistantModelState,
): boolean {
  if (member.threadContainer !== null) {
    return false;
  }

  return hasActiveHostedMemberAccess({
    accountGroupMemberships: member.accountGroupMemberships,
    billingStatus: member.billingStatus,
    suspendedAt: member.suspendedAt,
    threadContainer: null,
  });
}
