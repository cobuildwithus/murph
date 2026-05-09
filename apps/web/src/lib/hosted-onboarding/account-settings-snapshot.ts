import "server-only";

import { getPrisma } from "../prisma";
import { createHostedMemberReplyAliasRouteFromLookupKey } from "./hosted-email-reply-alias";
import { readHostedMemberSnapshot } from "./hosted-member-store";

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
      telegramUserId: snapshot?.routing?.telegramUserId ?? null,
    },
  };
}
