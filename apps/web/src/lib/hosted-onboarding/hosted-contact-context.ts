import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { cache } from "react";

import {
  DEFAULT_MURPH_CONTACT_CHANNELS,
  type MurphContactChannels,
} from "@/src/lib/murph-contact-routing";
import { getPrisma } from "@/src/lib/prisma";
import { createHostedMemberReplyAliasRouteFromLookupKey } from "./hosted-email-reply-alias";
import { readHostedLinqLinePhoneNumberByLookupKey } from "./linq-line-phone-resolver";
import { getHostedPageAuthSnapshot } from "./page-auth";

const hostedMurphContactMemberSelect =
  Prisma.validator<Prisma.HostedMemberSelect>()({
    emailAuthorization: {
      select: {
        verifiedEmailAddressEncrypted: true,
        verifiedEmailLookupKey: true,
        verifiedEmailVerifiedAt: true,
      },
    },
    identity: {
      select: {
        phoneLookupKey: true,
        phoneNumberEncrypted: true,
        phoneNumberVerifiedAt: true,
      },
    },
    routing: {
      select: {
        linqRecipientPhoneLookupKey: true,
        replyAliasLookupKey: true,
        telegramUserLookupKey: true,
        telegramUserIdEncrypted: true,
      },
    },
  });

type HostedMurphContactMember = Prisma.HostedMemberGetPayload<{
  select: typeof hostedMurphContactMemberSelect;
}>;

export interface HostedMurphContactContext {
  initialContactChannels: MurphContactChannels;
  murphEmailAddress: string | null;
  murphPhoneNumber: string | null;
}

export async function readHostedMurphContactContext():
  Promise<HostedMurphContactContext> {
  const { authenticatedMember } = await getHostedPageAuthSnapshot();
  if (!authenticatedMember) {
    return emptyHostedMurphContactContext();
  }

  return readHostedMurphContactContextForMember({
    memberId: authenticatedMember.id,
    prisma: getPrisma(),
  });
}

export async function readHostedMurphContactContextForMember(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<HostedMurphContactContext> {
  const member = await input.prisma.hostedMember.findUnique({
    select: hostedMurphContactMemberSelect,
    where: { id: input.memberId },
  });
  if (!member) {
    return emptyHostedMurphContactContext();
  }

  return projectHostedMurphContactContext(member, input.prisma);
}

export const getHostedMurphContactContext = cache(readHostedMurphContactContext);

async function projectHostedMurphContactContext(
  member: HostedMurphContactMember,
  prisma: PrismaClient,
): Promise<HostedMurphContactContext> {
  const emailAuthorization = member.emailAuthorization;
  const routing = member.routing;
  const hasVerifiedEmail = Boolean(
    emailAuthorization?.verifiedEmailAddressEncrypted
    && emailAuthorization?.verifiedEmailLookupKey
    && emailAuthorization?.verifiedEmailVerifiedAt,
  );
  const hasVerifiedPhone = Boolean(
    member.identity?.phoneLookupKey
    && member.identity.phoneNumberEncrypted
    && member.identity.phoneNumberVerifiedAt,
  );
  const hasTelegramIdentity = Boolean(
    routing?.telegramUserLookupKey
    && routing.telegramUserIdEncrypted,
  );
  const [murphEmailRoute, murphPhoneNumber] = await Promise.all([
    hasVerifiedEmail
      ? createHostedMemberReplyAliasRouteFromLookupKey({
          replyAliasLookupKey: routing?.replyAliasLookupKey,
        })
      : null,
    routing?.linqRecipientPhoneLookupKey
      ? readHostedLinqLinePhoneNumberByLookupKey({
          phoneNumberLookupKey: routing.linqRecipientPhoneLookupKey,
          prisma,
        }).catch(() => null)
      : null,
  ]);

  return {
    initialContactChannels: {
      email: Boolean(murphEmailRoute?.address),
      telegram: hasTelegramIdentity,
      text: hasVerifiedPhone,
    },
    murphEmailAddress: murphEmailRoute?.address ?? null,
    murphPhoneNumber,
  };
}

function emptyHostedMurphContactContext(): HostedMurphContactContext {
  return {
    initialContactChannels: DEFAULT_MURPH_CONTACT_CHANNELS,
    murphEmailAddress: null,
    murphPhoneNumber: null,
  };
}
