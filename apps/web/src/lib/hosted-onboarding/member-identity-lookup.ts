import { createHostedPhoneLookupKey } from "./contact-privacy";
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
import { normalizeHostedWalletAddress } from "./wallet-address";
import {
  lookupHostedMemberIdentityByPhoneNumber,
  lookupHostedMemberIdentityByPrivyUserId,
  lookupHostedMemberIdentityByWalletAddress,
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

export async function lookupHostedMemberForPrivyIdentity(input: {
  identity: HostedPrivyIdentity;
  parallelizeReads?: boolean;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberPrivyIdentityLookup | null> {
  const matches = new Map<string, HostedMemberPrivyIdentityLookup>();
  const normalizedWalletAddress = input.identity.wallet
    ? normalizeHostedWalletAddress(input.identity.wallet.address)
    : null;
  const phoneLookupKey = input.identity.phone
    ? createHostedPhoneLookupKey(input.identity.phone.number)
    : null;
  const lookupByPrivyUserId = input.identity.userId
    ? () => lookupHostedMemberIdentityByPrivyUserId({
        privyUserId: input.identity.userId,
        prisma: input.prisma,
      })
    : null;
  const lookupByPhoneNumber = phoneLookupKey
    ? () => lookupHostedMemberIdentityByPhoneNumber({
        phoneNumber: input.identity.phone!.number,
        prisma: input.prisma,
      })
    : null;
  const lookupByWalletAddress = normalizedWalletAddress
    ? () => lookupHostedMemberIdentityByWalletAddress({
        prisma: input.prisma,
        walletAddress: normalizedWalletAddress,
      })
    : null;
  const lookupByTelegramUserId = input.identity.telegram?.telegramUserId
    ? () => lookupHostedMemberRoutingByTelegramUserId({
        prisma: input.prisma,
        telegramUserId: input.identity.telegram!.telegramUserId,
      })
    : null;
  const lookupByVerifiedEmail = input.identity.email?.address
    ? () => lookupHostedMemberByVerifiedEmailAddress({
        address: input.identity.email!.address,
        prisma: input.prisma,
      })
    : null;

  const [
    memberByPrivyUserId,
    memberByPhoneNumber,
    memberByWalletAddress,
    memberByTelegramUserId,
    memberByVerifiedEmail,
  ] =
    input.parallelizeReads
      ? await Promise.all([
          lookupByPrivyUserId?.() ?? Promise.resolve(null),
          lookupByPhoneNumber?.() ?? Promise.resolve(null),
          lookupByWalletAddress?.() ?? Promise.resolve(null),
          lookupByTelegramUserId?.() ?? Promise.resolve(null),
          lookupByVerifiedEmail?.() ?? Promise.resolve(null),
        ])
      : [
          lookupByPrivyUserId ? await lookupByPrivyUserId() : null,
          lookupByPhoneNumber ? await lookupByPhoneNumber() : null,
          lookupByWalletAddress ? await lookupByWalletAddress() : null,
          lookupByTelegramUserId ? await lookupByTelegramUserId() : null,
          lookupByVerifiedEmail ? await lookupByVerifiedEmail() : null,
        ];

  if (memberByPrivyUserId) {
    addHostedMemberPrivyIdentityMatch(matches, memberByPrivyUserId);
  }

  if (memberByPhoneNumber) {
    addHostedMemberPrivyIdentityMatch(matches, memberByPhoneNumber);
  }

  if (memberByWalletAddress) {
    addHostedMemberPrivyIdentityMatch(matches, memberByWalletAddress);
  }

  if (memberByTelegramUserId) {
    addHostedMemberPrivyIdentityMatch(matches, memberByTelegramUserId);
  }

  if (memberByVerifiedEmail) {
    addHostedMemberPrivyIdentityMatch(matches, memberByVerifiedEmail);
  }

  if (matches.size > 1) {
    throw createHostedPrivyIdentityConflictError();
  }

  return matches.values().next().value ?? null;
}

export async function lookupHostedMemberForPrivyPrincipal(input: {
  identity: Pick<HostedPrivyIdentity, "userId">;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberPrivyIdentityLookup | null> {
  const memberByPrivyUserId = await lookupHostedMemberIdentityByPrivyUserId({
    privyUserId: input.identity.userId,
    prisma: input.prisma,
  });

  if (!memberByPrivyUserId) {
    return null;
  }

  return {
    core: memberByPrivyUserId.core,
    identity: memberByPrivyUserId.identity,
    matchedBy: [memberByPrivyUserId.matchedBy],
  };
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
