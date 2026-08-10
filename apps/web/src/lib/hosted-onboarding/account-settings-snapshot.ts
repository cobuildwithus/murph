import "server-only";

import {
  isAssistantTonePreference,
  isAssistantVoiceOptionId,
  normalizeStoredAssistantPersonaId,
  type AssistantPersonaId,
  type AssistantTonePreference,
  type AssistantVoiceOptionId,
} from "@murphai/contracts";
import type {
  HostedAssistantProductModel,
  HostedAssistantProvider,
} from "@murphai/hosted-execution/assistant-model";
import { Prisma, type PrismaClient } from "@prisma/client";

import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { getPrisma } from "../prisma";
import {
  HOSTED_MEMBER_ASSISTANT_MODEL_SELECT,
  resolveAvailableHostedAssistantProvider,
  resolveHostedMemberAssistantModel,
} from "./assistant-model-preference";
import { createHostedMemberReplyAliasRouteFromLookupKey } from "./hosted-email-reply-alias";
import { projectHostedMemberEmailAuthorizationState } from "./hosted-member-store";
import type { HostedMemberStripeBillingRefSnapshot } from "./hosted-member-billing-store";
import {
  readHostedMemberBillingPrivateState,
  readHostedMemberIdentityPhoneNumber,
  readHostedMemberRoutingPrivateState,
} from "./member-private-codecs";
import {
  extractHostedPrivyEmailAccount,
  extractHostedPrivyTelegramAccount,
  type PrivyLinkedAccountLike,
} from "./privy-shared";

export interface HostedAccountSettingsSnapshot {
  assistant?: {
    configurationAvailable: boolean;
    dormantSolPreference: boolean;
    model: HostedAssistantProductModel;
    persona: AssistantPersonaId | null;
    provider?: HostedAssistantProvider;
    solAvailable: boolean;
    tone: AssistantTonePreference | null;
    voice: AssistantVoiceOptionId | null;
  };
  email: {
    address: string | null;
    murphEmailAddress?: string | null;
    /**
     * Whether the server-approved Privy session has an email linked. Privy's
     * headless update-email flow only works when this is true; otherwise the
     * email must be linked through Privy's own modal. Null when the Privy
     * session could not be confirmed server-side.
     */
    privyEmailLinked?: boolean | null;
    verifiedAt: string | null;
  };
  phone: {
    number: string | null;
    verifiedAt: string | null;
  };
  /**
   * Browser-local invalidation only; it grants no referral authority. Absent
   * only in inert legacy fixtures—the server projection always supplies it.
   */
  referralIdentityKey?: string;
  telegram: {
    telegramUserId: string | null;
    username?: string | null;
  };
}

export interface HostedAccountSettingsPageSnapshot {
  account: HostedAccountSettingsSnapshot;
  billingRef: HostedAccountSettingsBillingRef | null;
  routing: HostedAccountSettingsRouting | null;
}

export type HostedAccountSettingsBillingRef = Pick<
  HostedMemberStripeBillingRefSnapshot,
  | "currentBillingPhase"
  | "currentBillingPlanCode"
  | "currentCheckoutOffer"
  | "currentPeriodEnd"
  | "scheduledBillingEffectiveAt"
  | "scheduledBillingPlanCode"
  | "stripeCustomerId"
  | "stripeSubscriptionId"
>;

export interface HostedAccountSettingsRouting {
  linqRecipientPhone: string | null;
  pendingLinqRecipientPhone: string | null;
}

const hostedAccountSettingsMemberSelect =
  Prisma.validator<Prisma.HostedMemberSelect>()({
    ...HOSTED_MEMBER_ASSISTANT_MODEL_SELECT,
    assistantPersona: true,
    assistantTone: true,
    assistantVoice: true,
    billingRef: {
      select: {
        ...HOSTED_MEMBER_ASSISTANT_MODEL_SELECT.billingRef.select,
        currentCheckoutOffer: true,
        currentPeriodEnd: true,
        memberId: true,
        scheduledBillingEffectiveAt: true,
        scheduledBillingPlanCode: true,
        stripeCustomerIdEncrypted: true,
        stripeSubscriptionIdEncrypted: true,
      },
    },
    emailAuthorization: {
      select: {
        memberId: true,
        stripeCheckoutEmailAddressEncrypted: true,
        stripeCheckoutEmailCollectedAt: true,
        verifiedEmailAddressEncrypted: true,
        verifiedEmailLookupKey: true,
        verifiedEmailVerifiedAt: true,
      },
    },
    identity: {
      select: {
        memberId: true,
        phoneNumberEncrypted: true,
        phoneNumberVerifiedAt: true,
      },
    },
    routing: {
      select: {
        linqRecipientPhoneEncrypted: true,
        memberId: true,
        pendingLinqRecipientPhoneEncrypted: true,
        replyAliasLookupKey: true,
        telegramUserIdEncrypted: true,
      },
    },
  });

export async function readHostedAccountSettingsSnapshot(input: {
  memberId: string;
}): Promise<HostedAccountSettingsSnapshot> {
  return (await readHostedAccountSettingsPageSnapshot(input)).account;
}

