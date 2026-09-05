import { HOSTED_ASSISTANT_LUNA_MODEL } from "@murphai/hosted-execution/assistant-model";

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

export function resolveHostedLinqProductionCanaryAssistantModelPreference(
  phoneNumber: string,
  source: HostedLinqProductionCanaryEnvironment = process.env,
): typeof HOSTED_ASSISTANT_LUNA_MODEL | undefined {
  const configuredPhoneNumber = readHostedLinqProductionCanaryPhoneNumber(source);
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
  return configuredPhoneNumber !== null
      && normalizedPhoneNumber === configuredPhoneNumber
    ? HOSTED_ASSISTANT_LUNA_MODEL
    : undefined;
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
