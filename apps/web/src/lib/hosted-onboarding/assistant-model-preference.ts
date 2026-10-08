import "server-only";

import {
  HostedBillingStatus,
  type Prisma,
} from "@prisma/client";
import {
  HOSTED_ASSISTANT_ASTRA_MODEL,
  HOSTED_ASSISTANT_DEFAULT_MODEL,
  HOSTED_ASSISTANT_DEFAULT_REASONING_EFFORT,
  HOSTED_ASSISTANT_PRODUCT_MODELS,
  HOSTED_ASSISTANT_REASONING_EFFORTS,
  HOSTED_ASSISTANT_SOL_MODEL,
  isHostedAssistantProductModel,
  isHostedAssistantReasoningEffort,
  parseHostedAssistantModelOverride,
  parseHostedAssistantReasoningEffortOverride,
  type HostedAssistantModelOverride,
  type HostedAssistantProductModel,
  type HostedAssistantReasoningEffort,
  type HostedAssistantReasoningEffortOverride,
} from "@murphai/hosted-execution/assistant-model";

import {
  getHostedFamilyRuntimePlanCode,
  parseHostedBillingPhase,
  parseHostedBillingPlanCode,
  parseHostedFamilyPlanCode,
} from "./billing-plans";
import {
  hasActiveHostedMemberAccess,
  type HostedMemberPersonAccessState,
} from "./member-access";
import { hostedOnboardingError } from "./errors";
import {
  lockHostedMemberRow,
  lockHostedMemberSponsoredAccessRows,
} from "./shared";

export const HOSTED_MEMBER_ASSISTANT_MODEL_SELECT = {
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
  createdAt: true,
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
  hostedAssistantPriorityUntil?: string;
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

  const directBillingPlanCode = parseHostedBillingPlanCode(
    input.currentBillingPlanCode,
  );
  const hasDirectPaidPremiumAccess =
    input.billingStatus === HostedBillingStatus.active
    && parseHostedBillingPhase(input.currentBillingPhase) === "paid"
    && (
      directBillingPlanCode === "launch_edge_monthly"
      || directBillingPlanCode === "launch_max_monthly"
    );
  const hasFamilyPremiumAccess = input.accountGroupMemberships.some((membership) => {
    const familyPlanCode = parseHostedFamilyPlanCode(membership.planCode);
    return membership.status === "active"
      && familyPlanCode !== null
      && getHostedFamilyRuntimePlanCode(familyPlanCode) === "edge"
      && membership.group.billingStatus === HostedBillingStatus.active
      && membership.group.suspendedAt === null;
  });

  return hasDirectPaidPremiumAccess || hasFamilyPremiumAccess;
}