export async function readHostedAccountSettingsPageSnapshot(input: {
  memberId: string;
  prisma?: PrismaClient;
}): Promise<HostedAccountSettingsPageSnapshot> {
  const prisma = input.prisma ?? getPrisma();
  const member = await prisma.hostedMember.findUnique({
    select: hostedAccountSettingsMemberSelect,
    where: {
      id: input.memberId,
    },
  });
  const assistantPreferences = {
    persona: normalizeStoredAssistantPersonaId(member?.assistantPersona ?? null),
    tone: isAssistantTonePreference(member?.assistantTone)
      ? member.assistantTone
      : null,
    voice: isAssistantVoiceOptionId(member?.assistantVoice)
      ? member.assistantVoice
      : null,
  };
  const assistantModel = resolveHostedMemberAssistantModel(member);
  const privateSettings = member
    ? await runWithHostedDomainRootUnwrapCache(async () => {
        const [billingPrivate, emailAuthorization, phoneNumber, routingPrivate] =
          await Promise.all([
            member.billingRef
              ? readHostedMemberBillingPrivateState(member.billingRef, prisma)
              : null,
            member.emailAuthorization
              ? projectHostedMemberEmailAuthorizationState(
                  {
                    ...member.emailAuthorization,
                    directPublicSenderAddressEncrypted: null,
                    directPublicSenderAuthorizedAt: null,
                    directPublicSenderLookupKey: null,
                  },
                  prisma,
                )
              : null,
            member.identity
              ? readHostedMemberIdentityPhoneNumber(member.identity, prisma)
              : null,
            member.routing
              ? readHostedMemberRoutingPrivateState(
                  {
                    ...member.routing,
                    linqChatIdEncrypted: null,
                    pendingLinqChatIdEncrypted: null,
                    pendingLinqParticipantContactEncrypted: null,
                  },
                  prisma,
                )
              : null,
          ]);

        return {
          billingPrivate,
          emailAuthorization,
          phoneNumber,
          routingPrivate,
        };
      })
    : null;
  const verifiedEmail = privateSettings?.emailAuthorization?.verifiedEmail ?? null;
  const murphEmailRoute = verifiedEmail
    ? await createHostedMemberReplyAliasRouteFromLookupKey({
        replyAliasLookupKey: member?.routing?.replyAliasLookupKey,
      })
    : null;
  const telegramUserId = privateSettings?.routingPrivate?.telegramUserId ?? null;

  return {
    account: {
      assistant: {
        configurationAvailable: assistantModel.configurationAvailable,
        dormantSolPreference: assistantModel.dormantSolPreference,
        model: assistantModel.model,
        provider: resolveAvailableHostedAssistantProvider(
          assistantModel.hostedAssistantProviderOverride,
        ),
        solAvailable: assistantModel.solAvailable,
        ...assistantPreferences,
      },
      email: {
        address: verifiedEmail?.address
          ?? privateSettings?.emailAuthorization?.stripeCheckoutEmail?.address
          ?? null,
        murphEmailAddress: murphEmailRoute?.address ?? null,
        verifiedAt: verifiedEmail?.verifiedAt.toISOString() ?? null,
      },
      phone: {
        number: privateSettings?.phoneNumber ?? null,
        verifiedAt: member?.identity?.phoneNumberVerifiedAt?.toISOString() ?? null,
      },
      referralIdentityKey: input.memberId,
      telegram: {
        telegramUserId,
      },
    },
    billingRef: member?.billingRef
      ? {
          currentBillingPhase: member.billingRef.currentBillingPhase,
          currentBillingPlanCode: member.billingRef.currentBillingPlanCode,
          currentCheckoutOffer: member.billingRef.currentCheckoutOffer,
          currentPeriodEnd: member.billingRef.currentPeriodEnd,
          scheduledBillingEffectiveAt: member.billingRef.scheduledBillingEffectiveAt,
          scheduledBillingPlanCode: member.billingRef.scheduledBillingPlanCode,
          stripeCustomerId: privateSettings?.billingPrivate?.stripeCustomerId ?? null,
          stripeSubscriptionId:
            privateSettings?.billingPrivate?.stripeSubscriptionId ?? null,
        }
      : null,
    routing: member?.routing
      ? {
          linqRecipientPhone:
            privateSettings?.routingPrivate?.linqRecipientPhone ?? null,
          pendingLinqRecipientPhone:
            privateSettings?.routingPrivate?.pendingLinqRecipientPhone ?? null,
        }
      : null,
  };
}

export function withServerApprovedPrivyAccountHints(input: {
  serverApprovedPrivyLinkedAccounts?: PrivyLinkedAccountLike[] | null;
  snapshot: HostedAccountSettingsSnapshot;
}): HostedAccountSettingsSnapshot {
  return {
    ...input.snapshot,
    email: {
      ...input.snapshot.email,
      privyEmailLinked: input.serverApprovedPrivyLinkedAccounts
        ? extractHostedPrivyEmailAccount(input.serverApprovedPrivyLinkedAccounts) !== null
        : null,
    },
    telegram: {
      ...input.snapshot.telegram,
      username: resolveHostedAccountTelegramUsername({
        serverApprovedPrivyLinkedAccounts: input.serverApprovedPrivyLinkedAccounts,
        telegramUserId: input.snapshot.telegram.telegramUserId,
      }),
    },
  };
}

function resolveHostedAccountTelegramUsername(input: {
  serverApprovedPrivyLinkedAccounts?: PrivyLinkedAccountLike[] | null;
  telegramUserId: string | null;
}): string | null {
  if (!input.telegramUserId) {
    return null;
  }

  const linkedTelegram = extractHostedPrivyTelegramAccount({
    linkedAccounts: input.serverApprovedPrivyLinkedAccounts ?? [],
  });

  return linkedTelegram?.telegramUserId === input.telegramUserId
    ? linkedTelegram.username
    : null;
}
