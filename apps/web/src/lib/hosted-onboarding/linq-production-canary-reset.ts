import { createHash, timingSafeEqual } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { deleteHostedAccountData } from "../hosted-privacy/account-data-service";
import { normalizeNullableString } from "../primitives";
import { hostedOnboardingError } from "./errors";
import { lookupHostedMemberIdentityByPhoneNumber } from "./hosted-member-identity-store";
import { resetHostedLinqFirstContactAdmissionForCanaryTx } from "./linq-first-contact-admission";
import { createHostedLinqParticipantContact } from "./linq-participant-contact";
import { normalizePhoneNumber } from "./phone";

const HOSTED_LINQ_PRODUCTION_CANARY_PHONE_NUMBER_ENV =
  "HOSTED_ONBOARDING_LINQ_PRODUCTION_CANARY_PHONE_NUMBER";
const HOSTED_LINQ_PRODUCTION_CANARY_RESET_SECRET_ENV =
  "HOSTED_ONBOARDING_LINQ_PRODUCTION_CANARY_RESET_SECRET";

type HostedLinqProductionCanaryEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type HostedLinqProductionCanaryResetResult = {
  accountDeleted: boolean;
  admissionBudgetCount: number;
  admissionDecisionCount: number;
  deliveryClaimCount: number;
};

export async function resetHostedLinqProductionCanary(input: {
  phoneNumber: string;
  prisma: PrismaClient;
  request: Request;
}): Promise<HostedLinqProductionCanaryResetResult> {
  const participantContact = createHostedLinqParticipantContact({
    kind: "phone",
    value: input.phoneNumber,
  });
  if (!participantContact) {
    throwHostedLinqProductionCanaryConfigurationError();
  }

  const admission = await input.prisma.$transaction((tx) =>
    resetHostedLinqFirstContactAdmissionForCanaryTx({
      participantContact,
      tx,
    })
  );
  const identity = await lookupHostedMemberIdentityByPhoneNumber({
    phoneNumber: input.phoneNumber,
    prisma: input.prisma,
    projection: "core",
  });
  if (identity) {
    await deleteHostedAccountData({
      exitFeedback: null,
      memberId: identity.core.id,
      prisma: input.prisma,
      request: input.request,
    });
  }

  return {
    accountDeleted: identity !== null,
    ...admission,
  };
}

export function requireHostedLinqProductionCanaryResetRequest(
  request: Request,
  source: HostedLinqProductionCanaryEnvironment = process.env,
): string {
  const configuredSecret = normalizeNullableString(
    source[HOSTED_LINQ_PRODUCTION_CANARY_RESET_SECRET_ENV],
  );
  const phoneNumber = normalizePhoneNumber(
    source[HOSTED_LINQ_PRODUCTION_CANARY_PHONE_NUMBER_ENV],
  );
  if (!configuredSecret || !phoneNumber) {
    throwHostedLinqProductionCanaryConfigurationError();
  }

  const providedSecret = readBearerToken(
    request.headers.get("authorization"),
  );
  if (!providedSecret || !timingSafeEquals(configuredSecret, providedSecret)) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_PRODUCTION_CANARY_UNAUTHORIZED",
      httpStatus: 401,
      message: "Unauthorized production canary reset request.",
    });
  }

  return phoneNumber;
}

function readBearerToken(value: string | null): string | null {
  const normalized = normalizeNullableString(value);
  if (!normalized?.startsWith("Bearer ")) {
    return null;
  }
  return normalizeNullableString(normalized.slice("Bearer ".length));
}

function timingSafeEquals(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function throwHostedLinqProductionCanaryConfigurationError(): never {
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_PRODUCTION_CANARY_CONFIGURATION_REQUIRED",
    httpStatus: 503,
    message: "The production canary reset is not configured.",
  });
}
