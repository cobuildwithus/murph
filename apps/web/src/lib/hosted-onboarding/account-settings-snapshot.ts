import "server-only";

import {
  assistantWebPersonalitySettingIds,
  type AssistantPersonaId,
  type AssistantTonePreference,
  type AssistantVoiceOptionId,
  type AssistantWebPersonalitySettingId,
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
import { projectHostedMemberAssistantPreferences } from "./member-preferences";
import {
  extractHostedPrivyEmailAccount,
  extractHostedPrivyPhoneAccount,
  extractHostedPrivyVerifiedEmailAccount,
  resolveHostedPrivyLinkedAccounts,
  resolveHostedPrivyTelegramAccountSelection,
  type HostedPrivyLinkedAccountContainer,
} from "./privy-shared";
import { normalizePhoneNumber } from "./phone";
import type { HostedPrivyAuthMethod } from "./types";

export type HostedPrivySignInStatus =
  | "absent"
  | "ambiguous"
  | "matched"
  | "mismatched";

export interface HostedPrivySignInState {
  removable: boolean;
  status: HostedPrivySignInStatus;
}

export interface HostedAccountSettingsSnapshot {
  assistant?: {
    configurationAvailable: boolean;
    dormantSolPreference: boolean;
    model: HostedAssistantProductModel;
    persona: AssistantPersonaId | null;
    personality: Record<AssistantWebPersonalitySettingId, number | null>;
    provider?: HostedAssistantProvider;
    solAvailable: boolean;
    tone: AssistantTonePreference | null;
    voice: AssistantVoiceOptionId | null;
  };
  email: {
    address: string | null;
    murphEmailAddress?: string | null;
    verifiedAt: string | null;
  };
  phone: {
    number: string | null;
    verifiedAt: string | null;
  };
  /** One server-derived source of truth for provider/canonical agreement. */
  privySignInStates?: Record<HostedPrivyAuthMethod, HostedPrivySignInState> | null;
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
    assistantDetail: true,
    assistantHumor: true,
    assistantPersona: true,
    assistantPush: true,
    assistantUnhinged: true,
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
  const projectedAssistantPreferences = projectHostedMemberAssistantPreferences(member);
  // Only the web-visible dials reach the browser Settings payload. `unhinged`
  // is conversational-only and must never be projected into client state.
  const webPersonality = {} as Record<AssistantWebPersonalitySettingId, number | null>;
  for (const id of assistantWebPersonalitySettingIds) {
    webPersonality[id] = projectedAssistantPreferences.personality[id];
  }
  const assistantPreferences = {
    persona: projectedAssistantPreferences.persona,
    personality: webPersonality,
    tone: projectedAssistantPreferences.tone,
    voice: projectedAssistantPreferences.voice,
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
  serverApprovedPrivyUser?: HostedPrivyLinkedAccountContainer | null;
  snapshot: HostedAccountSettingsSnapshot;
}): HostedAccountSettingsSnapshot {
  const providerUser = input.serverApprovedPrivyUser;
  const privySignInStates = providerUser
    ? resolveHostedPrivySignInStates(input.snapshot, providerUser)
    : null;

  return {
    ...input.snapshot,
    privySignInStates,
    telegram: {
      ...input.snapshot.telegram,
      username: resolveHostedAccountTelegramUsername({
        serverApprovedPrivyUser: providerUser,
        telegramUserId: input.snapshot.telegram.telegramUserId,
      }),
    },
  };
}

function resolveHostedPrivySignInStates(
  snapshot: HostedAccountSettingsSnapshot,
  providerUser: HostedPrivyLinkedAccountContainer,
): Record<HostedPrivyAuthMethod, HostedPrivySignInState> {
  const linkedAccounts = resolveHostedPrivyLinkedAccounts(providerUser);
  const linkedPhone = extractHostedPrivyPhoneAccount(linkedAccounts);
  const linkedEmail = extractHostedPrivyEmailAccount(linkedAccounts);
  const telegramSelection = resolveHostedPrivyTelegramAccountSelection(providerUser);
  const verifiedMethods = new Set<HostedPrivyAuthMethod>([
    ...(linkedPhone ? ["phone" as const] : []),
    ...(extractHostedPrivyVerifiedEmailAccount(linkedAccounts)
      ? ["email" as const]
      : []),
    ...(telegramSelection.account
      ? ["telegram" as const]
      : []),
  ]);
  const hasAlternative = (method: HostedPrivyAuthMethod) =>
    [...verifiedMethods].some((candidate) => candidate !== method);

  const phoneStatus = resolvePrivySignInStatus(
    normalizePhoneNumber(snapshot.phone.number),
    linkedPhone?.number ?? null,
  );
  const emailStatus = resolvePrivySignInStatus(
    normalizeComparableEmail(snapshot.email.address),
    normalizeComparableEmail(linkedEmail?.address),
  );
  const telegramStatus = telegramSelection.ambiguous
    ? "ambiguous"
    : resolvePrivySignInStatus(
        snapshot.telegram.telegramUserId,
        telegramSelection.account?.telegramUserId ?? null,
      );

  return {
    email: {
      removable:
        emailStatus === "matched"
        && Boolean(snapshot.email.verifiedAt)
        && hasAlternative("email"),
      status: emailStatus,
    },
    phone: {
      removable:
        phoneStatus === "matched"
        && Boolean(snapshot.phone.verifiedAt)
        && hasAlternative("phone"),
      status: phoneStatus,
    },
    telegram: {
      removable: telegramStatus === "matched" && hasAlternative("telegram"),
      status: telegramStatus,
    },
  };
}

function resolvePrivySignInStatus(
  canonicalIdentity: string | null | undefined,
  providerIdentity: string | null | undefined,
): HostedPrivySignInStatus {
  if (!providerIdentity) {
    return "absent";
  }

  return canonicalIdentity === providerIdentity ? "matched" : "mismatched";
}

function normalizeComparableEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function resolveHostedAccountTelegramUsername(input: {
  serverApprovedPrivyUser?: HostedPrivyLinkedAccountContainer | null;
  telegramUserId: string | null;
}): string | null {
  if (!input.telegramUserId) {
    return null;
  }

  const telegramSelection = resolveHostedPrivyTelegramAccountSelection(
    input.serverApprovedPrivyUser,
  );
  const linkedTelegram = telegramSelection.account;

  return !telegramSelection.ambiguous
    && linkedTelegram?.telegramUserId === input.telegramUserId
    ? linkedTelegram.username
    : null;
}
