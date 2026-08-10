import "server-only";

import {
  HostedBillingStatus,
  type Prisma,
} from "@prisma/client";
import {
  HOSTED_ASSISTANT_DEFAULT_PROVIDER,
  HOSTED_ASSISTANT_DEFAULT_REASONING_EFFORT,
  HOSTED_ASSISTANT_PRODUCT_MODELS,
  HOSTED_ASSISTANT_REASONING_EFFORTS,
  HOSTED_ASSISTANT_SOL_MODEL,
  HOSTED_ASSISTANT_TERRA_MODEL,
  HOSTED_ASSISTANT_VENICE_PROVIDER,
  isHostedAssistantProductModel,
  isHostedAssistantReasoningEffort,
  parseHostedAssistantModelOverride,
  parseHostedAssistantProviderOverride,
  parseHostedAssistantReasoningEffortOverride,
  type HostedAssistantModelOverride,
  type HostedAssistantProductModel,
  type HostedAssistantProvider,
  type HostedAssistantProviderOverride,
  type HostedAssistantReasoningEffort,
  type HostedAssistantReasoningEffortOverride,
} from "@murphai/hosted-execution/assistant-model";
import {
  HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE,
  buildHostedCustomInferenceModelAlias,
  requireHostedInferenceProtocol,
  type HostedAssistantCustomInferenceOverride,
} from "@murphai/hosted-execution/assistant-inference";

import {
  getHostedFamilyRuntimePlanCode,
  parseHostedBillingPhase,
  parseHostedBillingPlanCode,
  parseHostedFamilyPlanCode,
} from "./billing-plans";
import { hasActiveHostedMemberAccess } from "./member-access";
import { hostedOnboardingError } from "./errors";
import {
  lockHostedMemberRow,
  lockHostedMemberSponsoredAccessRows,
} from "./shared";

const HOSTED_VENICE_ENABLED_ENV = "HOSTED_VENICE_ENABLED";
const HOSTED_VENICE_ENABLED_VALUES = new Set(["1", "enabled", "on", "true", "yes"]);

export function isHostedVeniceAssistantEnabled(
  source: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const value = source[HOSTED_VENICE_ENABLED_ENV]?.trim().toLowerCase() ?? "";
  return HOSTED_VENICE_ENABLED_VALUES.has(value);
}

export function resolveAvailableHostedAssistantProvider(
  providerOverride: HostedAssistantProviderOverride | null | undefined,
  source: Readonly<Record<string, string | undefined>> = process.env,
): HostedAssistantProvider {
  return providerOverride === HOSTED_ASSISTANT_VENICE_PROVIDER
      && isHostedVeniceAssistantEnabled(source)
    ? HOSTED_ASSISTANT_VENICE_PROVIDER
    : HOSTED_ASSISTANT_DEFAULT_PROVIDER;
}

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
  assistantProviderPreference: true,
  assistantReasoningEffortPreference: true,
  billingRef: {
    select: {
      currentBillingPhase: true,
      currentBillingPlanCode: true,
    },
  },
  billingStatus: true,
  inferenceConnection: {
    select: {
      contextWindowTokens: true,
      protocol: true,
      revision: true,
      selected: true,
      supportsImages: true,
      verificationProfile: true,
    },
  },
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
  availableProviders: readonly HostedAssistantProvider[];
  availableReasoningEfforts: readonly HostedAssistantReasoningEffort[];
  configurationAvailable: boolean;
  customInferenceReverificationRequired: boolean;
  customInferenceSelected: boolean;
  dormantSolPreference: boolean;
  hostedAssistantCustomInferenceOverride?: HostedAssistantCustomInferenceOverride;
  hostedAssistantModelOverride?: HostedAssistantModelOverride;
  hostedAssistantProviderOverride?: HostedAssistantProviderOverride;
  hostedAssistantReasoningEffortOverride?: HostedAssistantReasoningEffortOverride;
  model: HostedAssistantProductModel;
  provider: HostedAssistantProvider;
  reasoningEffort: HostedAssistantReasoningEffort;
  solAvailable: boolean;
}