export async function readHostedMemberAssistantModelPreference(input: {
  memberId: string;
  prisma: HostedMemberAssistantModelReadClient;
}): Promise<HostedMemberAssistantModelResolution> {
  const member = await readHostedMemberAssistantModelState(input);

  return {
    ...resolveHostedMemberAssistantModel(member),
    ...(member?.threadContainer === null && member.createdAt
      ? {
          hostedAssistantPriorityUntil: new Date(
            member.createdAt.getTime() + 86_400_000,
          ).toISOString(),
        }
      : {}),
  };
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
  if (
    input.model === undefined
    && input.reasoningEffort === undefined
  ) {
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

  const isThreadContainerMember = member.threadContainer !== null;
  const current = resolveHostedMemberAssistantModel(member);
  if (!current.configurationAvailable) {
    throw hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Active Murph access is required to change assistant settings.",
    });
  }
  if (
    isThreadContainerMember
    && input.reasoningEffort !== undefined
  ) {
    throw hostedOnboardingError({
      code: "ASSISTANT_CONFIGURATION_PERSONAL_CHAT_REQUIRED",
      httpStatus: 403,
      message:
        "Group rooms support model changes only. Reasoning controls are available in your personal Murph chat.",
    });
  }
  assertHostedAssistantModelSelection({
    current,
    model: input.model,
  });

  const nextModelPreference = input.model === undefined
    ? member.assistantModelPreference
    : input.model === HOSTED_ASSISTANT_DEFAULT_MODEL
      ? null
      : input.model;
  const nextReasoningEffortPreference = input.reasoningEffort === undefined
    ? member.assistantReasoningEffortPreference
    : input.reasoningEffort === HOSTED_ASSISTANT_DEFAULT_REASONING_EFFORT
      ? null
      : input.reasoningEffort;
  if (
    member.assistantModelPreference === nextModelPreference
    && member.assistantReasoningEffortPreference === nextReasoningEffortPreference
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

function assertHostedAssistantModelSelection(input: {
  current: HostedMemberAssistantModelResolution;
  model: HostedAssistantProductModel | undefined;
}): void {
  if (input.model === HOSTED_ASSISTANT_SOL_MODEL && !input.current.solAvailable) {
    throw hostedOnboardingError({
      code: "ASSISTANT_MODEL_SOL_REQUIRES_EDGE",
      httpStatus: 403,
      message: "GPT-5.6 Sol requires an active paid Edge or Max plan.",
    });
  }
  if (input.model === HOSTED_ASSISTANT_ASTRA_MODEL
      && !input.current.availableModels.includes(HOSTED_ASSISTANT_ASTRA_MODEL)) {
    throw hostedOnboardingError({
      code: "ASSISTANT_MODEL_ASTRA_REQUIRES_EDGE",
      httpStatus: 403,
      message: "GPT-6 Astra requires an active paid Edge or Max plan.",
    });
  }
}

function resolveEffectiveHostedAssistantModel(input: {
  astraAvailable: boolean;
  solAvailable: boolean;
  storedModel: HostedAssistantProductModel | null;
}): HostedAssistantProductModel {
  if (input.storedModel === HOSTED_ASSISTANT_ASTRA_MODEL && !input.astraAvailable) {
    return HOSTED_ASSISTANT_DEFAULT_MODEL;
  }
  if (input.storedModel === HOSTED_ASSISTANT_SOL_MODEL && !input.solAvailable) {
    return HOSTED_ASSISTANT_DEFAULT_MODEL;
  }
  return input.storedModel ?? HOSTED_ASSISTANT_DEFAULT_MODEL;
}

export function resolveHostedMemberAssistantModel(
  member: HostedMemberAssistantModelState | null,
): HostedMemberAssistantModelResolution {
  if (!member) {
    return {
      availableModels: [],
      availableReasoningEfforts: [],
      configurationAvailable: false,
      dormantSolPreference: false,
      model: HOSTED_ASSISTANT_DEFAULT_MODEL,
      reasoningEffort: HOSTED_ASSISTANT_DEFAULT_REASONING_EFFORT,
      solAvailable: false,
    };
  }

  const isThreadContainerMember = member.threadContainer !== null;
  const configurationAvailable = isThreadContainerMember
    ? member.suspendedAt === null
    : isHostedPersonalAssistantConfigurationAvailable(member);
  const solAvailable = isThreadContainerMember || isHostedMemberSolModelEligible({
    accountGroupMemberships: member.accountGroupMemberships,
    billingStatus: member.billingStatus,
    currentBillingPhase: member.billingRef?.currentBillingPhase ?? null,
    currentBillingPlanCode: member.billingRef?.currentBillingPlanCode ?? null,
    isThreadContainerMember,
    suspendedAt: member.suspendedAt,
  });
  const astraAvailable = !isThreadContainerMember && solAvailable;
  const storedModelPreference = configurationAvailable
    ? isThreadContainerMember
      ? isHostedAssistantProductModel(member.assistantModelPreference)
        ? member.assistantModelPreference
        : null
      : parseHostedAssistantModelOverride(member.assistantModelPreference)
    : null;
  const dormantSolPreference =
    !isThreadContainerMember
    && storedModelPreference === HOSTED_ASSISTANT_SOL_MODEL
    && !solAvailable;
  const model = resolveEffectiveHostedAssistantModel({
    astraAvailable,
    solAvailable,
    storedModel: storedModelPreference,
  });
  const storedReasoningEffort = configurationAvailable &&
      !isThreadContainerMember &&
      isHostedAssistantReasoningEffort(member.assistantReasoningEffortPreference)
    ? member.assistantReasoningEffortPreference
    : HOSTED_ASSISTANT_DEFAULT_REASONING_EFFORT;
  const reasoningEffortOverride = parseHostedAssistantReasoningEffortOverride(
    storedReasoningEffort,
  );

  return {
    availableModels: configurationAvailable
      ? HOSTED_ASSISTANT_PRODUCT_MODELS.filter(
          (candidate) => (candidate !== HOSTED_ASSISTANT_SOL_MODEL || solAvailable)
            && (candidate !== HOSTED_ASSISTANT_ASTRA_MODEL || astraAvailable),
        )
      : [],
    availableReasoningEfforts: configurationAvailable
      ? isThreadContainerMember
        ? [HOSTED_ASSISTANT_DEFAULT_REASONING_EFFORT]
        : HOSTED_ASSISTANT_REASONING_EFFORTS
      : [],
    configurationAvailable,
    dormantSolPreference,
    hostedAssistantModelOverride: model,
    ...(reasoningEffortOverride
      ? { hostedAssistantReasoningEffortOverride: reasoningEffortOverride }
      : {}),
    model,
    reasoningEffort: storedReasoningEffort,
    solAvailable,
  };
}

function isHostedPersonalAssistantConfigurationAvailable(
  member: HostedMemberPersonAccessState & { threadContainer?: object | null },
): boolean {
  if (member.threadContainer) {
    return false;
  }

  return hasActiveHostedMemberAccess({
    accountGroupMemberships: member.accountGroupMemberships,
    billingStatus: member.billingStatus,
    suspendedAt: member.suspendedAt,
    threadContainer: null,
  });
}
