import "server-only";

import type {
  AssistantPersonalitySettingId,
  AssistantTonePreference,
  AssistantVoiceOptionId,
} from "@murphai/contracts";
import type { HostedAssistantProductModel } from "@murphai/hosted-execution/assistant-model";

import { getPrisma } from "../prisma";
import { readHostedMemberAssistantModelPreference } from "./assistant-model-preference";
import { createHostedMemberReplyAliasRouteFromLookupKey } from "./hosted-email-reply-alias";
import { readHostedMemberSnapshot } from "./hosted-member-store";
import { readHostedMemberAssistantPreferences } from "./member-preferences";
import {
  extractHostedPrivyEmailAccount,
  extractHostedPrivyTelegramAccount,
  type PrivyLinkedAccountLike,
} from "./privy-shared";

export interface HostedAccountSettingsSnapshot {
  assistant?: {
    model: HostedAssistantProductModel;
    personality: Record<AssistantPersonalitySettingId, number | null>;
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
  telegram: {
    telegramUserId: string | null;
    username?: string | null;
  };
}

export async function readHostedAccountSettingsSnapshot(input: {
  memberId: string;
}): Promise<HostedAccountSettingsSnapshot> {
  const prisma = getPrisma();
  const [snapshot, assistantPreferences, assistantModel] = await Promise.all([
    readHostedMemberSnapshot({
      memberId: input.memberId,
      prisma,
    }),
    readHostedMemberAssistantPreferences({
      memberId: input.memberId,
      prisma,
    }),
    readHostedMemberAssistantModelPreference({
      memberId: input.memberId,
      prisma,
    }),
  ]);
  const verifiedEmail = snapshot?.emailAuthorization?.verifiedEmail ?? null;
  const murphEmailRoute = verifiedEmail
    ? await createHostedMemberReplyAliasRouteFromLookupKey({
        replyAliasLookupKey: snapshot?.routing?.replyAliasLookupKey,
      })
    : null;
  const telegramUserId = snapshot?.routing?.telegramUserId ?? null;

  return {
    assistant: {
      model: assistantModel.model,
      solAvailable: assistantModel.solAvailable,
      ...assistantPreferences,
    },
    email: {
      address: verifiedEmail?.address
        ?? snapshot?.emailAuthorization?.stripeCheckoutEmail?.address
        ?? null,
      murphEmailAddress: murphEmailRoute?.address ?? null,
      verifiedAt: verifiedEmail?.verifiedAt.toISOString() ?? null,
    },
    phone: {
      number: snapshot?.identity?.phoneNumber ?? null,
      verifiedAt: snapshot?.identity?.phoneNumberVerifiedAt?.toISOString() ?? null,
    },
    telegram: {
      telegramUserId,
    },
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
