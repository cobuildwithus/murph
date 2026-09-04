import { lookupHostedMemberIdentityByPhoneNumber } from "./hosted-member-identity-store";
import { normalizePhoneNumber } from "./phone";
import type { HostedOnboardingReadClient } from "./shared";

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

export async function readHostedLinqProductionCanaryMemberId(input: {
  prisma: HostedOnboardingReadClient;
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
