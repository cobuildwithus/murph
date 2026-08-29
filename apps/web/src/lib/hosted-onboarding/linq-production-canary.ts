import type { PrismaClient } from "@prisma/client";

import { createHostedPhoneLookupKeyReadCandidates } from "./contact-privacy";
import { lookupHostedMemberIdentityByPhoneNumber } from "./hosted-member-identity-store";
import { normalizePhoneNumber } from "./phone";

const HOSTED_LINQ_PRODUCTION_CANARY_PHONE_NUMBER_ENV =
  "HOSTED_ONBOARDING_LINQ_PRODUCTION_CANARY_PHONE_NUMBER";

export type HostedLinqProductionCanaryEnvironment = Readonly<
  Record<string, string | undefined>
>;

export function readHostedLinqProductionCanaryPhoneNumber(
  source: HostedLinqProductionCanaryEnvironment = process.env,
): string | null {
  return normalizePhoneNumber(
    source[HOSTED_LINQ_PRODUCTION_CANARY_PHONE_NUMBER_ENV],
  );
}

export function readHostedLinqProductionCanaryPhoneLookupKeys(
  source: HostedLinqProductionCanaryEnvironment = process.env,
): string[] {
  const phoneNumber = readHostedLinqProductionCanaryPhoneNumber(source);
  return phoneNumber
    ? createHostedPhoneLookupKeyReadCandidates(phoneNumber)
    : [];
}

export async function readHostedLinqProductionCanaryMemberId(input: {
  prisma: PrismaClient;
  source?: HostedLinqProductionCanaryEnvironment;
}): Promise<string | null> {
  const phoneNumber = readHostedLinqProductionCanaryPhoneNumber(input.source);
  if (!phoneNumber) {
    return null;
  }

  const identity = await lookupHostedMemberIdentityByPhoneNumber({
    phoneNumber,
    prisma: input.prisma,
    projection: "core",
  });
  return identity?.core.id ?? null;
}
