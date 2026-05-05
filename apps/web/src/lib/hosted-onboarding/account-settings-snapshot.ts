import "server-only";

import { getPrisma } from "../prisma";
import { readHostedMemberSnapshot } from "./hosted-member-store";

export interface HostedAccountSettingsSnapshot {
  email: {
    address: string | null;
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

  return {
    email: {
      address: snapshot?.emailAuthorization?.verifiedEmail?.address
        ?? snapshot?.emailAuthorization?.stripeCheckoutEmail?.address
        ?? null,
      verifiedAt: snapshot?.emailAuthorization?.verifiedEmail?.verifiedAt.toISOString() ?? null,
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
