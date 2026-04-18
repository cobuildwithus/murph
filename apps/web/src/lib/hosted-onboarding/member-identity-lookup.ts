import { type HostedMember } from "@prisma/client";

import { createHostedPhoneLookupKey } from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import { type HostedPrivyIdentity } from "./privy";
import { normalizeHostedWalletAddress } from "./revnet";
import {
  lookupHostedMemberIdentityByPhoneNumber,
  lookupHostedMemberIdentityByPrivyUserId,
  lookupHostedMemberIdentityByWalletAddress,
  type HostedMemberIdentityLookup,
  type HostedMemberIdentityLookupMatch,
} from "./hosted-member-identity-store";
import { type HostedOnboardingReadClient } from "./shared";

export interface HostedMemberPrivyIdentityLookup {
  core: HostedMemberIdentityLookup["core"];
  identity: HostedMemberIdentityLookup["identity"];
  matchedBy: HostedMemberIdentityLookupMatch[];
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

  const [memberByPrivyUserId, memberByPhoneNumber, memberByWalletAddress] =
    input.parallelizeReads
      ? await Promise.all([
          lookupByPrivyUserId?.() ?? Promise.resolve(null),
          lookupByPhoneNumber?.() ?? Promise.resolve(null),
          lookupByWalletAddress?.() ?? Promise.resolve(null),
        ])
      : [
          lookupByPrivyUserId ? await lookupByPrivyUserId() : null,
          lookupByPhoneNumber ? await lookupByPhoneNumber() : null,
          lookupByWalletAddress ? await lookupByWalletAddress() : null,
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

  if (matches.size > 1) {
    throw createHostedPrivyIdentityConflictError();
  }

  return matches.values().next().value ?? null;
}

export function createHostedPrivyIdentityConflictError() {
  return hostedOnboardingError({
    code: "PRIVY_IDENTITY_CONFLICT",
    message:
      "This verified phone session conflicts with an existing Murph account. Contact support so we can merge it safely.",
    httpStatus: 409,
  });
}

function addHostedMemberPrivyIdentityMatch(
  matches: Map<string, HostedMemberPrivyIdentityLookup>,
  match: HostedMemberIdentityLookup,
): void {
  const existingMatch = matches.get(match.core.id);

  if (existingMatch) {
    if (!existingMatch.matchedBy.includes(match.matchedBy)) {
      existingMatch.matchedBy.push(match.matchedBy);
    }
    return;
  }

  matches.set(match.core.id, {
    core: match.core,
    identity: match.identity,
    matchedBy: [match.matchedBy],
  });
}
