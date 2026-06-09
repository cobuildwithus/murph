import "server-only";

import { cache } from "react";

import {
  DEFAULT_MURPH_CONTACT_CHANNELS,
  type MurphContactChannels,
} from "@/src/lib/murph-contact-routing";
import { getPrisma } from "@/src/lib/prisma";
import { readHostedAccountSettingsSnapshot } from "./account-settings-snapshot";
import { readHostedMemberRoutingState } from "./hosted-member-routing-store";
import { getHostedPageAuthSnapshot } from "./page-auth";

export interface HostedMurphContactContext {
  initialContactChannels: MurphContactChannels;
  murphEmailAddress: string | null;
  murphPhoneNumber: string | null;
}

export async function readHostedMurphContactContext():
  Promise<HostedMurphContactContext> {
  const { authenticatedMember } = await getHostedPageAuthSnapshot();
  const [routing, account] = authenticatedMember
    ? await Promise.all([
        readHostedMemberRoutingState({
          memberId: authenticatedMember.id,
          prisma: getPrisma(),
        }),
        readHostedAccountSettingsSnapshot({
          memberId: authenticatedMember.id,
        }),
      ])
    : [null, null];

  return {
    initialContactChannels: authenticatedMember
      ? {
          email: Boolean(account?.email?.murphEmailAddress),
          telegram: Boolean(account?.telegram?.telegramUserId),
          text: Boolean(account?.phone?.number),
        }
      : DEFAULT_MURPH_CONTACT_CHANNELS,
    murphEmailAddress: account?.email?.murphEmailAddress ?? null,
    murphPhoneNumber: routing?.linqRecipientPhone ?? null,
  };
}

export const getHostedMurphContactContext = cache(readHostedMurphContactContext);
