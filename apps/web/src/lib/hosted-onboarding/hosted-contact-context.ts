import "server-only";

import { cache } from "react";

import {
  DEFAULT_MURPH_CONTACT_CHANNELS,
  resolveMurphContactChannels,
  type MurphContactChannels,
} from "@/src/lib/murph-contact-routing";
import { getPrisma } from "@/src/lib/prisma";
import { readHostedMemberRoutingState } from "./hosted-member-routing-store";
import { getHostedPageAuthSnapshot } from "./page-auth";

export interface HostedMurphContactContext {
  initialContactChannels: MurphContactChannels;
  murphPhoneNumber: string | null;
}

export async function readHostedMurphContactContext():
  Promise<HostedMurphContactContext> {
  const { authenticatedMember, linkedAccounts } = await getHostedPageAuthSnapshot();
  const routing = authenticatedMember
    ? await readHostedMemberRoutingState({
        memberId: authenticatedMember.id,
        prisma: getPrisma(),
      })
    : null;

  return {
    initialContactChannels: authenticatedMember
      ? resolveMurphContactChannels({ linkedAccounts })
      : DEFAULT_MURPH_CONTACT_CHANNELS,
    murphPhoneNumber: routing?.linqRecipientPhone ?? null,
  };
}

export const getHostedMurphContactContext = cache(readHostedMurphContactContext);
