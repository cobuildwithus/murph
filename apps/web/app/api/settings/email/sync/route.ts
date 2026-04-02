import { syncHostedVerifiedEmailToHostedExecution } from "@/src/lib/hosted-execution/control";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";
import {
  extractHostedPrivyVerifiedEmailAccount,
} from "@/src/lib/hosted-onboarding/privy-shared";
import { requireHostedPrivyRequestAuthContext } from "@/src/lib/hosted-onboarding/request-auth";

export const POST = withJsonError(async (request: Request) => {
    assertHostedOnboardingMutationOrigin(request);
    const auth = await requireHostedPrivyRequestAuthContext(request);
    const body = await readOptionalJsonObject(request);
    const expectedEmailAddress = normalizeComparableEmail(
      typeof body.expectedEmailAddress === "string" ? body.expectedEmailAddress : null,
    );
    const verifiedEmail = extractHostedPrivyVerifiedEmailAccount(auth.linkedAccounts);
    const comparableVerifiedEmail = normalizeComparableEmail(verifiedEmail?.address ?? null);

    if (!verifiedEmail || (expectedEmailAddress && expectedEmailAddress !== comparableVerifiedEmail)) {
      throw hostedOnboardingError({
        code: "PRIVY_EMAIL_NOT_READY",
        message:
          "Your verified email has not reached the server-side Privy session yet. Wait a moment and try again.",
        httpStatus: 409,
        retryable: true,
      });
    }

    const verifiedAt = new Date(verifiedEmail.verifiedAt * 1000).toISOString();
    const syncResult = await syncHostedVerifiedEmailToHostedExecution({
      emailAddress: verifiedEmail.address,
      userId: auth.member.id,
      verifiedAt,
    });

    return jsonOk({
      emailAddress: syncResult.emailAddress,
      ok: true,
      runTriggered: syncResult.runTriggered,
      verifiedAt: syncResult.verifiedAt,
    });
});

function normalizeComparableEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized.toLowerCase() : null;
}
