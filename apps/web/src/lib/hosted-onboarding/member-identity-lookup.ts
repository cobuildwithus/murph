import { hostedOnboardingError } from "./errors";
import {
  lookupHostedMemberByVerifiedEmailAddress,
  type HostedMemberCoreState,
} from "./hosted-member-store";
import {
  lookupHostedMemberRoutingByTelegramUserId,
  type HostedMemberRoutingLookupMatch,
} from "./hosted-member-routing-store";
import { type HostedPrivyIdentity } from "./privy";
import type { HostedPrivyAuthMethod } from "./types";
import {
  lookupHostedMemberIdentityByPhoneNumber,
  lookupHostedMemberIdentityByPrivyUserId,
  type HostedMemberIdentityLookup,
  type HostedMemberIdentityLookupMatch,
} from "./hosted-member-identity-store";
import { type HostedOnboardingReadClient } from "./shared";

export type HostedMemberPrivyIdentityLookupMatch =
  | HostedMemberIdentityLookupMatch
  | HostedMemberRoutingLookupMatch
  | "verifiedEmail";

export interface HostedMemberPrivyIdentityLookup {
  core: HostedMemberCoreState;
  identity: HostedMemberIdentityLookup["identity"] | null;
  matchedBy: HostedMemberPrivyIdentityLookupMatch[];
}

export function hasHostedMemberPrivyIdentity(member: {
  privyUserId?: string | null | undefined;
  privyUserLookupKey?: string | null | undefined;
}): boolean {
  return Boolean(member.privyUserId ?? member.privyUserLookupKey);
}

export async function lookupHostedMemberForPrivyPrincipal(input: {
  identity: Pick<HostedPrivyIdentity, "userId">;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberCoreState | null> {
  const memberByPrivyUserId = await lookupHostedMemberIdentityByPrivyUserId({
    privyUserId: input.identity.userId,
    prisma: input.prisma,
    projection: "core",
  });

  return memberByPrivyUserId?.core ?? null;
}

export async function lookupHostedMemberForPrivyAuthAttempt(input: {
  authMethod: HostedPrivyAuthMethod;
  identity: HostedPrivyIdentity;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberPrivyIdentityLookup | null> {
  const matches = new Map<string, HostedMemberPrivyIdentityLookup>();

  const [memberByPrivyUserId, memberByAssertedCredential] = await Promise.all([
    lookupHostedMemberIdentityByPrivyUserId({
      privyUserId: input.identity.userId,
      prisma: input.prisma,
    }),
    lookupHostedMemberForPrivyAssertedCredential({
      authMethod: input.authMethod,
      identity: input.identity,
      prisma: input.prisma,
    }),
  ]);

  if (memberByPrivyUserId) {
    addHostedMemberPrivyIdentityMatch(matches, memberByPrivyUserId);
  }

  if (memberByAssertedCredential) {
    addHostedMemberPrivyIdentityMatch(matches, memberByAssertedCredential);
  }

  if (matches.size > 1) {
    throw createHostedPrivyIdentityConflictError();
  }

  return matches.values().next().value ?? null;
}

export function createHostedPrivyIdentityConflictError() {
  return hostedOnboardingError({
    code: "PRIVY_IDENTITY_CONFLICT",
    message:
      "This verified session conflicts with an existing Murph account. Contact support so we can merge it safely.",
    httpStatus: 409,
  });
}

async function lookupHostedMemberForPrivyAssertedCredential(input: {
  authMethod: HostedPrivyAuthMethod;
  identity: HostedPrivyIdentity;
  prisma: HostedOnboardingReadClient;
}): Promise<
  | HostedMemberIdentityLookup
  | {
      core: HostedMemberCoreState;
      matchedBy: HostedMemberPrivyIdentityLookupMatch;
    }
  | null
> {
  switch (input.authMethod) {
    case "phone":
      if (!input.identity.phone) {
        throw hostedOnboardingError({
          code: "PRIVY_PHONE_REQUIRED",
          message: "Finish phone verification before continuing.",
          httpStatus: 400,
        });
      }

      return lookupHostedMemberIdentityByPhoneNumber({
        phoneNumber: input.identity.phone.number,
        prisma: input.prisma,
      });
    case "email":
      if (!input.identity.email?.verifiedAt) {
        throw hostedOnboardingError({
          code: "PRIVY_EMAIL_REQUIRED",
          message: "Finish email verification before continuing.",
          httpStatus: 400,
        });
      }

      return lookupHostedMemberByVerifiedEmailAddress({
        address: input.identity.email.address,
        prisma: input.prisma,
      });
    case "telegram":
      if (!input.identity.telegram?.telegramUserId) {
        throw hostedOnboardingError({
          code: "PRIVY_TELEGRAM_REQUIRED",
          message: "Finish Telegram verification before continuing.",
          httpStatus: 400,
        });
      }

      return lookupHostedMemberRoutingByTelegramUserId({
        prisma: input.prisma,
        telegramUserId: input.identity.telegram.telegramUserId,
      });
  }

  throw new TypeError("Unsupported hosted Privy auth method.");
}

function addHostedMemberPrivyIdentityMatch(
  matches: Map<string, HostedMemberPrivyIdentityLookup>,
  match:
    | HostedMemberIdentityLookup
    | {
      core: HostedMemberCoreState;
      matchedBy: HostedMemberPrivyIdentityLookupMatch;
    },
): void {
  const existingMatch = matches.get(match.core.id);

  if (existingMatch) {
    if (!existingMatch.matchedBy.includes(match.matchedBy)) {
      existingMatch.matchedBy.push(match.matchedBy);
    }
    if ("identity" in match && match.identity && !existingMatch.identity) {
      existingMatch.identity = match.identity;
    }
    return;
  }

  matches.set(match.core.id, {
    core: match.core,
    identity: "identity" in match ? match.identity : null,
    matchedBy: [match.matchedBy],
  });
}
