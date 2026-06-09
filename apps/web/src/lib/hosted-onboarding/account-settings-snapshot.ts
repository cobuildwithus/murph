import "server-only";

import { getPrisma } from "../prisma";
import { createHostedMemberReplyAliasRouteFromLookupKey } from "./hosted-email-reply-alias";
import { readHostedMemberSnapshot } from "./hosted-member-store";
import {
  extractHostedPrivyTelegramAccount,
  type PrivyLinkedAccountLike,
} from "./privy-shared";

export interface HostedAccountSettingsSnapshot {
  email: {
    address: string | null;
    murphEmailAddress?: string | null;
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
  const snapshot = await readHostedMemberSnapshot({
    memberId: input.memberId,
    prisma: getPrisma(),
  });
  const verifiedEmail = snapshot?.emailAuthorization?.verifiedEmail ?? null;
  const murphEmailRoute = verifiedEmail
    ? await createHostedMemberReplyAliasRouteFromLookupKey({
        replyAliasLookupKey: snapshot?.routing?.replyAliasLookupKey,
      })
    : null;
  const telegramUserId = snapshot?.routing?.telegramUserId ?? null;

  return {
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

export function withServerApprovedTelegramUsernameHint(input: {
  serverApprovedPrivyLinkedAccounts?: PrivyLinkedAccountLike[] | null;
  snapshot: HostedAccountSettingsSnapshot;
}): HostedAccountSettingsSnapshot {
  return {
    ...input.snapshot,
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
