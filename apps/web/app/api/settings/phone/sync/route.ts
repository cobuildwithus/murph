import { getPrisma } from "@/src/lib/prisma";
import { readHostedPhoneHint } from "@/src/lib/hosted-onboarding/contact-privacy";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { reconcileHostedPrivyIdentityOnMember } from "@/src/lib/hosted-onboarding/member-identity-service";
import { requirePrivyMemberAuth } from "@/src/lib/hosted-onboarding/request-auth";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requirePrivyMemberAuth(request);
  const phoneNumber = auth.identity.phone?.number ?? null;

  if (!phoneNumber) {
    throw hostedOnboardingError({
      code: "PRIVY_PHONE_NOT_READY",
      message: "Your verified phone number has not reached the server-side Privy session yet. Wait a moment and try again.",
      httpStatus: 409,
      retryable: true,
    });
  }

  await reconcileHostedPrivyIdentityOnMember({
    identity: auth.identity,
    member: auth.member,
    now: new Date(),
    prisma: getPrisma(),
  });

  return jsonOk({
    ok: true,
    phoneNumber,
    phoneNumberHint: readHostedPhoneHint(phoneNumber),
  });
});