export interface HostedMemberAssistantModelUpdateResult
  extends HostedMemberAssistantModelResolution {
  effectiveModelUpdated: boolean;
  effectiveProviderUpdated: boolean;
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

  return resolveHostedMemberAssistantModel(member);
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
  provider?: HostedAssistantProvider;
  reasoningEffort?: HostedAssistantReasoningEffort;
}): Promise<HostedMemberAssistantModelUpdateResult> {
  if (
    input.model === undefined
    && input.provider === undefined
    && input.reasoningEffort === undefined
  ) {
    throw hostedOnboardingError({
      code: "ASSISTANT_CONFIGURATION_INVALID_REQUEST",
      httpStatus: 400,
      message: "Choose a provider, model, or reasoning effort to update.",
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
    && (input.provider !== undefined || input.reasoningEffort !== undefined)
  ) {
    throw hostedOnboardingError({
      code: "ASSISTANT_CONFIGURATION_PERSONAL_CHAT_REQUIRED",
      httpStatus: 403,
      message:
        "Group rooms support model changes only. Provider and reasoning controls are available in your personal Murph chat.",
    });
  }
  if (
    input.provider === HOSTED_ASSISTANT_VENICE_PROVIDER
    && !isHostedVeniceAssistantEnabled()
  ) {
    throw hostedOnboardingError({
      code: "ASSISTANT_PROVIDER_VENICE_UNAVAILABLE",
      httpStatus: 403,
      message: "Venice is not available for this Murph deployment.",
    });
  }
  if (input.model === HOSTED_ASSISTANT_SOL_MODEL && !current.solAvailable) {
    throw hostedOnboardingError({
      code: "ASSISTANT_MODEL_SOL_REQUIRES_EDGE",
      httpStatus: 403,
      message: "GPT-5.6 Sol requires an active paid Edge or Max plan.",
    });
  }

  const defaultModel = isThreadContainerMember
    ? HOSTED_ASSISTANT_SOL_MODEL
    : HOSTED_ASSISTANT_TERRA_MODEL;
  const nextModelPreference = input.model === undefined
    ? member.assistantModelPreference
    : input.model === defaultModel
      ? null
      : input.model;
  const nextProviderPreference = input.provider === undefined
    ? member.assistantProviderPreference
    : input.provider === HOSTED_ASSISTANT_DEFAULT_PROVIDER
      ? null
      : input.provider;
  const nextReasoningEffortPreference = input.reasoningEffort === undefined
    ? member.assistantReasoningEffortPreference
    : input.reasoningEffort === HOSTED_ASSISTANT_DEFAULT_REASONING_EFFORT
      ? null
      : input.reasoningEffort;
  if (
    member.assistantModelPreference === nextModelPreference
    && member.assistantProviderPreference === nextProviderPreference
    && member.assistantReasoningEffortPreference === nextReasoningEffortPreference
  ) {
    return {
      ...current,
      effectiveModelUpdated: false,
      effectiveProviderUpdated: false,
      updated: false,
    };
  }

  await input.prisma.hostedMember.update({
    data: {
      ...(input.model === undefined
        ? {}
        : { assistantModelPreference: nextModelPreference }),
      ...(input.provider === undefined
        ? {}
        : { assistantProviderPreference: nextProviderPreference }),
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
    assistantProviderPreference: nextProviderPreference,
    assistantReasoningEffortPreference: nextReasoningEffortPreference,
  });
  return {
    ...updated,
    effectiveModelUpdated:
      current.model !== updated.model
      || current.hostedAssistantProviderOverride
        !== updated.hostedAssistantProviderOverride,
    effectiveProviderUpdated: current.provider !== updated.provider,
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

export function resolveHostedMemberAssistantModel(
  member: HostedMemberAssistantModelState | null,
): HostedMemberAssistantModelResolution {
  if (!member) {
    return {
      availableModels: [],
      availableProviders: [],
      availableReasoningEfforts: [],
      configurationAvailable: false,
      customInferenceReverificationRequired: false,
      customInferenceSelected: false,
      dormantSolPreference: false,
      model: HOSTED_ASSISTANT_TERRA_MODEL,
      provider: HOSTED_ASSISTANT_DEFAULT_PROVIDER,
      reasoningEffort: HOSTED_ASSISTANT_DEFAULT_REASONING_EFFORT,
      solAvailable: false,
    };
  }

  const isThreadContainerMember = member.threadContainer !== null;
  const configurationAvailable = isThreadContainerMember
    ? member.suspendedAt === null
    : isHostedPersonalAssistantConfigurationAvailable(member);
  const inferenceConnection = configurationAvailable && !isThreadContainerMember
    ? member.inferenceConnection
    : null;
  const customInferenceSelected = inferenceConnection?.selected === true;
  const customInferenceReverificationRequired = customInferenceSelected
    && inferenceConnection.verificationProfile
      !== HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE;
  const customInferenceOverride = customInferenceSelected
      && !customInferenceReverificationRequired
      && inferenceConnection
    ? {
        contextWindowTokens: inferenceConnection.contextWindowTokens,
        modelAlias: buildHostedCustomInferenceModelAlias(
          inferenceConnection.revision,
        ),
        protocol: requireHostedInferenceProtocol(
          inferenceConnection.protocol,
        ),
        revision: inferenceConnection.revision,
        supportsImages: inferenceConnection.supportsImages,
        verificationProfile: inferenceConnection.verificationProfile,
      } satisfies HostedAssistantCustomInferenceOverride
    : null;
  const solAvailable = isThreadContainerMember || isHostedMemberSolModelEligible({
    accountGroupMemberships: member.accountGroupMemberships,
    billingStatus: member.billingStatus,
    currentBillingPhase: member.billingRef?.currentBillingPhase ?? null,
    currentBillingPlanCode: member.billingRef?.currentBillingPlanCode ?? null,
    isThreadContainerMember,
    suspendedAt: member.suspendedAt,
  });
  const storedModelPreference = configurationAvailable
    ? isThreadContainerMember
      ? isHostedAssistantProductModel(member.assistantModelPreference)
        ? member.assistantModelPreference
        : null
      : parseHostedAssistantModelOverride(member.assistantModelPreference)
    : null;
  const storedProviderOverride = configurationAvailable && !isThreadContainerMember
    ? parseHostedAssistantProviderOverride(member.assistantProviderPreference)
    : null;
  const dormantSolPreference =
    !isThreadContainerMember
    && storedModelPreference === HOSTED_ASSISTANT_SOL_MODEL
    && !solAvailable;
  const model = isThreadContainerMember
    ? storedModelPreference ?? HOSTED_ASSISTANT_SOL_MODEL
    : dormantSolPreference
      ? HOSTED_ASSISTANT_TERRA_MODEL
      : storedModelPreference ?? HOSTED_ASSISTANT_TERRA_MODEL;
  const storedReasoningEffort = configurationAvailable &&
      !isThreadContainerMember &&
      isHostedAssistantReasoningEffort(member.assistantReasoningEffortPreference)
    ? member.assistantReasoningEffortPreference
    : HOSTED_ASSISTANT_DEFAULT_REASONING_EFFORT;
  const reasoningEffortOverride = parseHostedAssistantReasoningEffortOverride(
    storedReasoningEffort,
  );
  const provider = resolveAvailableHostedAssistantProvider(storedProviderOverride);

  return {
    availableModels: configurationAvailable
      ? HOSTED_ASSISTANT_PRODUCT_MODELS.filter(
          (candidate) => candidate !== HOSTED_ASSISTANT_SOL_MODEL || solAvailable,
        )
      : [],
    availableProviders: configurationAvailable
      ? isThreadContainerMember
        ? [HOSTED_ASSISTANT_DEFAULT_PROVIDER]
        : isHostedVeniceAssistantEnabled()
          ? [HOSTED_ASSISTANT_DEFAULT_PROVIDER, HOSTED_ASSISTANT_VENICE_PROVIDER]
          : [HOSTED_ASSISTANT_DEFAULT_PROVIDER]
      : [],
    availableReasoningEfforts: configurationAvailable
      ? isThreadContainerMember
        ? [HOSTED_ASSISTANT_DEFAULT_REASONING_EFFORT]
        : HOSTED_ASSISTANT_REASONING_EFFORTS
      : [],
    configurationAvailable,
    customInferenceReverificationRequired,
    customInferenceSelected,
    dormantSolPreference,
    ...(customInferenceOverride
      ? { hostedAssistantCustomInferenceOverride: customInferenceOverride }
      : {}),
    ...(model !== HOSTED_ASSISTANT_TERRA_MODEL
      ? { hostedAssistantModelOverride: model }
      : {}),
    ...(storedProviderOverride
      ? { hostedAssistantProviderOverride: storedProviderOverride }
      : {}),
    ...(reasoningEffortOverride
      ? { hostedAssistantReasoningEffortOverride: reasoningEffortOverride }
      : {}),
    model,
    provider,
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
