import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { cache } from "react";

import {
  DEFAULT_MURPH_CONTACT_CHANNELS,
  type MurphContactChannels,
} from "@/src/lib/murph-contact-routing";
import { runWithHostedDomainRootUnwrapCache } from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import { decryptHostedWebNullableString } from "@/src/lib/hosted-web/encryption";
import { getPrisma } from "@/src/lib/prisma";
import { createHostedMemberReplyAliasRouteFromLookupKey } from "./hosted-email-reply-alias";
import {
  readHostedMemberIdentityPhoneNumber,
  readHostedMemberRoutingTelegramPrivateState,
} from "./member-private-codecs";
import { getHostedPageAuthSnapshot } from "./page-auth";

// These values are persisted cryptographic AAD labels. Keep them aligned with
// the corresponding writers in the hosted member private-state stores.
const HOSTED_MEMBER_ROUTING_HOME_LINQ_RECIPIENT_PHONE_FIELD =
  "hosted-member-routing.home-linq-recipient-phone";
const HOSTED_MEMBER_EMAIL_AUTH_VERIFIED_EMAIL_FIELD =
  "hosted-member-email-authorization.verified-email";
const HOSTED_MEMBER_EMAIL_AUTH_STRIPE_CHECKOUT_EMAIL_FIELD =
  "hosted-member-email-authorization.stripe-checkout-email";

const hostedMurphContactMemberSelect =
  Prisma.validator<Prisma.HostedMemberSelect>()({
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
      },
    },
    routing: {
      select: {
        linqRecipientPhoneEncrypted: true,
        memberId: true,
        replyAliasLookupKey: true,
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
  userEmailAddress: string | null;
}

export async function readHostedMurphContactContext():
  Promise<HostedMurphContactContext> {
  const { authenticatedMember } = await getHostedPageAuthSnapshot();
  if (!authenticatedMember) {
    return emptyHostedMurphContactContext();
  }

  return runWithHostedDomainRootUnwrapCache(async () => {
    const prisma = getPrisma();
    const member = await prisma.hostedMember.findUnique({
      select: hostedMurphContactMemberSelect,
      where: { id: authenticatedMember.id },
    });
    if (!member) {
      return emptyHostedMurphContactContext();
    }

    return projectHostedMurphContactContext(member, prisma);
  });
}

export const getHostedMurphContactContext = cache(readHostedMurphContactContext);

async function projectHostedMurphContactContext(
  member: HostedMurphContactMember,
  prisma: PrismaClient,
): Promise<HostedMurphContactContext> {
  const emailAuthorization = member.emailAuthorization;
  const routing = member.routing;
  const [
    memberPhoneNumber,
    telegramState,
    linqRecipientPhone,
    verifiedEmailAddress,
    stripeCheckoutEmailAddress,
  ] = await Promise.all([
    member.identity
      ? readHostedMemberIdentityPhoneNumber(member.identity, prisma)
      : null,
    routing
      ? readHostedMemberRoutingTelegramPrivateState(routing, prisma)
      : null,
    routing
      ? decryptHostedWebNullableString({
          field: HOSTED_MEMBER_ROUTING_HOME_LINQ_RECIPIENT_PHONE_FIELD,
          memberId: routing.memberId,
          prisma,
          value: routing.linqRecipientPhoneEncrypted,
        })
      : null,
    emailAuthorization
      ? decryptHostedWebNullableString({
          field: HOSTED_MEMBER_EMAIL_AUTH_VERIFIED_EMAIL_FIELD,
          memberId: emailAuthorization.memberId,
          prisma,
          value: emailAuthorization.verifiedEmailAddressEncrypted,
        })
      : null,
    emailAuthorization
      ? decryptHostedWebNullableString({
          field: HOSTED_MEMBER_EMAIL_AUTH_STRIPE_CHECKOUT_EMAIL_FIELD,
          memberId: emailAuthorization.memberId,
          prisma,
          value: emailAuthorization.stripeCheckoutEmailAddressEncrypted,
        })
      : null,
  ]);
  const verifiedEmail =
    verifiedEmailAddress
    && emailAuthorization?.verifiedEmailLookupKey
    && emailAuthorization.verifiedEmailVerifiedAt
      ? verifiedEmailAddress
      : null;
  const stripeCheckoutEmail =
    stripeCheckoutEmailAddress && emailAuthorization?.stripeCheckoutEmailCollectedAt
      ? stripeCheckoutEmailAddress
      : null;
  const murphEmailRoute = verifiedEmail
    ? await createHostedMemberReplyAliasRouteFromLookupKey({
        replyAliasLookupKey: routing?.replyAliasLookupKey,
      })
    : null;

  return {
    initialContactChannels: {
      email: Boolean(murphEmailRoute?.address),
      telegram: Boolean(telegramState?.telegramUserId),
      text: Boolean(memberPhoneNumber),
    },
    murphEmailAddress: murphEmailRoute?.address ?? null,
    murphPhoneNumber: linqRecipientPhone,
    userEmailAddress: verifiedEmail ?? stripeCheckoutEmail,
  };
}

function emptyHostedMurphContactContext(): HostedMurphContactContext {
  return {
    initialContactChannels: DEFAULT_MURPH_CONTACT_CHANNELS,
    murphEmailAddress: null,
    murphPhoneNumber: null,
    userEmailAddress: null,
  };
}
